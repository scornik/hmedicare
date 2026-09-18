import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, FixedClock, newId } from '@hmedic/kernel';
import { type Database, withTransaction } from '@hmedic/database';
import {
  IdempotencyStore,
  JobPort,
  JobRegistry,
  JobRunner,
  MaintenanceScheduler,
  NonRetryableJobError,
  OutboxPort,
  OutboxPublisher,
  RateLimitedJobError,
  RateLimiter,
  RunnerLoop,
  SubscriptionRegistry,
  registerMaintenance,
  requestHash,
  runTtlCleanup,
} from '../../src/index';
import { openTestDatabase, testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

// JOB-001…007 + FOUND-013 (ADR-015, TEST-IMPLEMENTATION §3). Runs on mariadb:10.6 and 11.4.
let db: Database;
const RETENTION = { jobRetentionSucceededDays: 14, jobRetentionFailedDays: 30, outboxRetentionDays: 14 };
const payloadSchema = z.object({ v: z.literal(1), n: z.number().int().optional() }).passthrough();

function registry(): JobRegistry {
  return new JobRegistry()
    .register({
      type: 'Probe',
      queue: 'probe',
      payloadSchema,
      maxAttempts: 3,
      leaseSeconds: 30,
      backoff: { baseMs: 10, maxMs: 20 },
    })
    .register({
      type: 'Poison',
      queue: 'probe',
      payloadSchema,
      maxAttempts: 2,
      leaseSeconds: 30,
      backoff: { baseMs: 10, maxMs: 20 },
    })
    .register({ type: 'Limited', queue: 'probe', payloadSchema, maxAttempts: 3, leaseSeconds: 30 });
}

beforeAll(() => {
  db = openTestDatabase({ poolMax: 12 });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

async function enqueueMany(port: JobPort, n: number, type = 'Probe') {
  for (let i = 0; i < n; i++) await port.enqueue({ type, payload: { v: 1, n: i }, correlationId: newId() });
}

describe.each(['skip_locked', 'conditional_update'] as const)('JobRunner (%s)', (strategy) => {
  it('two runners never process the same job', async () => {
    const reg = registry();
    const port = new JobPort(db.prisma, reg);
    await enqueueMany(port, 40);
    const seen: string[] = [];
    const make = () =>
      new JobRunner(db.prisma, reg, { strategy, app: 'test' }).handle('Probe', async (ctx) => {
        seen.push(ctx.jobId);
        await new Promise((r) => setTimeout(r, 2));
      });
    const runners = [make(), make()];
    const drain = async (runner: JobRunner) => {
      for (;;) {
        const jobs = await runner.claim('probe', 5);
        if (!jobs.length) return;
        await Promise.all(jobs.map((j) => runner.execute(j)));
      }
    };
    await Promise.all(runners.map(drain));
    expect(seen).toHaveLength(40);
    expect(new Set(seen).size).toBe(40);
    expect(await db.prisma.job.count({ where: { status: 'SUCCEEDED' } })).toBe(40);
  });

  it("reclaims a crashed runner's expired lease and discards the late result", async () => {
    const clock = new FixedClock(new Date());
    const reg = registry();
    const port = new JobPort(db.prisma, reg, clock);
    await enqueueMany(port, 1);
    const crashed = new JobRunner(db.prisma, reg, { strategy, app: 'crashed', clock });
    const [job] = await crashed.claim('probe', 1);
    expect(job).toBeDefined();
    // The runner dies without completing; the lease (30 s) expires.
    clock.advanceMs(31_000);
    const healthy = new JobRunner(db.prisma, reg, { strategy, app: 'healthy', clock });
    let ran = 0;
    healthy.handle('Probe', async () => {
      ran++;
    });
    expect((await healthy.housekeeping()).reclaimed).toBe(1);
    const [again] = await healthy.claim('probe', 1);
    expect(again?.id).toBe(job!.id);
    expect(again?.attempts).toBe(2);
    expect(await healthy.execute(again!)).toBe('SUCCEEDED');
    expect(ran).toBe(1);
    // The crashed runner comes back and tries to finish: its result is discarded.
    crashed.handle('Probe', async () => undefined);
    expect(await crashed.execute(job!)).toBe('LEASE_LOST');
    expect(await db.prisma.job.findUniqueOrThrow({ where: { id: job!.id } })).toMatchObject({
      status: 'SUCCEEDED',
    });
  });

  it('moves a poison job to dead letters after max attempts, with an error class only', async () => {
    const clock = new FixedClock(new Date());
    const reg = registry();
    const port = new JobPort(db.prisma, reg, clock);
    await enqueueMany(port, 1, 'Poison');
    const runner = new JobRunner(db.prisma, reg, { strategy, app: 'test', clock }).handle(
      'Poison',
      async () => {
        throw new Error('provider said: +8801700000001 rejected');
      },
    );
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++) {
      clock.advanceMs(1_000);
      const jobs = await runner.claim('probe', 1);
      for (const j of jobs) outcomes.push(await runner.execute(j));
    }
    expect(outcomes).toEqual(['RETRY', 'DEAD']);
    const dead = await db.prisma.deadLetter.findMany();
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ type: 'Poison', attempts: 2, lastErrorClass: 'UNHANDLED_ERROR' });
    expect(JSON.stringify(dead[0])).not.toContain('8801700000001');
    expect(await db.prisma.job.count({ where: { status: 'DEAD' } })).toBe(1);
  });

  it('dead-letters non-retryable errors immediately', async () => {
    const reg = registry();
    await new JobPort(db.prisma, reg).enqueue({ type: 'Poison', payload: { v: 1 }, correlationId: newId() });
    const runner = new JobRunner(db.prisma, reg, { strategy, app: 'test' }).handle('Poison', async () => {
      throw new NonRetryableJobError('PROVIDER_REJECTED');
    });
    const [job] = await runner.claim('probe', 1);
    expect(await runner.execute(job!)).toBe('DEAD');
    expect((await db.prisma.deadLetter.findFirstOrThrow()).lastErrorClass).toBe('PROVIDER_REJECTED');
  });

  it('enforces the concurrency key limit', async () => {
    const reg = registry();
    const port = new JobPort(db.prisma, reg);
    for (let i = 0; i < 3; i++) {
      await port.enqueue({
        type: 'Probe',
        payload: { v: 1, n: i },
        concurrencyKey: 'tenant-x:sms',
        correlationId: newId(),
      });
    }
    const runner = new JobRunner(db.prisma, reg, { strategy, app: 'test' });
    const first = await runner.claim('probe', 3);
    expect(first).toHaveLength(1);
    expect(await runner.claim('probe', 3)).toHaveLength(0);
    runner.handle('Probe', async () => undefined);
    await runner.execute(first[0]!);
    expect(await runner.claim('probe', 3)).toHaveLength(1);
  });

  it('parks rate-limited jobs in WAITING_RATE_LIMIT without spending an attempt', async () => {
    const clock = new FixedClock(new Date());
    const reg = registry();
    await new JobPort(db.prisma, reg, clock).enqueue({
      type: 'Limited',
      payload: { v: 1 },
      correlationId: newId(),
    });
    let calls = 0;
    const runner = new JobRunner(db.prisma, reg, { strategy, app: 'test', clock }).handle(
      'Limited',
      async () => {
        calls++;
        if (calls === 1) throw new RateLimitedJobError(new Date(clock.now().getTime() + 60_000));
      },
    );
    const [job] = await runner.claim('probe', 1);
    expect(await runner.execute(job!)).toBe('WAITING_RATE_LIMIT');
    expect(await db.prisma.job.findUniqueOrThrow({ where: { id: job!.id } })).toMatchObject({
      status: 'WAITING_RATE_LIMIT',
      attempts: 0,
    });
    expect(await runner.claim('probe', 1)).toHaveLength(0);
    clock.advanceMs(61_000);
    expect((await runner.housekeeping()).released).toBe(1);
    const [again] = await runner.claim('probe', 1);
    expect(await runner.execute(again!)).toBe('SUCCEEDED');
  });
});

describe('JobPort', () => {
  it('returns the existing job for a duplicate (queue, idempotency key)', async () => {
    const port = new JobPort(db.prisma, registry());
    const a = await port.enqueue({
      type: 'Probe',
      payload: { v: 1 },
      idempotencyKey: 'k-1',
      correlationId: newId(),
    });
    const b = await port.enqueue({
      type: 'Probe',
      payload: { v: 1 },
      idempotencyKey: 'k-1',
      correlationId: newId(),
    });
    expect(a.created).toBe(true);
    expect(b).toEqual({ jobId: a.jobId, created: false });
    expect(await db.prisma.job.count()).toBe(1);
  });

  it('enqueues atomically with the caller transaction', async () => {
    const port = new JobPort(db.prisma, registry());
    await expect(
      withTransaction(db.prisma, async (tx) => {
        await port.enqueue({ type: 'Probe', payload: { v: 1 }, correlationId: newId() }, tx);
        throw new AppError('STALE_VERSION');
      }),
    ).rejects.toThrow();
    expect(await db.prisma.job.count()).toBe(0);
  });
});

describe('Outbox publisher', () => {
  function setup() {
    const reg = registry();
    const subs = new SubscriptionRegistry().subscribe('ProbeHappened', {
      handler: 'Probe',
      orderedByAggregate: true,
    });
    return { reg, subs };
  }

  it('publishes an event exactly once despite publisher restarts and concurrent publishers', async () => {
    const { reg, subs } = setup();
    const outbox = new OutboxPort();
    for (let i = 0; i < 10; i++) {
      await withTransaction(db.prisma, (tx) =>
        outbox.append(tx, {
          tenantId: null,
          eventName: 'ProbeHappened',
          eventVersion: 1,
          aggregateType: 'probe',
          aggregateId: newId(),
          payload: { v: 1 },
          correlationId: newId(),
          causationId: null,
          actorId: null,
          idempotencyKey: null,
        }),
      );
    }
    // Two publishers race, then a "restarted" one runs over the same rows.
    const p1 = new OutboxPublisher(db.prisma, reg, subs, { strategy: 'skip_locked' });
    const p2 = new OutboxPublisher(db.prisma, reg, subs, { strategy: 'conditional_update' });
    await Promise.all([p1.publishBatch(4), p2.publishBatch(4), p1.publishBatch(4)]);
    // Simulate a crash after job creation but before marking published: reset to PENDING.
    await db.prisma.outboxEvent.updateMany({ data: { status: 'PENDING', publishedAt: null } });
    const restarted = new OutboxPublisher(db.prisma, reg, subs, { strategy: 'skip_locked' });
    while ((await restarted.publishBatch(50)) > 0);
    expect(await db.prisma.job.count({ where: { type: 'Probe' } })).toBe(10);
    expect(await db.prisma.outboxEvent.count({ where: { status: 'PUBLISHED' } })).toBe(10);
    const job = await db.prisma.job.findFirstOrThrow();
    expect(job.idempotencyKey).toMatch(/:Probe$/);
    expect(job.concurrencyKey).toMatch(/^Probe:probe:/);
  });

  it('refuses PHI in event payloads', async () => {
    await expect(
      withTransaction(db.prisma, (tx) =>
        new OutboxPort().append(tx, {
          tenantId: null,
          eventName: 'ProbeHappened',
          eventVersion: 1,
          aggregateType: 'probe',
          aggregateId: newId(),
          payload: { v: 1, patientPhone: 'x' },
          correlationId: newId(),
          causationId: null,
          actorId: null,
          idempotencyKey: null,
        }),
      ),
    ).rejects.toThrow(/not allowed/);
  });
});

describe('RunnerLoop (runner modes)', () => {
  function build(mode: 'worker' | 'cron') {
    const reg = registry();
    const runner = new JobRunner(db.prisma, reg, { strategy: 'skip_locked', app: 'test' });
    runner.handle('Probe', async () => undefined);
    const loop = new RunnerLoop(db.prisma, runner, null, null, {
      databaseUrl: testDatabaseUrl(),
      env: 'test',
      maxConcurrency: 4,
      pollIntervalMs: 20,
      pollMaxIntervalMs: 50,
      mode,
    });
    return { reg, loop };
  }

  it('processes a bounded cron batch and skips while another runner holds the singleton', async () => {
    const a = build('cron');
    const b = build('cron');
    await enqueueMany(new JobPort(db.prisma, a.reg), 6);
    const [r1, r2] = await Promise.all([a.loop.runCronBatch(4, 10), b.loop.runCronBatch(4, 10)]);
    const results = [r1, r2];
    const worked = results.filter((r) => !r.skipped);
    expect(worked.length).toBeGreaterThanOrEqual(1);
    expect(worked.reduce((s, r) => s + r.succeeded, 0)).toBeLessThanOrEqual(8);
    const next = await a.loop.runCronBatch(10, 10);
    expect(next.skipped).toBeUndefined();
    expect(await db.prisma.job.count({ where: { status: 'SUCCEEDED' } })).toBe(6);
  });

  it('cron kick returns runner_active while the continuous loop runs', async () => {
    const w = build('worker');
    const c = build('cron');
    w.loop.start();
    await enqueueMany(new JobPort(db.prisma, w.reg), 3);
    await new Promise((r) => setTimeout(r, 300));
    expect((await w.loop.runCronBatch(5, 5)).skipped).toBe('runner_active');
    expect((await c.loop.runCronBatch(5, 5)).skipped).toBe('runner_active');
    await w.loop.stop();
    expect(await db.prisma.job.count({ where: { status: 'SUCCEEDED' } })).toBe(3);
  });

  it('supports the singleton_locks lease fallback', async () => {
    const reg = registry();
    const make = () => {
      const runner = new JobRunner(db.prisma, reg, { strategy: 'conditional_update', app: 'test' });
      runner.handle('Probe', async () => undefined);
      return new RunnerLoop(db.prisma, runner, null, null, {
        databaseUrl: testDatabaseUrl(),
        env: 'test',
        maxConcurrency: 2,
        pollIntervalMs: 20,
        pollMaxIntervalMs: 50,
        mode: 'cron',
        lockStrategy: 'singleton_lease',
      });
    };
    await enqueueMany(new JobPort(db.prisma, reg), 2);
    expect((await make().runCronBatch(10, 10)).succeeded).toBe(2);
  });
});

describe('Maintenance and TTL cleanup', () => {
  it('schedules each maintenance window once across runners', async () => {
    const reg = new JobRegistry();
    const periodic = registerMaintenance(reg, null, db.prisma, RETENTION);
    const now = new Date();
    const counts = await Promise.all([
      new MaintenanceScheduler(db.prisma, periodic, reg).schedule(now),
      new MaintenanceScheduler(db.prisma, periodic, reg).schedule(now),
    ]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await db.prisma.job.count({ where: { type: 'MaintenanceTtlCleanup' } })).toBe(1);
  });

  it('removes expired OTPs, idempotency records and rate-limit rows, keeping live ones', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 3 * 86_400_000);
    const future = new Date(now.getTime() + 3_600_000);
    for (const expiresAt of [past, future]) {
      await db.prisma.otpChallenge.create({
        data: {
          id: newId(),
          purpose: 'LOGIN',
          destinationHash: String(expiresAt.getTime()).padStart(64, 'a'),
          channel: 'SMS',
          codeHash: 'b'.repeat(64),
          status: 'PENDING',
          createdAt: past,
          expiresAt,
        },
      });
      await db.prisma.idempotencyRecord.create({
        data: {
          id: newId(),
          tenantId: null,
          scope: 'POST /probe',
          idemKey: `key-${expiresAt.getTime()}`,
          requestHash: 'c'.repeat(64),
          status: 'COMPLETED',
          createdAt: past,
          expiresAt,
        },
      });
      await db.prisma.rateLimitCounter.create({
        data: {
          scope: 'probe',
          subjectHash: 'd'.repeat(64),
          windowStart: expiresAt,
          windowSeconds: 60,
          count: 1,
          expiresAt,
        },
      });
    }
    const counts = await runTtlCleanup(db.prisma, RETENTION, { batchSize: 1 });
    expect(counts).toMatchObject({
      otp_challenges: 1,
      idempotency_records_expired: 1,
      rate_limit_counters: 1,
    });
    expect(await db.prisma.otpChallenge.count()).toBe(1);
    expect(await db.prisma.idempotencyRecord.count()).toBe(1);
    expect(await db.prisma.rateLimitCounter.count()).toBe(1);
  });
});

describe('IdempotencyStore (FOUND-013)', () => {
  const scope = (key: string, body: unknown) => ({
    tenantId: null,
    scope: 'POST /probe',
    key,
    actorUserId: null,
    requestHash: requestHash({ method: 'POST', path: '/probe', body }),
  });

  it('replays a completed request and rejects key reuse with a different body', async () => {
    const store = new IdempotencyStore(db.prisma, 24);
    const s = scope('idem-key-0001', { a: 1 });
    expect(await store.lookup(s)).toEqual({ state: 'NEW' });
    await withTransaction(db.prisma, (tx) => store.commit(tx, s, { status: 201, body: { id: 'x' } }));
    expect(await store.lookup(s)).toEqual({ state: 'REPLAY', response: { status: 201, body: { id: 'x' } } });
    await expect(store.lookup(scope('idem-key-0001', { a: 2 }))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('commits in the mutation transaction: a rollback leaves no record', async () => {
    const store = new IdempotencyStore(db.prisma, 24);
    const s = scope('idem-key-0002', {});
    await expect(
      withTransaction(db.prisma, async (tx) => {
        await store.commit(tx, s, { status: 200, body: null });
        throw new AppError('STALE_VERSION');
      }),
    ).rejects.toThrow();
    expect(await store.lookup(s)).toEqual({ state: 'NEW' });
  });

  it('allows only one of two concurrent duplicates to commit', async () => {
    const store = new IdempotencyStore(db.prisma, 24);
    const s = scope('idem-key-0003', {});
    const results = await Promise.allSettled([
      withTransaction(db.prisma, (tx) => store.commit(tx, s, { status: 200, body: 1 })),
      withTransaction(db.prisma, (tx) => store.commit(tx, s, { status: 200, body: 2 })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('two-phase: IN_PROGRESS → 409, retryable → re-execute, completed → replay', async () => {
    const store = new IdempotencyStore(db.prisma, 24);
    const s = scope('idem-key-0004', {});
    const id = await withTransaction(db.prisma, (tx) => store.begin(tx, s));
    await expect(store.lookup(s)).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
    await store.markRetryable(id);
    expect(await store.lookup(s)).toEqual({ state: 'RETRY' });
    const id2 = await withTransaction(db.prisma, (tx) => store.begin(tx, s));
    await store.complete(id2, { status: 202, body: { ok: true } });
    expect(await store.lookup(s)).toMatchObject({ state: 'REPLAY', response: { status: 202 } });
  });

  it('scopes keys per tenant', async () => {
    const store = new IdempotencyStore(db.prisma, 24);
    const tenantA = { ...scope('idem-key-0005', {}), tenantId: newId() };
    await store.commitStandalone(tenantA, { status: 200, body: null });
    expect(await store.lookup(scope('idem-key-0005', {}))).toEqual({ state: 'NEW' });
  });
});

describe('RateLimiter (FOUND-013)', () => {
  it('limits within the window, reports Retry-After and stores only hashed subjects', async () => {
    const clock = new FixedClock(new Date(Date.UTC(2026, 8, 18, 10, 0, 0)));
    const limiter = new RateLimiter(db.prisma, 'test-pepper-not-secret', clock);
    const rule = { scope: 'otp:phone', limit: 3, windowSeconds: 600 };
    for (let i = 0; i < 3; i++) expect((await limiter.consume(rule, '+8801700000001')).allowed).toBe(true);
    const denied = await limiter.consume(rule, '+8801700000001');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(600);
    expect((await limiter.consume(rule, '+8801700000002')).allowed).toBe(true);
    await expect(limiter.enforce([{ rule, subject: '+8801700000001' }])).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 600,
    });
    const rows = await db.prisma.rateLimitCounter.findMany();
    expect(JSON.stringify(rows)).not.toContain('8801700000001');
    // Sliding window: the previous window still weighs in shortly after rollover.
    clock.advanceMs(610_000);
    expect((await limiter.consume(rule, '+8801700000001')).allowed).toBe(false);
    clock.advanceMs(600_000);
    expect((await limiter.consume(rule, '+8801700000001')).allowed).toBe(true);
  });
});
