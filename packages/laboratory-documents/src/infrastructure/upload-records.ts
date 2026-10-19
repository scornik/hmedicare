import { createHash } from 'node:crypto';
import { type PrismaClient, withTransaction } from '@hmedic/database';
import {
  assertUploadParts,
  type ProxiedUploadStoragePort,
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
      await tx.document.updateMany({
        where: { id: session.documentId, tenantId: identity.tenantId, status: 'CREATED' },
        data: {
          status: 'UPLOADING',
          updatedAt: now,
          updatedByUserId: identity.ownerUserId,
          rowVersion: { increment: 1 },
        },
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
 * Abort only an OPEN session. The status and document transition commit before storage cleanup, so a
 * failed cleanup can be retried safely; FINALIZING and FINALIZED can never be removed by this path.
 */
export async function abortUploadRecord(
  prisma: PrismaClient,
  storage: ProxiedUploadStoragePort,
  identity: SessionIdentity,
  now: Date,
): Promise<void> {
  const session = await withTransaction(
    prisma,
    async (tx) => {
      const row = await tx.uploadSession.findFirst({
        where: { id: identity.sessionId, tenantId: identity.tenantId, ownerUserId: identity.ownerUserId },
      });
      if (!row) throw new UploadStorageError('UPLOAD_NOT_FOUND', 'Upload session not found');
      if (row.storageAdapter !== 'disk')
        throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload adapter mismatch');
      if (row.status !== 'OPEN' && row.status !== 'ABORTED')
        throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload session cannot be aborted');
      if (row.status === 'OPEN') {
        const updated = await tx.uploadSession.updateMany({
          where: { id: row.id, tenantId: row.tenantId, status: 'OPEN', rowVersion: row.rowVersion },
          data: {
            status: 'ABORTED',
            updatedAt: now,
            updatedByUserId: identity.ownerUserId,
            rowVersion: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload session changed');
        await tx.document.updateMany({
          where: { id: row.documentId, tenantId: row.tenantId, status: { in: ['CREATED', 'UPLOADING'] } },
          data: {
            status: 'EXPIRED',
            updatedAt: now,
            updatedByUserId: identity.ownerUserId,
            rowVersion: { increment: 1 },
          },
        });
      }
      return {
        sessionId: row.id,
        key: row.storageKey,
        contentType: row.contentType,
        sizeBytes: Number(row.expectedSizeBytes),
        sha256: row.expectedSha256,
        partSizeBytes: row.partSizeBytes,
        expiresAt: row.expiresAt,
      } satisfies UploadStorageSession;
    },
    { context: 'abort-upload-session' },
  );
  await storage.abortUpload(session);
  await prisma.uploadSession.updateMany({
    where: {
      id: identity.sessionId,
      tenantId: identity.tenantId,
      status: 'ABORTED',
      cleanupCompletedAt: null,
    },
    data: { cleanupCompletedAt: now, updatedAt: now },
  });
}

/** Expire one known session before removing its private parts. An EXPIRED retry repeats storage cleanup. */
export async function expireUploadSession(
  prisma: PrismaClient,
  storage: ProxiedUploadStoragePort,
  identity: { tenantId: string; sessionId: string },
  now: Date,
): Promise<void> {
  const session = await withTransaction(
    prisma,
    async (tx) => {
      const row = await tx.uploadSession.findFirst({
        where: { id: identity.sessionId, tenantId: identity.tenantId },
      });
      if (!row) throw new UploadStorageError('UPLOAD_NOT_FOUND', 'Upload session not found');
      if (row.expiresAt > now)
        throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload session has not expired');
      if (row.status !== 'OPEN' && row.status !== 'EXPIRED')
        throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload session cannot expire');
      if (row.storageAdapter !== 'disk')
        throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload adapter mismatch');
      if (row.status === 'OPEN') {
        const expired = await tx.uploadSession.updateMany({
          where: {
            id: row.id,
            tenantId: row.tenantId,
            status: 'OPEN',
            rowVersion: row.rowVersion,
            expiresAt: { lte: now },
          },
          data: {
            status: 'EXPIRED',
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });
        if (expired.count !== 1) throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload session changed');
        await tx.document.updateMany({
          where: { id: row.documentId, tenantId: row.tenantId, status: { in: ['CREATED', 'UPLOADING'] } },
          data: { status: 'EXPIRED', updatedAt: now, rowVersion: { increment: 1 } },
        });
      }
      return {
        sessionId: row.id,
        key: row.storageKey,
        contentType: row.contentType,
        sizeBytes: Number(row.expectedSizeBytes),
        sha256: row.expectedSha256,
        partSizeBytes: row.partSizeBytes,
        expiresAt: row.expiresAt,
      } satisfies UploadStorageSession;
    },
    { context: 'expire-upload-session' },
  );
  await storage.abortUpload(session);
  await prisma.uploadSession.updateMany({
    where: {
      id: identity.sessionId,
      tenantId: identity.tenantId,
      status: 'EXPIRED',
      cleanupCompletedAt: null,
    },
    data: { cleanupCompletedAt: now, updatedAt: now },
  });
}

/** Bounded maintenance page; failed rows retain a null cleanup marker for a later retry. */
export async function sweepUploadCleanup(
  prisma: PrismaClient,
  storage: ProxiedUploadStoragePort,
  now: Date,
  limit = 100,
  afterId?: string,
): Promise<{ attempted: number; cleaned: number; failed: number; nextCursor: string | null }> {
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new UploadStorageError('UPLOAD_INVALID', 'Invalid cleanup sweep');
  const rows = await prisma.uploadSession.findMany({
    where: {
      ...(afterId ? { id: { gt: afterId } } : {}),
      cleanupCompletedAt: null,
      OR: [{ status: 'OPEN', expiresAt: { lte: now } }, { status: 'EXPIRED' }, { status: 'ABORTED' }],
    },
    select: { id: true, tenantId: true, ownerUserId: true, status: true },
    orderBy: { id: 'asc' },
    take: limit,
  });
  let cleaned = 0;
  for (const row of rows) {
    try {
      if (row.status === 'ABORTED')
        await abortUploadRecord(
          prisma,
          storage,
          {
            tenantId: row.tenantId,
            sessionId: row.id,
            ownerUserId: row.ownerUserId,
          },
          now,
        );
      else await expireUploadSession(prisma, storage, { tenantId: row.tenantId, sessionId: row.id }, now);
      cleaned++;
    } catch {
      // The row stays eligible. A later sweep can retry without exposing private bytes.
    }
  }
  return {
    attempted: rows.length,
    cleaned,
    failed: rows.length - cleaned,
    nextCursor: rows.length === limit ? rows[rows.length - 1]!.id : null,
  };
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
