import { type PrismaClient, withTransaction } from '@hmedic/database';
import { newId } from '@hmedic/kernel';
import { buildStorageKey } from '../domain/storage-keys';
import {
  type ProxiedUploadStoragePort,
  type UploadStorageSession,
  UploadStorageError,
} from '../application/upload-storage-port';
import {
  UPLOAD_SESSION_TTL_MS,
  type UploadRequestDetails,
  validateUploadRequest,
} from '../application/upload-policy';

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
}
