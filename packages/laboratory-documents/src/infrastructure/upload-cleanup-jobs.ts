import type { PrismaClient } from '@hmedic/database';
import { type JobRegistry, type JobRunner, type PeriodicJob } from '@hmedic/jobs';
import { z } from 'zod';
import type { ProxiedUploadStoragePort } from '../application/upload-storage-port';
import { sweepUploadCleanup } from './upload-records';

export const CLEANUP_UPLOAD_SESSIONS = 'CleanupUploadSessions';

/** Bounded worker run. Completed rows fall out of the query, so the next window continues progress. */
export async function runUploadCleanup(
  prisma: PrismaClient,
  storage: ProxiedUploadStoragePort,
  now: Date,
  signal?: AbortSignal,
): Promise<{ attempted: number; cleaned: number; failed: number }> {
  let cursor: string | undefined;
  const total = { attempted: 0, cleaned: 0, failed: 0 };
  for (let page = 0; page < 10 && !signal?.aborted; page++) {
    const result = await sweepUploadCleanup(prisma, storage, now, 100, cursor);
    total.attempted += result.attempted;
    total.cleaned += result.cleaned;
    total.failed += result.failed;
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return total;
}

export function registerUploadCleanupJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  deps: { prisma: PrismaClient; storage: ProxiedUploadStoragePort; now?: () => Date },
): PeriodicJob[] {
  registry.register({
    type: CLEANUP_UPLOAD_SESSIONS,
    queue: 'maintenance',
    payloadSchema: z.object({ v: z.literal(1), window: z.number().int() }).strict(),
    maxAttempts: 3,
    leaseSeconds: 120,
    priority: 200,
  });
  runner?.handle(CLEANUP_UPLOAD_SESSIONS, async (ctx) => {
    const result = await runUploadCleanup(
      deps.prisma,
      deps.storage,
      (deps.now ?? (() => new Date()))(),
      ctx.signal,
    );
    if (ctx.signal.aborted || result.failed > 0) throw new Error('UPLOAD_CLEANUP_FAILED');
  });
  return [{ type: CLEANUP_UPLOAD_SESSIONS, everyMs: 10 * 60_000 }];
}
