import { type PrismaClient, withTransaction } from '@hmedic/database';
import { type JobPort, type JobRegistry } from '@hmedic/jobs';
import { newId } from '@hmedic/kernel';
import { z } from 'zod';
import type { StoredObject } from '../application/object-storage-port';
import { type ProxiedUploadStoragePort, UploadStorageError } from '../application/upload-storage-port';
import { claimUploadFinalize } from './upload-records';
import type { OwnedUploadIdentity } from './upload-sessions';

export const SCAN_UPLOADED_DOCUMENT = 'ScanDocumentVersion';

export function registerUploadScanJobType(registry: JobRegistry): void {
  registry.register({
    type: SCAN_UPLOADED_DOCUMENT,
    queue: 'documents',
    payloadSchema: z.object({
      v: z.literal(1),
      tenantId: z.string().uuid(),
      documentId: z.string().uuid(),
      versionId: z.string().uuid(),
    }),
    maxAttempts: 3,
    leaseSeconds: 120,
    priority: 850,
  });
}

/** Object I/O precedes this short transaction. A job-enqueue failure rolls back every state change. */
export async function commitUploadFinalize(
  prisma: PrismaClient,
  jobs: JobPort,
  identity: OwnedUploadIdentity,
  partsSha256: string,
  object: StoredObject,
  now: Date,
): Promise<{ documentId: string; versionId: string }> {
  return withTransaction(
    prisma,
    async (tx) => {
      const row = await tx.uploadSession.findFirst({
        where: { id: identity.sessionId, tenantId: identity.tenantId, ownerUserId: identity.ownerUserId },
      });
      if (!row) throw new UploadStorageError('UPLOAD_NOT_FOUND', 'Upload session not found');
      if (row.status !== 'FINALIZING' || row.finalizePartsSha256 !== partsSha256)
        throw new UploadStorageError('UPLOAD_CONFLICT', 'Finalize claim changed');
      if (
        row.storageAdapter !== 'disk' ||
        object.key !== row.storageKey ||
        object.sha256 !== row.expectedSha256 ||
        object.sizeBytes !== Number(row.expectedSizeBytes)
      )
        throw new UploadStorageError('UPLOAD_CHECKSUM_MISMATCH', 'Completed object differs from upload');
      const document = await tx.document.findFirst({
        where: { id: row.documentId, tenantId: row.tenantId, status: { in: ['CREATED', 'UPLOADING'] } },
        select: { id: true },
      });
      if (!document) throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload document changed');
      const claimed = await tx.uploadSession.updateMany({
        where: {
          id: row.id,
          tenantId: row.tenantId,
          ownerUserId: row.ownerUserId,
          status: 'FINALIZING',
          finalizePartsSha256: partsSha256,
          rowVersion: row.rowVersion,
        },
        data: {
          status: 'FINALIZED',
          finalizedAt: now,
          updatedAt: now,
          updatedByUserId: identity.ownerUserId,
          rowVersion: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw new UploadStorageError('UPLOAD_CONFLICT', 'Finalize claim changed');
      const versionId = newId();
      await tx.documentVersion.create({
        data: {
          id: versionId,
          tenantId: row.tenantId,
          documentId: row.documentId,
          revision: row.targetRevision,
          storageAdapter: row.storageAdapter,
          storageKey: row.storageKey,
          contentType: row.contentType,
          sizeBytes: row.expectedSizeBytes,
          sha256: row.expectedSha256,
          scanStatus: 'PENDING',
          uploadedByUserId: row.ownerUserId,
          createdAt: now,
          updatedAt: now,
          createdByUserId: row.ownerUserId,
          updatedByUserId: row.ownerUserId,
        },
      });
      const moved = await tx.document.updateMany({
        where: { id: row.documentId, tenantId: row.tenantId, status: { in: ['CREATED', 'UPLOADING'] } },
        data: {
          status: 'SCANNING',
          updatedAt: now,
          updatedByUserId: row.ownerUserId,
          rowVersion: { increment: 1 },
        },
      });
      if (moved.count !== 1) throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload document changed');
      await jobs.enqueue(
        {
          type: SCAN_UPLOADED_DOCUMENT,
          tenantId: row.tenantId,
          payload: { v: 1, tenantId: row.tenantId, documentId: row.documentId, versionId },
          idempotencyKey: `scan-upload:${versionId}`,
          correlationId: row.id,
        },
        tx,
      );
      return { documentId: row.documentId, versionId };
    },
    { context: 'upload-finalize-commit' },
  );
}

/** A retry after a lost DB response returns the committed version without touching storage. */
export async function finalizeUpload(
  prisma: PrismaClient,
  storage: ProxiedUploadStoragePort,
  jobs: JobPort,
  identity: OwnedUploadIdentity,
  authorize: () => Promise<void>,
  now: Date,
): Promise<{ documentId: string; versionId: string }> {
  await authorize();
  const existing = await prisma.uploadSession.findFirst({
    where: { id: identity.sessionId, tenantId: identity.tenantId, ownerUserId: identity.ownerUserId },
  });
  if (!existing) throw new UploadStorageError('UPLOAD_NOT_FOUND', 'Upload session not found');
  if (existing.status === 'FINALIZED') {
    const version = await prisma.documentVersion.findFirst({
      where: {
        tenantId: identity.tenantId,
        documentId: existing.documentId,
        revision: existing.targetRevision,
      },
    });
    if (!version) throw new UploadStorageError('UPLOAD_CONFLICT', 'Finalized version missing');
    return { documentId: existing.documentId, versionId: version.id };
  }
  const claim = await claimUploadFinalize(prisma, identity, now);
  const object = await storage.completeUpload(claim.session, claim.parts);
  await authorize();
  return commitUploadFinalize(prisma, jobs, identity, claim.partsSha256, object, now);
}
