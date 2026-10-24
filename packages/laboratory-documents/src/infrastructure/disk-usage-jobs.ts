import { lstat, readdir, statfs } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@hmedic/database';
import { type JobRegistry, type JobRunner, type PeriodicJob } from '@hmedic/jobs';
import { z } from 'zod';

export const DISK_USAGE_CHECK = 'DiskUsageCheck';
const GIB = 1024n ** 3n;

/** Count private files without following a symlink out of the storage root. */
export async function storageRootBytes(root: string, signal?: AbortSignal): Promise<bigint> {
  if ((await lstat(root)).isSymbolicLink()) throw new Error('STORAGE_ROOT_SYMLINK');
  const pending = [root];
  let total = 0n;
  while (pending.length) {
    if (signal?.aborted) throw new Error('DISK_USAGE_CHECK_ABORTED');
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (signal?.aborted) throw new Error('DISK_USAGE_CHECK_ABORTED');
      const name = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('STORAGE_ROOT_CONTAINS_SYMLINK');
      if (entry.isDirectory()) pending.push(name);
      else if (entry.isFile()) total += BigInt((await lstat(name)).size);
      else throw new Error('STORAGE_ROOT_CONTAINS_SPECIAL_FILE');
    }
  }
  return total;
}

export interface DiskUsageSnapshot {
  rootBytes: bigint;
  indexedDocumentBytes: bigint;
  volumeBytes: bigint;
  availableBytes: bigint;
}

export async function collectDiskUsage(
  prisma: PrismaClient,
  root: string,
  signal?: AbortSignal,
): Promise<DiskUsageSnapshot> {
  const [rootBytes, volume, indexed] = await Promise.all([
    storageRootBytes(root, signal),
    statfs(root, { bigint: true }),
    prisma.documentVersion.aggregate({
      where: { storageAdapter: 'disk' },
      _sum: { sizeBytes: true },
    }),
  ]);
  return {
    rootBytes,
    indexedDocumentBytes: indexed._sum.sizeBytes ?? 0n,
    volumeBytes: volume.blocks * volume.bsize,
    availableBytes: volume.bavail * volume.bsize,
  };
}

export function assessDiskUsage(snapshot: DiskUsageSnapshot, budgetGb: number) {
  const budgetBytes = BigInt(budgetGb) * GIB;
  const budgetPercent = Number((snapshot.rootBytes * 100n) / budgetBytes);
  const volumePercent =
    snapshot.volumeBytes > 0n
      ? Number(((snapshot.volumeBytes - snapshot.availableBytes) * 100n) / snapshot.volumeBytes)
      : 100;
  return {
    budgetBytes,
    budgetPercent,
    volumePercent,
    level: budgetPercent >= 75 || volumePercent >= 80 ? 'critical' : budgetPercent >= 60 ? 'warning' : 'ok',
  } as const;
}

interface DiskUsageLogger {
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export function registerDiskUsageJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  deps: {
    prisma: PrismaClient;
    root: string;
    budgetGb: number;
    logger: DiskUsageLogger;
  },
): PeriodicJob[] {
  registry.register({
    type: DISK_USAGE_CHECK,
    queue: 'maintenance',
    payloadSchema: z.object({ v: z.literal(1), window: z.number().int() }).strict(),
    maxAttempts: 3,
    leaseSeconds: 600,
    priority: 210,
  });
  runner?.handle(DISK_USAGE_CHECK, async (ctx) => {
    try {
      const snapshot = await collectDiskUsage(deps.prisma, deps.root, ctx.signal);
      if (ctx.signal.aborted) throw new Error('DISK_USAGE_CHECK_ABORTED');
      const assessment = assessDiskUsage(snapshot, deps.budgetGb);
      if (assessment.level === 'ok') return;
      const fields = {
        alert: true,
        rootBytes: snapshot.rootBytes.toString(),
        indexedDocumentBytes: snapshot.indexedDocumentBytes.toString(),
        availableBytes: snapshot.availableBytes.toString(),
        budgetPercent: assessment.budgetPercent,
        volumePercent: assessment.volumePercent,
      };
      if (assessment.level === 'critical') deps.logger.error(fields, 'private storage disk usage critical');
      else deps.logger.warn(fields, 'private storage disk usage warning');
    } catch (error) {
      deps.logger.error({ alert: true, err: error }, 'private storage disk usage check failed');
      throw error;
    }
  });
  return [{ type: DISK_USAGE_CHECK, everyMs: 60 * 60_000 }];
}
