import { createHash } from 'node:crypto';
import { type PrismaClient, withTransaction } from '@hmedic/database';
import {
  assertUploadParts,
  type UploadPartReceipt,
  type UploadStorageSession,
  UploadStorageError,
} from '../application/upload-storage-port';

interface SessionIdentity {
  tenantId: string;
  sessionId: string;
  ownerUserId: string;
}

/**
 * Select one immutable storage receipt as the current part. The session update acquires its row lock
 * before touching the part row, so a concurrent finalize claim cannot snapshot half an upload.
 * Storage I/O has already completed before this short transaction starts.
 */
export async function recordUploadPart(
  prisma: PrismaClient,
  identity: SessionIdentity,
  receipt: UploadPartReceipt,
  now: Date,
): Promise<void> {
  await withTransaction(
    prisma,
    async (tx) => {
      const claimed = await tx.uploadSession.updateMany({
        where: {
          id: identity.sessionId,
          tenantId: identity.tenantId,
          ownerUserId: identity.ownerUserId,
          status: 'OPEN',
          expiresAt: { gt: now },
        },
        data: { rowVersion: { increment: 1 }, updatedAt: now, updatedByUserId: identity.ownerUserId },
      });
      if (claimed.count !== 1) throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload session is not open');
      const session = await tx.uploadSession.findUniqueOrThrow({ where: { id: identity.sessionId } });
      const descriptor: UploadStorageSession = {
        sessionId: session.id,
        key: session.storageKey,
        contentType: session.contentType,
        sizeBytes: Number(session.expectedSizeBytes),
        sha256: session.expectedSha256,
        partSizeBytes: session.partSizeBytes,
        expiresAt: session.expiresAt,
      };
      // Validate the exact number and byte count before selecting the immutable receipt.
      const count = Math.ceil(descriptor.sizeBytes / descriptor.partSizeBytes);
      const expected = Math.min(
        descriptor.partSizeBytes,
        descriptor.sizeBytes - (receipt.partNumber - 1) * descriptor.partSizeBytes,
      );
      if (
        !Number.isSafeInteger(receipt.partNumber) ||
        receipt.partNumber < 1 ||
        receipt.partNumber > count ||
        receipt.sizeBytes !== expected ||
        !/^[a-f0-9]{64}$/.test(receipt.sha256)
      )
        throw new UploadStorageError('UPLOAD_PARTS_INVALID', 'Invalid upload part receipt');
      await tx.uploadSessionPart.upsert({
        where: {
          uploadSessionId_partNumber: { uploadSessionId: identity.sessionId, partNumber: receipt.partNumber },
        },
        create: {
          uploadSessionId: identity.sessionId,
          tenantId: identity.tenantId,
          partNumber: receipt.partNumber,
          sizeBytes: receipt.sizeBytes,
          sha256: receipt.sha256,
          receivedAt: now,
        },
        update: { sizeBytes: receipt.sizeBytes, sha256: receipt.sha256, receivedAt: now, etag: null },
      });
    },
    { context: 'upload-part-receipt' },
  );
}

export interface FinalizeClaim {
  session: UploadStorageSession;
  parts: UploadPartReceipt[];
  partsSha256: string;
}

/**
 * Snapshot exact ordered receipts and take a bounded finalize lease in one short transaction. A retry
 * can reclaim an expired lease only for the same receipt set; no transaction spans object-storage I/O.
 */
export async function claimUploadFinalize(
  prisma: PrismaClient,
  identity: SessionIdentity,
  now: Date,
  leaseMs = 120_000,
): Promise<FinalizeClaim> {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 600_000)
    throw new UploadStorageError('UPLOAD_INVALID', 'Invalid finalize lease');
  return withTransaction(
    prisma,
    async (tx) => {
      const row = await tx.uploadSession.findFirst({
        where: { id: identity.sessionId, tenantId: identity.tenantId, ownerUserId: identity.ownerUserId },
      });
      if (!row) throw new UploadStorageError('UPLOAD_NOT_FOUND', 'Upload session not found');
      if (row.expiresAt <= now) throw new UploadStorageError('UPLOAD_EXPIRED', 'Upload session expired');
      const claimed = await tx.uploadSession.updateMany({
        where: {
          id: identity.sessionId,
          tenantId: identity.tenantId,
          ownerUserId: identity.ownerUserId,
          rowVersion: row.rowVersion,
          expiresAt: { gt: now },
          OR: [{ status: 'OPEN' }, { status: 'FINALIZING', finalizeLeaseUntil: { lte: now } }],
        },
        data: {
          status: 'FINALIZING',
          finalizeLeaseUntil: new Date(now.getTime() + leaseMs),
          // Replaced with the actual receipt-set hash below before this transaction commits.
          finalizePartsSha256: row.finalizePartsSha256 ?? '0'.repeat(64),
          rowVersion: { increment: 1 },
          updatedAt: now,
          updatedByUserId: identity.ownerUserId,
        },
      });
      if (claimed.count !== 1) throw new UploadStorageError('UPLOAD_CONFLICT', 'Finalize already claimed');
      const session: UploadStorageSession = {
        sessionId: row.id,
        key: row.storageKey,
        contentType: row.contentType,
        sizeBytes: Number(row.expectedSizeBytes),
        sha256: row.expectedSha256,
        partSizeBytes: row.partSizeBytes,
        expiresAt: row.expiresAt,
      };
      const partRows = await tx.uploadSessionPart.findMany({
        where: { tenantId: identity.tenantId, uploadSessionId: identity.sessionId },
        orderBy: { partNumber: 'asc' },
      });
      const parts = partRows.map((part) => ({
        partNumber: part.partNumber,
        sizeBytes: part.sizeBytes,
        sha256: part.sha256,
      }));
      assertUploadParts(session, parts);
      const partsSha256 = createHash('sha256')
        .update(JSON.stringify(parts.map((part) => [part.partNumber, part.sizeBytes, part.sha256])))
        .digest('hex');
      if (row.finalizePartsSha256 && row.finalizePartsSha256 !== partsSha256)
        throw new UploadStorageError('UPLOAD_CONFLICT', 'Finalize receipts changed');
      await tx.uploadSession.update({
        where: { id: identity.sessionId },
        data: { finalizePartsSha256: partsSha256 },
      });
      return { session, parts, partsSha256 };
    },
    { context: 'upload-finalize-claim' },
  );
}
