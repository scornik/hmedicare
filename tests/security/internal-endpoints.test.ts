import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { generateSecret, testEnv } from '@hmedic/config/testing';
import { type WorkerInstance, buildWorker } from '../../apps/worker/src/compose';
import { testDatabaseUrl, truncateAll } from '../support/db';

// T10: internal endpoints (cron kick, metrics) reject missing, wrong and other-environment tokens with 401,
// claim no job, audit the rejection and rate-limit repeated failures.
let worker: WorkerInstance;
let server: Parameters<typeof request>[0];

beforeAll(async () => {
  worker = await buildWorker(
    loadConfig<ServerConfig>('worker', testEnv({ DATABASE_URL: testDatabaseUrl(), JOB_RUNNER_MODE: 'cron' })),
  );
  server = worker.app.getHttpServer();
});
afterAll(async () => {
  await worker?.close();
});
beforeEach(async () => {
  await truncateAll();
});

describe('T10 internal tokens', () => {
  it('rejects no token, wrong tokens, the other endpoint token and near-miss tokens; claims nothing', async () => {
    const good = worker.runtime.config.INTERNAL_CRON_TOKEN!;
    const variants: Array<string | undefined> = [
      undefined,
      'Bearer ',
      `Bearer ${generateSecret()}`, // e.g. the staging token
      `Bearer ${worker.runtime.config.INTERNAL_METRICS_TOKEN}`, // token of the other endpoint
      `Bearer ${good.slice(0, -1)}`,
      `Bearer ${good}x`,
      `Basic ${good}`,
      good,
    ];
    for (const v of variants) {
      const r = request(server).post('/internal/jobs/run');
      if (v !== undefined) void r.set('authorization', v);
      const res = await r;
      expect({ v, status: res.status }).toEqual({ v, status: 401 });
      expect(res.body.code).toBe('UNAUTHENTICATED');
    }
    expect(await worker.runtime.prisma.job.count()).toBe(0);
    expect(await worker.runtime.prisma.auditLog.count({ where: { action: 'INTERNAL_TOKEN_REJECTED' } })).toBe(
      variants.length,
    );
    // The right token works.
    await request(server).post('/internal/jobs/run').set('authorization', `Bearer ${good}`).expect(200);
  });

  it('rate-limits repeated failures (429) and applies the same rules to /internal/metrics', async () => {
    let last = 0;
    for (let i = 0; i < 32; i++) {
      last = (await request(server).get('/internal/metrics').set('authorization', 'Bearer wrong')).status;
    }
    expect(last).toBe(429);
    const blocked = await request(server).post('/internal/jobs/run').set('authorization', 'Bearer wrong');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});

describe('T27 TLS verification', () => {
  it('configuration refuses NODE_TLS_REJECT_UNAUTHORIZED=0 (process would not start)', () => {
    // eslint-disable-next-line hmedic/no-tls-disable -- the test feeds the forbidden value to prove refusal
    expect(() => loadConfig('api', testEnv({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }))).toThrow(
      /NODE_TLS_REJECT_UNAUTHORIZED/,
    );
  });
});
