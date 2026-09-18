import { z } from 'zod';
import { type Clock, newId, systemClock } from '@hmedic/kernel';
import {
  type PrismaClient,
  type RetentionConfig,
  RETENTION_RULES,
  type RetentionRule,
  deleteExpiredBatch,
} from '@hmedic/database';
import type { Logger } from '@hmedic/observability';
import type { JobRegistry } from './job-types';
import type { JobRunner } from './runner';

/**
 * Maintenance (ADR-015 §8, DATABASE-IMPLEMENTATION.md §5). The scheduler enqueues periodic maintenance jobs
 * with idempotency key `<type>:<window>` so every window runs exactly once across all runners.
 */
export const MAINTENANCE_QUEUE = 'maintenance';
export const MAINTENANCE_TTL_CLEANUP = 'MaintenanceTtlCleanup';

export interface PeriodicJob {
  type: string;
  everyMs: number;
}

export class MaintenanceScheduler {
  private lastScheduledWindow = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly periodic: readonly PeriodicJob[],
    private readonly registry: JobRegistry,
  ) {}

  /** Enqueues the periodic jobs due for the current window. Returns the number newly enqueued. */
  async schedule(now: Date): Promise<number> {
    let created = 0;
    for (const p of this.periodic) {
      const window = Math.floor(now.getTime() / p.everyMs);
      if (this.lastScheduledWindow.get(p.type) === window) continue;
      const def = this.registry.require(p.type);
      const result = await this.prisma.job.createMany({
        data: [
          {
            id: newId(),
            queue: def.queue,
            type: def.type,
            payload: { v: 1, window } as never,
            status: 'QUEUED',
            priority: def.priority ?? 200,
            runAt: now,
            attempts: 0,
            maxAttempts: def.maxAttempts ?? 3,
            idempotencyKey: `${p.type}:${window}`,
            correlationId: newId(),
            createdAt: now,
            updatedAt: now,
          },
        ],
        skipDuplicates: true,
      });
      created += result.count;
      this.lastScheduledWindow.set(p.type, window);
    }
    return created;
  }
}

/** Deletes expired rows in bounded batches until done or the time budget is spent. */
export async function runTtlCleanup(
  prisma: PrismaClient,
  cfg: RetentionConfig,
  options: { clock?: Clock; timeBudgetMs?: number; batchSize?: number; logger?: Logger } = {},
): Promise<Record<string, number>> {
  const clock = options.clock ?? systemClock;
  const deadline = Date.now() + (options.timeBudgetMs ?? 30_000);
  const counts: Record<string, number> = {};
  for (const rule of Object.keys(RETENTION_RULES) as RetentionRule[]) {
    counts[rule] = 0;
    for (;;) {
      const n = await deleteExpiredBatch(prisma, rule, clock.now(), cfg, options.batchSize ?? 1000);
      counts[rule] += n;
      if (n < (options.batchSize ?? 1000) || Date.now() > deadline) break;
    }
    if (Date.now() > deadline) break;
  }
  options.logger?.info({ counts }, 'ttl cleanup finished');
  return counts;
}

/** Registers the platform maintenance job types and handlers (worker/embedded/cron). */
export function registerMaintenance(
  registry: JobRegistry,
  runner: JobRunner | null,
  prisma: PrismaClient,
  cfg: RetentionConfig,
  options: { clock?: Clock; logger?: Logger } = {},
): PeriodicJob[] {
  registry.register({
    type: MAINTENANCE_TTL_CLEANUP,
    queue: MAINTENANCE_QUEUE,
    payloadSchema: z.object({ v: z.literal(1), window: z.number().int() }),
    maxAttempts: 3,
    leaseSeconds: 120,
    priority: 200,
  });
  runner?.handle(MAINTENANCE_TTL_CLEANUP, async () => {
    await runTtlCleanup(prisma, cfg, { ...options, timeBudgetMs: 45_000 });
  });
  return [{ type: MAINTENANCE_TTL_CLEANUP, everyMs: 10 * 60_000 }];
}
