import type * as mariadb from 'mariadb';
import { type Clock, systemClock } from '@hmedic/kernel';
import {
  type NamedLock,
  type PrismaClient,
  acquireNamedLock,
  acquireSingletonLease,
  openLockConnection,
  releaseSingletonLease,
} from '@hmedic/database';
import type { Logger, Metrics } from '@hmedic/observability';
import type { JobRunner } from './runner';
import type { OutboxPublisher } from './outbox';
import type { MaintenanceScheduler } from './maintenance';

/**
 * Runner modes (ADR-015 §7): `worker` (continuous loop in apps/worker kept warm by cron), `embedded`
 * (same loop inside apps/api), `cron` (no loop; each /internal/jobs/run call processes a bounded batch),
 * `off`. Every mode holds the singleton `GET_LOCK('hmedic:job-runner:<env>:<group>')`; the fallback is a
 * `singleton_locks` lease when GET_LOCK is unavailable (HOST-004).
 */
export interface RunnerLoopOptions {
  databaseUrl: string;
  env: string;
  group?: string;
  maxConcurrency: number;
  pollIntervalMs: number;
  pollMaxIntervalMs: number;
  lockStrategy?: 'named_lock' | 'singleton_lease';
  clock?: Clock;
  logger?: Logger;
  metrics?: Metrics;
  mode: 'worker' | 'embedded' | 'cron';
}

export interface BatchResult {
  skipped?: 'runner_active';
  claimed: number;
  succeeded: number;
  failed: number;
  published: number;
  maintenance: number;
  durationMs: number;
}

class Singleton {
  private conn: mariadb.Connection | null = null;
  private lock: NamedLock | null = null;
  private leaseHeld = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly opts: RunnerLoopOptions,
    private readonly holder: string,
  ) {}

  get name(): string {
    return `hmedic:job-runner:${this.opts.env}:${this.opts.group ?? 'default'}`;
  }

  async tryAcquire(): Promise<boolean> {
    if (this.opts.lockStrategy === 'singleton_lease') {
      this.leaseHeld = await acquireSingletonLease(this.prisma, this.name, this.holder, 45);
      return this.leaseHeld;
    }
    if (this.lock && (await this.lock.isHeld())) return true;
    if (!this.conn) this.conn = await openLockConnection(this.opts.databaseUrl);
    this.lock = await acquireNamedLock(this.conn, this.name, 0);
    return this.lock !== null;
  }

  async release(): Promise<void> {
    if (this.opts.lockStrategy === 'singleton_lease') {
      if (this.leaseHeld) await releaseSingletonLease(this.prisma, this.name, this.holder);
      this.leaseHeld = false;
      return;
    }
    try {
      await this.lock?.release();
    } finally {
      this.lock = null;
      await this.conn?.end().catch(() => undefined);
      this.conn = null;
    }
  }
}

export class RunnerLoop {
  private running = false;
  private stopRequested = false;
  private loopPromise: Promise<void> | null = null;
  private readonly singleton: Singleton;
  private readonly clock: Clock;
  private batchInFlight = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly runner: JobRunner,
    private readonly publisher: OutboxPublisher | null,
    private readonly maintenance: MaintenanceScheduler | null,
    private readonly opts: RunnerLoopOptions,
  ) {
    this.singleton = new Singleton(prisma, opts, runner.runnerId);
    this.clock = opts.clock ?? systemClock;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Starts the continuous loop (worker/embedded). Returns immediately. */
  start(): void {
    if (this.opts.mode === 'cron' || this.running) return;
    this.running = true;
    this.stopRequested = false;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    await this.loopPromise;
    this.running = false;
  }

  private async loop(): Promise<void> {
    let idleDelay = this.opts.pollIntervalMs;
    while (!this.stopRequested) {
      let didWork = false;
      try {
        if (await this.singleton.tryAcquire()) {
          const r = await this.tick(this.opts.maxConcurrency, Number.POSITIVE_INFINITY);
          didWork = r.claimed + r.published > 0;
          this.opts.metrics?.runnerHeartbeat.set({ mode: this.opts.mode }, Date.now() / 1000);
        }
      } catch (error) {
        this.opts.logger?.error({ err: error }, 'job runner loop iteration failed');
      }
      idleDelay = didWork
        ? this.opts.pollIntervalMs
        : Math.min(this.opts.pollMaxIntervalMs, Math.round(idleDelay * 1.5));
      if (!didWork) await new Promise((r) => setTimeout(r, idleDelay));
    }
    await this.singleton.release().catch(() => undefined);
  }

  /**
   * One bounded batch for /internal/jobs/run (every mode). In worker/embedded mode the loop usually holds
   * the singleton, so the call returns `{skipped: 'runner_active'}` after having woken the process.
   */
  async runCronBatch(maxJobs: number, timeBudgetSeconds: number): Promise<BatchResult> {
    const started = Date.now();
    if (this.batchInFlight || (this.running && this.opts.mode !== 'cron')) {
      return {
        skipped: 'runner_active',
        claimed: 0,
        succeeded: 0,
        failed: 0,
        published: 0,
        maintenance: 0,
        durationMs: 0,
      };
    }
    this.batchInFlight = true;
    try {
      if (!(await this.singleton.tryAcquire())) {
        return {
          skipped: 'runner_active',
          claimed: 0,
          succeeded: 0,
          failed: 0,
          published: 0,
          maintenance: 0,
          durationMs: 0,
        };
      }
      try {
        const r = await this.tick(this.opts.maxConcurrency, maxJobs, started + timeBudgetSeconds * 1000);
        this.opts.metrics?.runnerHeartbeat.set({ mode: this.opts.mode }, Date.now() / 1000);
        return { ...r, durationMs: Date.now() - started };
      } finally {
        await this.singleton.release();
      }
    } finally {
      this.batchInFlight = false;
    }
  }

  private async tick(concurrency: number, maxJobs: number, deadline = Number.POSITIVE_INFINITY) {
    const result = { claimed: 0, succeeded: 0, failed: 0, published: 0, maintenance: 0 };
    if (this.maintenance) result.maintenance = await this.maintenance.schedule(this.clock.now());
    await this.runner.housekeeping();
    if (this.publisher) {
      while (Date.now() < deadline) {
        const n = await this.publisher.publishBatch(50);
        result.published += n;
        if (n < 50) break;
      }
    }
    for (const queue of this.runner.handledQueues()) {
      while (result.claimed < maxJobs && Date.now() < deadline) {
        const limit = Math.min(concurrency, maxJobs - result.claimed);
        const jobs = await this.runner.claim(queue, limit);
        if (jobs.length === 0) break;
        result.claimed += jobs.length;
        const outcomes = await Promise.all(jobs.map((j) => this.runner.execute(j)));
        for (const o of outcomes) {
          if (o === 'SUCCEEDED') result.succeeded++;
          else result.failed++;
        }
      }
    }
    return result;
  }
}
