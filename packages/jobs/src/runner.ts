import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { type Clock, newId, systemClock } from '@hmedic/kernel';
import {
  type ClaimedJobRow,
  type PrismaClient,
  claimJobsConditional,
  claimJobsSkipLocked,
  extendJobLease,
  reclaimExpiredJobs,
  releaseConcurrencySlot,
  withTransaction,
} from '@hmedic/database';
import type { Logger, Metrics } from '@hmedic/observability';
import { runWithLogContext } from '@hmedic/observability';
import { DEFAULT_LEASE_SECONDS, type JobRegistry, backoffDelayMs } from './job-types';
import { NonRetryableJobError, RateLimitedJobError, errorClassOf } from './errors';

export interface JobContext<P = Record<string, unknown>> {
  readonly jobId: string;
  readonly tenantId: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly attempt: number;
  readonly payload: P;
  /** Aborted when the lease is lost; handlers should stop external work. */
  readonly signal: AbortSignal;
}

export type JobHandler<P = Record<string, unknown>> = (ctx: JobContext<P>) => Promise<void>;

export interface RunnerOptions {
  strategy: 'skip_locked' | 'conditional_update';
  app: string;
  clock?: Clock;
  logger?: Logger;
  metrics?: Metrics;
  /** Max RUNNING jobs per concurrency key (ADR-015 §4); default 1. */
  concurrencyLimitFor?: (concurrencyKey: string) => number;
  /** Upper bound of the total rate-limit wait per job (seconds). */
  maxRateLimitWaitSeconds?: number;
}

export type JobOutcome = 'SUCCEEDED' | 'RETRY' | 'DEAD' | 'WAITING_RATE_LIMIT' | 'LEASE_LOST';

/**
 * Executes claimed jobs (ADR-015 §3, §6). Completion and failure transitions are conditional on the
 * runner still holding the lease (`locked_by`), so a runner that lost its lease discards its result.
 */
export class JobRunner {
  readonly runnerId: string;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly clock: Clock;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: JobRegistry,
    private readonly options: RunnerOptions,
  ) {
    this.clock = options.clock ?? systemClock;
    this.runnerId = `${options.app}:${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`.slice(
      0,
      128,
    );
  }

  handle<P>(type: string, handler: JobHandler<P>): this {
    this.registry.require(type);
    if (this.handlers.has(type)) throw new Error(`handler for ${type} registered twice`);
    this.handlers.set(type, handler as JobHandler);
    return this;
  }

  hasHandler(type: string): boolean {
    return this.handlers.has(type);
  }

  handledQueues(): string[] {
    return [...new Set([...this.handlers.keys()].map((t) => this.registry.require(t).queue))].sort();
  }

  async claim(queue: string, limit: number): Promise<ClaimedJobRow[]> {
    // The claim lease covers the longest-running type on the queue; the heartbeat keeps it alive.
    const leases = this.registry
      .all()
      .filter((d) => d.queue === queue)
      .map((d) => d.leaseSeconds ?? DEFAULT_LEASE_SECONDS);
    const leaseSeconds = leases.length ? Math.max(...leases) : DEFAULT_LEASE_SECONDS;
    const req = {
      queue,
      limit,
      lockedBy: this.runnerId,
      leaseSeconds,
      now: this.clock.now(),
      concurrencyLimit: (key: string) => this.options.concurrencyLimitFor?.(key) ?? 1,
    };
    const rows =
      this.options.strategy === 'skip_locked'
        ? await claimJobsSkipLocked(this.prisma, req)
        : await claimJobsConditional(this.prisma, req);
    for (const r of rows) this.options.metrics?.jobsClaimed.inc({ queue: r.queue, type: r.type });
    return rows;
  }

  /** Housekeeping: reclaim expired leases and release elapsed rate-limit waits. */
  async housekeeping(): Promise<{ reclaimed: number; released: number }> {
    const now = this.clock.now();
    const reclaimed = await reclaimExpiredJobs(this.prisma, now);
    const released = await this.prisma.job.updateMany({
      where: { status: 'WAITING_RATE_LIMIT', runAt: { lte: now } },
      data: { status: 'QUEUED', updatedAt: now },
    });
    return { reclaimed, released: released.count };
  }

  async execute(job: ClaimedJobRow): Promise<JobOutcome> {
    const def = this.registry.get(job.type);
    const handler = this.handlers.get(job.type);
    const controller = new AbortController();
    const leaseSeconds = def?.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    const heartbeat = setInterval(
      () => {
        void extendJobLease(this.prisma, job.id, this.runnerId, this.clock.now(), leaseSeconds).then(
          (held) => {
            if (!held) controller.abort();
          },
        );
      },
      Math.max(1_000, (leaseSeconds * 1000) / 2),
    );
    heartbeat.unref();
    return runWithLogContext({ jobId: job.id, correlationId: job.correlationId }, async () => {
      try {
        if (!def || !handler) throw new NonRetryableJobError('JOB_TYPE_UNSUPPORTED');
        const parsed = def.payloadSchema.safeParse(job.payload);
        if (!parsed.success) throw new NonRetryableJobError('JOB_PAYLOAD_UNSUPPORTED');
        await handler({
          jobId: job.id,
          tenantId: job.tenantId,
          correlationId: job.correlationId,
          causationId: job.causationId,
          attempt: job.attempts,
          payload: parsed.data as Record<string, unknown>,
          signal: controller.signal,
        });
        return await this.complete(job);
      } catch (error) {
        return await this.fail(job, error);
      } finally {
        clearInterval(heartbeat);
      }
    });
  }

  private async complete(job: ClaimedJobRow): Promise<JobOutcome> {
    const now = this.clock.now();
    const updated = await withTransaction(this.prisma, async (tx) => {
      const r = await tx.job.updateMany({
        where: { id: job.id, lockedBy: this.runnerId, status: 'RUNNING' },
        data: { status: 'SUCCEEDED', finishedAt: now, updatedAt: now, lockedBy: null, leaseExpiresAt: null },
      });
      if (r.count === 1) await releaseConcurrencySlot(tx, job.id);
      return r.count;
    });
    if (updated !== 1) {
      this.options.logger?.warn(
        { jobId: job.id, jobType: job.type },
        'job completed after its lease was lost; result discarded',
      );
      return 'LEASE_LOST';
    }
    this.options.metrics?.jobsCompleted.inc({ queue: job.queue, type: job.type });
    return 'SUCCEEDED';
  }

  private async fail(job: ClaimedJobRow, error: unknown): Promise<JobOutcome> {
    const now = this.clock.now();
    const errorClass = errorClassOf(error);
    const def = this.registry.get(job.type);
    const holder = { id: job.id, lockedBy: this.runnerId, status: 'RUNNING' };

    if (error instanceof RateLimitedJobError) {
      const outcome = await withTransaction(this.prisma, async (tx) => {
        const current = await tx.job.findFirst({ where: holder, select: { createdAt: true } });
        if (!current) return 'LEASE_LOST' as const;
        const waited = (error.retryAt.getTime() - current.createdAt.getTime()) / 1000;
        if (waited > (this.options.maxRateLimitWaitSeconds ?? 900)) return 'DEAD_BY_WAIT' as const;
        await tx.job.updateMany({
          where: holder,
          data: {
            status: 'WAITING_RATE_LIMIT',
            runAt: error.retryAt,
            attempts: { decrement: 1 },
            lastErrorClass: 'RATE_LIMITED',
            lockedBy: null,
            leaseExpiresAt: null,
            updatedAt: now,
          },
        });
        await releaseConcurrencySlot(tx, job.id);
        return 'WAITING_RATE_LIMIT' as const;
      });
      if (outcome !== 'DEAD_BY_WAIT') return outcome;
      return this.deadLetter(job, 'RATE_LIMITED', now);
    }

    const nonRetryable = error instanceof NonRetryableJobError;
    this.options.metrics?.jobsFailed.inc({ queue: job.queue, type: job.type, error_class: errorClass });
    if (nonRetryable || job.attempts >= job.maxAttempts) return this.deadLetter(job, errorClass, now);

    const runAt = new Date(now.getTime() + backoffDelayMs(job.attempts, def?.backoff));
    const updated = await withTransaction(this.prisma, async (tx) => {
      const r = await tx.job.updateMany({
        where: holder,
        data: {
          status: 'QUEUED',
          runAt,
          lastErrorClass: errorClass,
          lockedBy: null,
          leaseExpiresAt: null,
          updatedAt: now,
        },
      });
      if (r.count === 1) await releaseConcurrencySlot(tx, job.id);
      return r.count;
    });
    this.options.logger?.warn(
      { jobId: job.id, jobType: job.type, errorClass, attempt: job.attempts },
      'job attempt failed',
    );
    return updated === 1 ? 'RETRY' : 'LEASE_LOST';
  }

  private async deadLetter(job: ClaimedJobRow, errorClass: string, now: Date): Promise<JobOutcome> {
    const moved = await withTransaction(this.prisma, async (tx) => {
      const r = await tx.job.updateMany({
        where: { id: job.id, lockedBy: this.runnerId, status: 'RUNNING' },
        data: {
          status: 'DEAD',
          lastErrorClass: errorClass,
          finishedAt: now,
          lockedBy: null,
          leaseExpiresAt: null,
          updatedAt: now,
        },
      });
      if (r.count !== 1) return false;
      await releaseConcurrencySlot(tx, job.id);
      await tx.deadLetter.create({
        data: {
          id: newId(),
          jobId: job.id,
          tenantId: job.tenantId,
          queue: job.queue,
          type: job.type,
          payload: job.payload as never,
          attempts: job.attempts,
          lastErrorClass: errorClass,
          failedAt: now,
        },
      });
      return true;
    });
    if (!moved) return 'LEASE_LOST';
    this.options.metrics?.jobsDead.inc({ queue: job.queue, type: job.type, error_class: errorClass });
    this.options.logger?.error({ jobId: job.id, jobType: job.type, errorClass }, 'job moved to dead letters');
    return 'DEAD';
  }
}
