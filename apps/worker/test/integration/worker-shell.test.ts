import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { generateSecret, testEnv } from '@hmedic/config/testing';
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
  it('refuses scanner activation without a private storage root', async () => {
    await expect(buildWorker(config({ UPLOAD_SCAN_WORKER_ENABLED: 'true' }))).rejects.toThrow(
      'UPLOAD_SCAN_WORKER_ENABLED requires STORAGE_DISK_ROOT',
    );
  });

  it('registers the scan handler only when explicitly enabled with private storage', async () => {
    const disabled = await start({ JOB_RUNNER_MODE: 'cron' });
    expect(disabled.jobs?.registry.get('ScanDocumentVersion')).toBeUndefined();
    expect(disabled.jobs?.registry.get('DiskUsageCheck')).toBeUndefined();
    const root = await mkdtemp(path.join(tmpdir(), 'hmedic-worker-scan-'));
    try {
      const enabled = await start({
        JOB_RUNNER_MODE: 'cron',
        UPLOAD_SCAN_WORKER_ENABLED: 'true',
        STORAGE_DISK_ROOT: root,
      });
      expect(enabled.jobs?.registry.get('ScanDocumentVersion')).toBeDefined();
      expect(enabled.jobs?.runner.hasHandler('ScanDocumentVersion')).toBe(true);
      expect(enabled.jobs?.registry.get('DiskUsageCheck')).toBeDefined();
      expect(enabled.jobs?.runner.hasHandler('DiskUsageCheck')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('two workers share one singleton loop; maintenance runs once per window', async () => {
    const [a, b] = [await start(), await start()];
    // `>=` not `===`: the count must reach the number of periodic jobs asserted below, and an equality
    // check only passes when a poll lands on that exact instant. It went unnoticed while the previous
    // number was one short of the real total and the runs were slow enough to be caught mid-flight.
    await waitFor(async () => (await a.runtime.prisma.job.count({ where: { status: 'SUCCEEDED' } })) >= 7);
    const jobs = await a.runtime.prisma.job.findMany({ select: { type: true, idempotencyKey: true } });
    // A minute boundary can legitimately schedule another reminder window during startup.
    // Require the expected job types and one persisted job per type/window, not one job per type forever.
    expect([...new Set(jobs.map((j) => j.type))].sort()).toEqual([
      'ApplyNoShowPolicy',
      'CheckSmsBalance',
      'CreateFollowUpReminders',
      'MaintenanceTtlCleanup',
      'ProjectTimelineBacklog',
      'ReencryptProviderCredentials',
      'VerifyAppendOnlyChains',
    ]);
    expect(new Set(jobs.map((j) => j.idempotencyKey)).size).toBe(jobs.length);
    for (const job of jobs) expect(job.idempotencyKey).toMatch(new RegExp(`^${job.type}:\\d+$`));

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
    // `sessionMode` joined the checks in Stage 6 (DEPLOY-003): readiness proves on a real connection
    // that ADR-014's session init ran, because the deployed server's own sql_mode is not strict.
    expect(res.body).toEqual({
      status: 'degraded',
      checks: { db: 'ok', sessionMode: 'ok', jobs: 'degraded' },
      // DEPLOY-004: the real-data gate is readable off the running system, not only from a dashboard.
      data: { realPatientDataAllowed: false },
    });
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

describe('SMS-002 diagnostics (GET /internal/diagnostics/sms-balance)', () => {
  const KEY = 'zit_fake_diag_0123456789abcdef0123456789';
  const DIAG = 'diag-token-'.padEnd(43, 'x');

  it('is absent unless DIAGNOSTICS_ENABLED, and needs its own bearer token', async () => {
    const off = await start({ JOB_RUNNER_MODE: 'off' });
    await request(off.app.getHttpServer())
      .get('/internal/diagnostics/sms-balance')
      .set('authorization', `Bearer ${DIAG}`)
      .expect(404);

    const on = await start({
      JOB_RUNNER_MODE: 'off',
      DIAGNOSTICS_ENABLED: 'true',
      INTERNAL_DIAGNOSTICS_TOKEN: DIAG,
    });
    const server = on.app.getHttpServer();
    await request(server).get('/internal/diagnostics/sms-balance').expect(401);
    await request(server)
      .get('/internal/diagnostics/sms-balance')
      .set('authorization', `Bearer ${on.runtime.config.INTERNAL_METRICS_TOKEN}`)
      .expect(401);
    const res = await request(server)
      .get('/internal/diagnostics/sms-balance')
      .set('authorization', `Bearer ${DIAG}`)
      .expect(200);
    expect(res.body.data.result).toMatchObject({ provider: 'mock', balance: { outcome: 'OK' } });
  });

  it('probes Zaman IT checkbalance via POST form body and returns only a redacted capture', async () => {
    const { createServer } = await import('node:http');
    const seen: Array<{ url: string; method: string; body: string }> = [];
    const provider = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen.push({ url: req.url ?? '', method: req.method ?? '', body });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ balance: '742.25', key_echo: KEY }));
      });
    });
    await new Promise<void>((r) => provider.listen(0, '127.0.0.1', () => r()));
    const port = (provider.address() as { port: number }).port;
    try {
      const w = await start({
        JOB_RUNNER_MODE: 'off',
        DIAGNOSTICS_ENABLED: 'true',
        INTERNAL_DIAGNOSTICS_TOKEN: DIAG,
        SMS_PROVIDER: 'zamanit',
        ZAMANIT_BASE_URL: `http://127.0.0.1:${port}/api`,
        ZAMANIT_ALLOW_INSECURE_HTTP: 'true',
        ZAMANIT_API_KEY: KEY,
        ZAMANIT_SENDER_ID: 'DEMO',
        ZAMANIT_API_KEY_ISSUED_ON: '2026-09-01',
      });
      const logs: string[] = [];
      const write = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
        logs.push(String(chunk));
        return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stdout.write;
      let res;
      try {
        res = await request(w.app.getHttpServer())
          .get('/internal/diagnostics/sms-balance')
          .set('authorization', `Bearer ${DIAG}`)
          .expect(200);
      } finally {
        process.stdout.write = write;
      }
      expect(seen).toEqual([
        { url: '/api/checkbalance', method: 'POST', body: `api_key=${encodeURIComponent(KEY)}` },
      ]);
      const result = res.body.data.result;
      expect(result.checkbalance).toMatchObject({
        endpoint: `http://127.0.0.1:${port}/api/checkbalance`,
        outcome: 'response',
        status: 200,
        parsed: { outcome: 'OK', parseStatus: 'PARSED', balance: '742.25' },
      });
      expect(result.httpsProbe).toMatchObject({ host: '127.0.0.1', port: 443, verified: false });
      expect(JSON.stringify(res.body)).not.toContain(KEY);
      expect(logs.join('')).not.toContain(KEY);
    } finally {
      provider.close();
    }
  });
});

/**
 * The worker cannot write a clinical record (AI-003, AI-IMPLEMENTATION §7.5).
 *
 * This is the enforcement behind "no final write": the process that talks to AI providers must not be
 * able to put anything into a chart, whatever a bug or a future change tries. Three things make that
 * true, and all three are checked here rather than assumed.
 *
 * The DI boundary: the worker container has no clinical write services, so resolving one throws rather
 * than returning something that would quietly work. The import boundary is dependency-cruiser's job
 * and is checked by the gate. And the record itself: a diagnosis labelled `ai_approved` must have an
 * approval behind it, which the database enforces and which is asserted here against a real insert.
 */
describe('the worker holds no clinical write path (AI-003 §7.5)', () => {
  it('cannot resolve the clinical write services', async () => {
    const w = await start();

    // `CLINICAL_SERVICES` is provided only by `ClinicalWriteModule`, which only apps/api imports. A
    // worker that could resolve it would be a worker that could write a note or a diagnosis.
    expect(() => w.app.get<unknown>('CLINICAL_SERVICES')).toThrow();
  });

  it('runs AI jobs all the same', async () => {
    const w = await start({
      AI_CREDENTIAL_KEK: generateSecret(),
      AI_CREDENTIAL_KEK_ID: 'test-ai-1',
      AI_CREDENTIAL_FINGERPRINT_PEPPER: generateSecret(),
      AI_ENABLED_PROVIDER_CODES: 'mock',
    });
    // The point of the boundary is that it costs the worker nothing it needs: `RunAIJob` is registered
    // and claimable in the same process that cannot write a chart.
    const types = (w.jobs?.registry.all() ?? []).map((definition) => definition.type);
    expect(types).toContain('RunAIJob');
    expect(types).toContain('ValidateAICredential');
    expect(types).toContain('ExpireAIDrafts');
  });

  it('refuses a diagnosis claiming AI approval with no approval behind it', async () => {
    const w = await start();
    const now = new Date();
    const tenantId = newId();
    await w.runtime.prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'DEMO ai boundary',
        slug: `ai-boundary-${tenantId.slice(-8)}`,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });

    // Attempted directly against the database, which is the only way left once the DI boundary holds.
    // The CHECK is what makes `source='ai_approved'` a verifiable claim rather than a label.
    await expect(
      w.runtime.prisma.diagnosis.create({
        data: {
          id: newId(),
          tenantId,
          encounterId: newId(),
          patientId: newId(),
          authorDoctorProfileId: newId(),
          display: 'SYNTHETIC unapproved',
          clinicalStatus: 'ACTIVE',
          certainty: 'CONFIRMED',
          source: 'ai_approved',
          createdAt: now,
          updatedAt: now,
        },
      }),
    ).rejects.toThrow();
  });
});
