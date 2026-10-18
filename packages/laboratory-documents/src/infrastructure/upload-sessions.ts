import type { Readable } from 'node:stream';
import { type PrismaClient, withTransaction } from '@hmedic/database';
import { newId } from '@hmedic/kernel';
import { buildStorageKey } from '../domain/storage-keys';
import {
  type ProxiedUploadStoragePort,
  type UploadStorageSession,
  UploadStorageError,
  UPLOAD_SHA256,
  uploadPartSize,
} from '../application/upload-storage-port';
import {
  UPLOAD_SESSION_TTL_MS,
  type UploadRequestDetails,
  validateUploadRequest,
} from '../application/upload-policy';
import { recordUploadPart } from './upload-records';

export interface CreateUploadInput extends UploadRequestDetails {
  tenantId: string;
  ownerUserId: string;
  patientId: string;
  encounterId?: string | null | undefined;
}

export interface CreatedUploadSession {
  documentId: string;
  sessionId: string;
  mode: 'proxied';
  partSizeBytes: number;
  partCount: number;
  expiresAt: Date;
}

export interface OwnedUploadIdentity {
  tenantId: string;
  sessionId: string;
  ownerUserId: string;
}

export interface UploadPatientScope {
  tenantId: string;
  patientId: string;
  encounterId: string | null;
  category: string;
}

/**
 * The API's live permission/patient-context check is supplied by its composition root. The service
 * rechecks the patient and encounter relationship in the insert transaction, but a tenant FK alone is
 * not sufficient evidence that the actor may upload this patient's file.
 */
export class UploadSessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ProxiedUploadStoragePort,
    private readonly authorize: (input: CreateUploadInput) => Promise<'CLINICAL_TEAM' | 'PATIENT_SHARED'>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async create(input: CreateUploadInput): Promise<CreatedUploadSession> {
    const policy = validateUploadRequest(input);
    const accessPolicy = await this.authorize(input);
    if (accessPolicy !== 'CLINICAL_TEAM' && accessPolicy !== 'PATIENT_SHARED')
      throw new UploadStorageError('UPLOAD_INVALID', 'Invalid upload access policy');
    const now = this.clock();
    if (!Number.isFinite(now.getTime())) throw new UploadStorageError('UPLOAD_INVALID', 'Invalid clock');
    const documentId = newId();
    const sessionId = newId();
    const session: UploadStorageSession = {
      sessionId,
      key: buildStorageKey({ tenantId: input.tenantId, category: policy.category, documentId, revision: 1 }),
      contentType: policy.contentType,
      sizeBytes: policy.sizeBytes,
      sha256: policy.sha256,
      partSizeBytes: policy.partSizeBytes,
      expiresAt: new Date(now.getTime() + UPLOAD_SESSION_TTL_MS),
    };
    await withTransaction(
      this.prisma,
      async (tx) => {
        const patient = await tx.patient.findFirst({
          where: { tenantId: input.tenantId, id: input.patientId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!patient) throw new UploadStorageError('UPLOAD_NOT_FOUND', 'Patient not found');
        if (input.encounterId) {
          const encounter = await tx.encounter.findFirst({
            where: { tenantId: input.tenantId, id: input.encounterId, patientId: input.patientId },
            select: { id: true },
          });
          if (!encounter) throw new UploadStorageError('UPLOAD_NOT_FOUND', 'Encounter not found');
        }
        await tx.document.create({
          data: {
            id: documentId,
            tenantId: input.tenantId,
            patientId: input.patientId,
            encounterId: input.encounterId ?? null,
            category: policy.category,
            status: 'CREATED',
            accessPolicy,
            title: policy.title,
            createdAt: now,
            updatedAt: now,
            createdByUserId: input.ownerUserId,
            updatedByUserId: input.ownerUserId,
          },
        });
        await tx.uploadSession.create({
          data: {
            id: sessionId,
            tenantId: input.tenantId,
            documentId,
            ownerUserId: input.ownerUserId,
            targetRevision: 1,
            storageAdapter: 'disk',
            storageKey: session.key,
            contentType: session.contentType,
            expectedSizeBytes: BigInt(session.sizeBytes),
            expectedSha256: session.sha256,
            partSizeBytes: session.partSizeBytes,
            status: 'OPEN',
            expiresAt: session.expiresAt,
            createdAt: now,
            updatedAt: now,
            createdByUserId: input.ownerUserId,
            updatedByUserId: input.ownerUserId,
          },
        });
      },
      { context: 'create-upload-session' },
    );
    try {
      // The manifest is idempotent. After a crash between DB commit and here, a resume path can create
      // the same manifest from the server-owned DB descriptor. No file I/O occurs inside the transaction.
      await this.storage.createUploadSession(session);
    } catch (error) {
      await withTransaction(
        this.prisma,
        async (tx) => {
          await tx.uploadSession.updateMany({
            where: { id: sessionId, tenantId: input.tenantId, status: 'OPEN' },
            data: { status: 'ABORTED', updatedAt: now, rowVersion: { increment: 1 } },
          });
          await tx.document.updateMany({
            where: { id: documentId, tenantId: input.tenantId, status: 'CREATED' },
            data: { status: 'EXPIRED', updatedAt: now, rowVersion: { increment: 1 } },
          });
        },
        { context: 'create-upload-session-compensate' },
      );
      // createUploadSession may have written part of a private manifest before failing. Abort is
      // idempotent; a later cleanup run can retry if the storage root is still unavailable.
      await this.storage.abortUpload(session).catch(() => undefined);
      if (error instanceof UploadStorageError) throw error;
      throw new UploadStorageError('UPLOAD_IO_FAILED', 'Upload storage is unavailable');
    }
    return {
      documentId,
      sessionId,
      mode: 'proxied',
      partSizeBytes: session.partSizeBytes,
      partCount: policy.partCount,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Streams one part through the proxied storage adapter. An unselected immutable part may remain if
   * authorization or session state changes during I/O; expiry cleanup removes those session bytes.
   * The HTTP caller must derive identity from authenticated context, never from the request body.
   */
  async uploadPart(
    identity: OwnedUploadIdentity,
    partNumber: number,
    body: Buffer | Readable,
    sha256: string,
    authorize: (scope: UploadPatientScope) => Promise<void>,
  ): Promise<{ partNumber: number; sizeBytes: number; sha256: string }> {
    if (!UPLOAD_SHA256.test(sha256))
      throw new UploadStorageError('UPLOAD_PARTS_INVALID', 'Invalid part checksum');
    const now = this.clock();
    const row = await this.prisma.uploadSession.findFirst({
      where: {
        id: identity.sessionId,
        tenantId: identity.tenantId,
        ownerUserId: identity.ownerUserId,
        status: 'OPEN',
        expiresAt: { gt: now },
      },
    });
    if (!row) throw new UploadStorageError('UPLOAD_NOT_FOUND', 'Open upload session not found');
    if (row.storageAdapter !== 'disk')
      throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload adapter mismatch');
    const document = await this.prisma.document.findFirst({
      where: { id: row.documentId, tenantId: row.tenantId, status: { in: ['CREATED', 'UPLOADING'] } },
      select: { patientId: true, encounterId: true, category: true },
    });
    if (!document) throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload document changed');
    const scope: UploadPatientScope = {
      tenantId: row.tenantId,
      patientId: document.patientId,
      encounterId: document.encounterId,
      category: document.category,
    };
    await authorize(scope);
    const session: UploadStorageSession = {
      sessionId: row.id,
      key: row.storageKey,
      contentType: row.contentType,
      sizeBytes: Number(row.expectedSizeBytes),
      sha256: row.expectedSha256,
      partSizeBytes: row.partSizeBytes,
      expiresAt: row.expiresAt,
    };
    uploadPartSize(session, partNumber);
    // Rebuild an interrupted create from the DB descriptor; the adapter refuses a mismatched manifest.
    await this.storage.createUploadSession(session);
    const receipt = await this.storage.uploadPart(session, partNumber, body, sha256);
    await authorize(scope);
    await recordUploadPart(this.prisma, identity, receipt, this.clock());
    return receipt;
  }
}
