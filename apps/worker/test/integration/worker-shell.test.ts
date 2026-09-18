import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { listAppliedMigrations } from '@hmedic/database';
import { recordAppliedMigrations } from '@hmedic/http-kit';
import { type WorkerInstance, buildWorker } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

// FOUND-007 worker shell + JOB-005 runner modes. Runs against MariaDB 10.6 and 11.4.
const instances: WorkerInstance[] = [];

function config(overrides: Record<string, string> = {}): ServerConfig {
  const base = testEnv({
    DATABASE_URL: testDatabaseUrl(),
    JOB_RUNNER_MODE: 'worker',
    JOB_POLL_INTERVAL_MS: '50',
  });
  return loadConfig<ServerConfig>('worker', { ...base, ...overrides });
}

async function start(overrides: Record<string, string> = {}): Promise<WorkerInstance> {
  const w = await buildWorker(config(overrides));
  instances.push(w);
  return w;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('condition not met in time');
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await Promise.all(instances.splice(0).map((w) => w.close()));
});

describe('worker mode', () => {
  it('two workers share one singleton loop; maintenance runs once per window', async () => {
    const [a, b] = [await start(), await start()];
    await waitFor(async () => (await a.runtime.prisma.job.count({ where: { status: 'SUCCEEDED' } })) === 2);
    const jobs = await a.runtime.prisma.job.findMany({ select: { type: true, lockedBy: true } });
    expect(jobs.map((j) => j.type).sort()).toEqual(['MaintenanceTtlCleanup', 'VerifyAppendOnlyChains']);

    for (const w of [a, b]) {
      const res = await request(w.app.getHttpServer())
        .post('/internal/jobs/run')
        .set('authorization', `Bearer ${w.runtime.config.INTERNAL_CRON_TOKEN}`)
        .expect(202);
      expect(res.body.skipped).toBe('runner_active');
    }
  });

  it('serves health with bootId and no CORS grant', async () => {
    const w = await start({ JOB_RUNNER_MODE: 'off' });
    const res = await request(w.app.getHttpServer())
      .get('/health/live')
      .set('origin', 'http://localhost:5173')
      .expect(200);
    expect(res.body).toMatchObject({ app: 'worker', bootId: w.runtime.bootId });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('readiness', () => {
  it('reports degraded (200) when the oldest queued job lags beyond the threshold', async () => {
    const w = await start({ JOB_RUNNER_MODE: 'off' });
    const server = w.app.getHttpServer();
    expect((await request(server).get('/health/ready').expect(200)).body.status).toBe('ready');
    const old = new Date(Date.now() - 20 * 60_000);
    await w.runtime.prisma.job.create({
      data: {
        id: newId(),
        queue: 'probe',
        type: 'Probe',
        payload: { v: 1 },
        status: 'QUEUED',
        priority: 100,
        runAt: old,
        attempts: 0,
        maxAttempts: 3,
        correlationId: newId(),
        createdAt: old,
        updatedAt: old,
      },
    });
    const res = await request(server).get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'degraded', checks: { db: 'ok', jobs: 'degraded' } });
    const metrics = await request(server)
      .get('/internal/metrics')
      .set('authorization', `Bearer ${w.runtime.config.INTERNAL_METRICS_TOKEN}`)
      .expect(200);
    expect(metrics.text).toMatch(/job_lag_seconds\{[^}]*queue="probe"[^}]*\} \d+/);
  });

  it('cron kick answers runner_disabled when JOB_RUNNER_MODE=off', async () => {
    const w = await start({ JOB_RUNNER_MODE: 'off' });
    const res = await request(w.app.getHttpServer())
      .post('/internal/jobs/run')
      .set('authorization', `Bearer ${w.runtime.config.INTERNAL_CRON_TOKEN}`)
      .expect(202);
    expect(res.body).toEqual({ skipped: 'runner_disabled' });
  });
});

describe('MIGRATION_APPLIED audit (DEPLOYMENT §4.1 step 7)', () => {
  it('records one platform-chain row per applied migration, once, even with concurrent startups', async () => {
    const w = await start({ JOB_RUNNER_MODE: 'off' });
    const applied = await listAppliedMigrations(w.runtime.prisma);
    expect(applied.length).toBeGreaterThan(0);
    const counts = await Promise.all([
      recordAppliedMigrations(w.runtime),
      recordAppliedMigrations(w.runtime),
    ]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(applied.length);
    expect(await recordAppliedMigrations(w.runtime)).toBe(0);
    const rows = await w.runtime.prisma.auditLog.findMany({ where: { action: 'MIGRATION_APPLIED' } });
    expect(rows).toHaveLength(applied.length);
    expect(rows.every((r) => r.chainKey === 'platform' && r.actorType === 'SYSTEM')).toBe(true);
  });
});
