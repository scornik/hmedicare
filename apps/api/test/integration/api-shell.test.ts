import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { HealthLive, HealthReady, ProblemDetails } from '@hmedic/contracts';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

// FOUND-006 API shell: boots from configuration, serves health, runs the embedded job loop when asked.
describe('apps/api shell', () => {
  let api: ApiInstance;

  beforeAll(async () => {
    await truncateAll();
    const config = loadConfig<ServerConfig>(
      'api',
      testEnv({ DATABASE_URL: testDatabaseUrl(), JOB_RUNNER_MODE: 'cron' }),
    );
    api = await buildApi(config);
  });

  afterAll(async () => {
    await api?.close();
  });

  it('serves health without the /api/v1 prefix; responses match the OpenAPI contract', async () => {
    const server = api.app.getHttpServer();
    HealthLive.parse((await request(server).get('/health/live').expect(200)).body);
    HealthReady.parse((await request(server).get('/health/ready').expect(200)).body);
    ProblemDetails.parse((await request(server).get('/api/v1/health/live').expect(404)).body);
  });

  it('cron mode: the internal kick runs a bounded batch including maintenance scheduling', async () => {
    const server = api.app.getHttpServer();
    const res = await request(server)
      .post('/internal/jobs/run')
      .set('authorization', `Bearer ${api.runtime.config.INTERNAL_CRON_TOKEN}`)
      .set('x-request-id', newId())
      .expect(200);
    expect(res.body).toMatchObject({ maintenance: 2 });
    expect(res.body.claimed).toBeGreaterThanOrEqual(2);
    const types = await api.runtime.prisma.job.findMany({ select: { type: true, status: true } });
    expect(types.map((t) => t.type).sort()).toEqual(['MaintenanceTtlCleanup', 'VerifyAppendOnlyChains']);
    expect(types.every((t) => t.status === 'SUCCEEDED')).toBe(true);
  });
});

describe('configuration fails closed', () => {
  it('refuses a wildcard CORS origin and missing secrets (names only)', () => {
    expect(() => loadConfig('api', testEnv({ CORS_ALLOWED_ORIGINS: '*' }))).toThrow(/CORS_ALLOWED_ORIGINS/);
    const env = testEnv({ CSRF_SECRET: undefined });
    expect(() => loadConfig('api', env)).toThrow(/CSRF_SECRET: required/);
  });
});
