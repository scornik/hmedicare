import { Body, Controller, Get, Module, Post, Req } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { AppError, newId } from '@hmedic/kernel';
import { type Database, withTransaction } from '@hmedic/database';
import { createLogger, currentLogContext } from '@hmedic/observability';
import {
  HttpKitModule,
  type HttpRuntime,
  Idempotent,
  RateLimit,
  completeIdempotencyInTx,
  createHttpApp,
  createRuntime,
} from '../../src/index';
import { openTestDatabase, testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

// FOUND-006/FOUND-013 HTTP layer: ProblemDetails, request ids, security headers, CORS, idempotency, rate
// limits, internal tokens, health. Runs against MariaDB 10.6 and 11.4.
const logLines: string[] = [];
let db: Database;
let runtime: HttpRuntime;
let app: NestFastifyApplication;
let server: Parameters<typeof request>[0];
const calls = { create: 0, fail: 0, slow: 0, tx: 0 };

class ItemDto extends createZodDto(z.object({ label: z.string().min(1).max(20), n: z.number().int() })) {}

@Controller('probe')
class ProbeController {
  @Post('items')
  @Idempotent()
  create(@Body() dto: ItemDto) {
    calls.create++;
    return { id: newId(), label: dto.label };
  }

  @Post('fail-once')
  @Idempotent()
  failOnce() {
    calls.fail++;
    if (calls.fail === 1) throw new AppError('PROVIDER_UNAVAILABLE');
    return { ok: true };
  }

  @Post('slow')
  @Idempotent()
  async slow() {
    calls.slow++;
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true };
  }

  @Post('in-tx')
  @Idempotent()
  async inTx(@Req() req: FastifyRequest) {
    calls.tx++;
    const body = { committed: true };
    await withTransaction(runtime.prisma, (tx) =>
      completeIdempotencyInTx(runtime.idempotency, req, tx, { status: 201, body }),
    );
    return body;
  }

  @Get('limited')
  @RateLimit({ rule: { scope: 'probe:ip', limit: 2, windowSeconds: 60 }, by: 'ip' })
  limited() {
    return { ok: true };
  }

  @Get('boom')
  boom() {
    throw new Error('database said +8801700000001 is broken');
  }

  @Get('app-error')
  appError() {
    throw new AppError('RATE_LIMITED', undefined, { retryAfterSeconds: 7 });
  }

  @Get('context')
  context() {
    return { requestId: currentLogContext()?.requestId ?? null };
  }
}

beforeAll(async () => {
  db = openTestDatabase({ poolMax: 10 });
  const config = loadConfig<ServerConfig>(
    'api',
    testEnv({ DATABASE_URL: testDatabaseUrl(), CORS_ALLOWED_ORIGINS: 'https://app.example.invalid' }),
  );
  runtime = createRuntime('api', config, { database: db }).runtime;
  runtime.logger = createLogger({
    app: 'api',
    env: 'test',
    version: 'test',
    bootId: runtime.bootId,
    level: 'info',
    destination: { write: (line: string) => void logLines.push(line) },
  });

  @Module({
    imports: [HttpKitModule.forRoot(runtime, { jobsEndpoint: true })],
    controllers: [ProbeController],
  })
  class TestModule {}

  app = await createHttpApp(TestModule, runtime, { cors: true });
  server = app.getHttpServer();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(async () => {
  await truncateAll();
  Object.assign(calls, { create: 0, fail: 0, slow: 0, tx: 0 });
});

describe('health', () => {
  it('live returns boot info with security headers and a request id', async () => {
    const res = await request(server).get('/health/live').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', app: 'api', bootId: runtime.bootId });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['strict-transport-security']).toBeUndefined(); // test env is not deployed
  });

  it('echoes a valid inbound X-Request-ID and replaces an invalid one', async () => {
    const id = newId();
    expect((await request(server).get('/health/live').set('x-request-id', id)).headers['x-request-id']).toBe(
      id,
    );
    const bad = await request(server).get('/health/live').set('x-request-id', 'not-a-uuid<script>');
    expect(bad.headers['x-request-id']).not.toContain('script');
  });

  it('ready reports the DB and fails with 503 when a check fails', async () => {
    expect((await request(server).get('/health/ready').expect(200)).body).toEqual({
      status: 'ready',
      checks: { db: 'ok' },
    });
    runtime.readinessChecks.push({ name: 'probe', run: async () => ({ ok: false }) });
    try {
      const res = await request(server).get('/health/ready').expect(503);
      expect(res.body).toEqual({ status: 'unavailable', checks: { db: 'ok', probe: 'fail' } });
    } finally {
      runtime.readinessChecks.pop();
    }
  });
});

describe('envelope and ProblemDetails', () => {
  it('wraps data with meta.requestId and binds the log context', async () => {
    const res = await request(server).get('/api/v1/probe/context').expect(200);
    expect(res.body.meta.requestId).toBe(res.headers['x-request-id']);
    expect(res.body.data.requestId).toBe(res.headers['x-request-id']);
  });

  it('maps unknown routes to 404 RESOURCE_NOT_FOUND', async () => {
    const res = await request(server).get('/api/v1/nope').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      message: 'RESOURCE_NOT_FOUND',
      requestId: res.headers['x-request-id'],
    });
  });

  it('maps AppError with Retry-After', async () => {
    const res = await request(server).get('/api/v1/probe/app-error').expect(429);
    expect(res.headers['retry-after']).toBe('7');
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 7 });
  });

  it('hides unexpected errors and redacts them in logs', async () => {
    const res = await request(server).get('/api/v1/probe/boom').expect(500);
    expect(res.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'INTERNAL_ERROR',
      requestId: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toContain('8801700000001');
    const logged = logLines.join('\n');
    expect(logged).toContain('request failed');
    expect(logged).not.toContain('8801700000001');
  });

  it('returns field errors for Zod validation failures, malformed JSON and oversized bodies', async () => {
    const invalid = await request(server)
      .post('/api/v1/probe/items')
      .set('idempotency-key', 'key-validation-1')
      .send({ label: '', n: 1.5 })
      .expect(400);
    expect(invalid.body.code).toBe('VALIDATION_FAILED');
    expect(invalid.body.fieldErrors.map((f: { path: string }) => f.path).sort()).toEqual(['label', 'n']);
    await request(server)
      .post('/api/v1/probe/items')
      .set('content-type', 'application/json')
      .send('{"label":')
      .expect(400);
    const big = await request(server)
      .post('/api/v1/probe/items')
      .send({ label: 'x', n: 1, pad: 'y'.repeat(1_100_000) })
      .expect(413);
    expect(big.body.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('Idempotency-Key (FOUND-013)', () => {
  const post = (path: string, key?: string, body: object = { label: 'a', n: 1 }) => {
    const r = request(server).post(`/api/v1/probe/${path}`);
    if (key) void r.set('idempotency-key', key);
    return r.send(body);
  };

  it('is required on idempotent routes', async () => {
    expect((await post('items').expect(400)).body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await post('items', 'bad key').expect(400)).body.code).toBe('VALIDATION_FAILED');
  });

  it('replays the stored response once and rejects reuse with another body', async () => {
    const first = await post('items', 'key-replay-0001').expect(201);
    const second = await post('items', 'key-replay-0001').expect(201);
    expect(second.body.data).toEqual(first.body.data);
    expect(second.body.meta.replayed).toBe(true);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(calls.create).toBe(1);
    const reused = await post('items', 'key-replay-0001', { label: 'b', n: 1 }).expect(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('answers 409 to a concurrent duplicate', async () => {
    const [a, b] = await Promise.all([
      post('slow', 'key-slow-00001', {}),
      post('slow', 'key-slow-00001', {}),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(calls.slow).toBe(1);
  });

  it('allows a retry after a failed attempt', async () => {
    expect((await post('fail-once', 'key-fail-00001', {}).expect(503)).body.code).toBe(
      'PROVIDER_UNAVAILABLE',
    );
    await post('fail-once', 'key-fail-00001', {}).expect(201);
    expect((await post('fail-once', 'key-fail-00001', {}).expect(201)).body.meta.replayed).toBe(true);
    expect(calls.fail).toBe(2);
  });

  it('completes inside the use case transaction', async () => {
    await post('in-tx', 'key-in-tx-0001', {}).expect(201);
    const replay = await post('in-tx', 'key-in-tx-0001', {}).expect(201);
    expect(replay.body).toMatchObject({ data: { committed: true }, meta: { replayed: true } });
    expect(calls.tx).toBe(1);
  });
});

describe('rate limits and internal tokens', () => {
  it('returns 429 with Retry-After after the route limit', async () => {
    await request(server).get('/api/v1/probe/limited').expect(200);
    await request(server).get('/api/v1/probe/limited').expect(200);
    const res = await request(server).get('/api/v1/probe/limited').expect(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('protects /internal/metrics with a bearer token and audits rejections', async () => {
    await request(server).get('/internal/metrics').expect(401);
    await request(server).get('/internal/metrics').set('authorization', 'Bearer wrong').expect(401);
    const ok = await request(server)
      .get('/internal/metrics')
      .set('authorization', `Bearer ${runtime.config.INTERNAL_METRICS_TOKEN}`)
      .expect(200);
    expect(ok.text).toContain('http_requests_total');
    const audits = await runtime.prisma.auditLog.findMany({ where: { action: 'INTERNAL_TOKEN_REJECTED' } });
    expect(audits).toHaveLength(2);
    expect(
      JSON.stringify(audits, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
    ).not.toContain('wrong');
  });

  it('protects the cron kick and reports a disabled runner with 202', async () => {
    await request(server).post('/internal/jobs/run').expect(401);
    const res = await request(server)
      .post('/internal/jobs/run')
      .set('authorization', `Bearer ${runtime.config.INTERNAL_CRON_TOKEN}`)
      .expect(202);
    expect(res.body).toEqual({ skipped: 'runner_disabled' });
  });
});

describe('CORS (strict allow-list)', () => {
  it('allows the configured web origin with credentials', async () => {
    const res = await request(server)
      .options('/api/v1/probe/items')
      .set('origin', 'https://app.example.invalid')
      .set('access-control-request-method', 'POST')
      .set('access-control-request-headers', 'content-type,idempotency-key,x-tenant-id');
    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.invalid');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('gives foreign origins no CORS grant', async () => {
    const res = await request(server).get('/health/live').set('origin', 'https://evil.example.invalid');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
