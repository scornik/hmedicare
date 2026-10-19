import { type PrismaClient, withTransaction } from '@hmedic/database';
import { type JobRegistry, type JobRunner } from '@hmedic/jobs';
import { newId } from '@hmedic/kernel';
import { type MalwareScanPort, UPLOAD_SCAN_CATEGORIES } from '../application/malware-scan-port';
import { UploadStorageError } from '../application/upload-storage-port';
import { buildStorageKey } from '../domain/storage-keys';
import { registerUploadScanJobType, SCAN_UPLOADED_DOCUMENT } from './upload-finalize';

export interface UploadScanIdentity {
  tenantId: string;
  documentId: string;
  versionId: string;
}

/** A scan result is committed only against the exact pending version and document. */
export async function processUploadScan(
  prisma: PrismaClient,
  scanner: MalwareScanPort,
  identity: UploadScanIdentity,
  attempt: number,
  now: Date,
  signal?: AbortSignal,
): Promise<'AVAILABLE' | 'REJECTED' | 'RETRY'> {
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw new UploadStorageError('UPLOAD_INVALID', 'Invalid scan attempt');
  const version = await prisma.documentVersion.findFirst({
    where: { id: identity.versionId, tenantId: identity.tenantId, documentId: identity.documentId },
  });
  const document = await prisma.document.findFirst({
    where: { id: identity.documentId, tenantId: identity.tenantId },
  });
  if (!version || !document) throw new UploadStorageError('UPLOAD_NOT_FOUND', 'Upload version not found');
  if (version.scanStatus !== 'PENDING' && version.scanStatus !== 'ERROR') {
    if (version.scanStatus === 'CLEAN' && document.status === 'AVAILABLE') return 'AVAILABLE';
    if (version.scanStatus === 'REJECTED' && document.status === 'REJECTED') return 'REJECTED';
    throw new UploadStorageError('UPLOAD_CONFLICT', 'Scan version changed');
  }
  if (document.status !== 'SCANNING' && document.status !== 'SCAN_ERROR')
    throw new UploadStorageError('UPLOAD_CONFLICT', 'Scan document changed');
  if (!UPLOAD_SCAN_CATEGORIES.some((category) => category === document.category))
    throw new UploadStorageError('UPLOAD_INVALID', 'Document category cannot be scanned');
  const category = document.category as (typeof UPLOAD_SCAN_CATEGORIES)[number];
  const sanitizedKey = version.contentType.startsWith('image/')
    ? buildStorageKey({
        tenantId: identity.tenantId,
        category,
        documentId: identity.documentId,
        revision: version.revision + 1,
      })
    : undefined;
  const verdict = await scanner
    .scan({
      key: version.storageKey,
      declaredContentType: version.contentType,
      sizeBytes: Number(version.sizeBytes),
      sha256: version.sha256,
      category,
      sanitizedKey,
    })
    .catch(() => ({ result: 'ERROR' as const, reasonCode: 'SCAN_UNAVAILABLE' as const }));
  const adapter = scanner.describe().adapter;
  if (signal?.aborted) throw new UploadStorageError('UPLOAD_CONFLICT', 'Scan lease lost');
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(adapter))
    throw new UploadStorageError('UPLOAD_INVALID', 'Invalid scanner adapter');
  if (verdict.result === 'CLEAN') {
    if (sanitizedKey && !verdict.sanitized)
      throw new UploadStorageError('UPLOAD_CONFLICT', 'Image scan omitted sanitized revision');
    if (!sanitizedKey && verdict.sanitized)
      throw new UploadStorageError('UPLOAD_CONFLICT', 'Unexpected sanitized revision');
    if (
      verdict.sanitized &&
      (verdict.sanitized.key !== sanitizedKey ||
        !Number.isSafeInteger(verdict.sanitized.sizeBytes) ||
        verdict.sanitized.sizeBytes < 1 ||
        !/^[a-f0-9]{64}$/.test(verdict.sanitized.sha256))
    )
      throw new UploadStorageError('UPLOAD_CONFLICT', 'Invalid sanitized object');
  }
  const terminal = verdict.result !== 'ERROR' || attempt >= 3;
  await withTransaction(
    prisma,
    async (tx) => {
      const updated = await tx.documentVersion.updateMany({
        where: {
          id: version.id,
          tenantId: identity.tenantId,
          documentId: identity.documentId,
          rowVersion: version.rowVersion,
          scanStatus: { in: ['PENDING', 'ERROR'] },
        },
        data: {
          scanStatus:
            verdict.result === 'CLEAN'
              ? 'CLEAN'
              : verdict.result === 'REJECTED' || terminal
                ? 'REJECTED'
                : 'ERROR',
          scanAdapter: adapter,
          scanReason: verdict.result === 'CLEAN' ? null : verdict.reasonCode,
          scannedAt: now,
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new UploadStorageError('UPLOAD_CONFLICT', 'Scan version changed');
      let currentRevision = version.revision;
      if (verdict.result === 'CLEAN' && verdict.sanitized) {
        currentRevision++;
        await tx.documentVersion.create({
          data: {
            id: newId(),
            tenantId: identity.tenantId,
            documentId: identity.documentId,
            revision: currentRevision,
            storageAdapter: version.storageAdapter,
            storageKey: verdict.sanitized.key,
            contentType: version.contentType,
            sizeBytes: BigInt(verdict.sanitized.sizeBytes),
            sha256: verdict.sanitized.sha256,
            scanStatus: 'CLEAN',
            scanAdapter: adapter,
            scannedAt: now,
            derivedFromRevision: version.revision,
            uploadedByUserId: version.uploadedByUserId,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      const moved = await tx.document.updateMany({
        where: {
          id: identity.documentId,
          tenantId: identity.tenantId,
          rowVersion: document.rowVersion,
          status: { in: ['SCANNING', 'SCAN_ERROR'] },
        },
        data: {
          status:
            verdict.result === 'CLEAN'
              ? 'AVAILABLE'
              : verdict.result === 'REJECTED' || terminal
                ? 'REJECTED'
                : 'SCAN_ERROR',
          currentRevision: verdict.result === 'CLEAN' ? currentRevision : null,
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      if (moved.count !== 1) throw new UploadStorageError('UPLOAD_CONFLICT', 'Scan document changed');
    },
    { context: 'upload-scan-result' },
  );
  return verdict.result === 'CLEAN'
    ? 'AVAILABLE'
    : verdict.result === 'REJECTED' || terminal
      ? 'REJECTED'
      : 'RETRY';
}

/** Register the same payload contract in API and worker; only a worker receives a handler. */
export function registerUploadScanJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  deps: { prisma: PrismaClient; scanner?: MalwareScanPort; now?: () => Date },
): void {
  registerUploadScanJobType(registry);
  if (!runner) return;
  if (!deps.scanner) throw new Error('Upload scanner is required by the worker');
  const scanner = deps.scanner;
  runner.handle(SCAN_UPLOADED_DOCUMENT, async (ctx) => {
    const payload = ctx.payload as { v: 1; tenantId: string; documentId: string; versionId: string };
    const outcome = await processUploadScan(
      deps.prisma,
      scanner,
      payload,
      ctx.attempt,
      (deps.now ?? (() => new Date()))(),
      ctx.signal,
    );
    if (outcome === 'RETRY') throw new Error('SCAN_UNAVAILABLE');
  });
}
