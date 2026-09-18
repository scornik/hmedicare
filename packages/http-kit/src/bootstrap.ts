import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ServerConfig } from '@hmedic/config';
import { type Clock, systemClock } from '@hmedic/kernel';
import { type Database, createDatabase } from '@hmedic/database';
import { IdempotencyStore, RateLimiter } from '@hmedic/jobs';
import { PrismaAuditPort } from '@hmedic/audit';
import { createLogger, createMetrics } from '@hmedic/observability';
import { fastifyOptions, registerHttpHooks } from './fastify-hooks';
import { PinoNestLogger } from './nest-components';
import type { HttpRuntime } from './runtime';

export const CORS_ALLOWED_HEADERS = [
  'authorization',
  'content-type',
  'idempotency-key',
  'x-request-id',
  'x-tenant-id',
  'x-patient-context',
  'x-platform-context',
  'x-csrf-token',
  'x-device-id',
  'if-none-match',
];
export const CORS_EXPOSED_HEADERS = ['x-request-id', 'retry-after', 'etag', 'idempotent-replayed'];

export function parseAllowedOrigins(value: string): string[] {
  return value
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0 && o !== '*');
}

/** Builds the shared runtime (DB pool, logger, metrics, stores) for an app. */
export function createRuntime(
  app: 'api' | 'worker',
  config: ServerConfig,
  overrides: { clock?: Clock; database?: Database } = {},
): { runtime: HttpRuntime; database: Database } {
  const clock = overrides.clock ?? systemClock;
  const bootId = randomUUID();
  const database =
    overrides.database ??
    createDatabase({
      url: config.DATABASE_URL,
      poolMax: config.DATABASE_POOL_MAX,
      minIdle: config.DATABASE_POOL_MIN_IDLE,
      connectTimeoutMs: config.DATABASE_CONNECT_TIMEOUT_MS,
      acquireTimeoutMs: config.DATABASE_ACQUIRE_TIMEOUT_MS,
      lockWaitTimeoutSeconds: config.DB_LOCK_WAIT_TIMEOUT_SECONDS,
    });
  const metrics = createMetrics(app);
  const logger = createLogger({
    app,
    env: config.APP_ENV,
    version: config.APP_VERSION,
    bootId,
    ...(config.LOG_LEVEL ? { level: config.LOG_LEVEL } : {}),
  });
  const runtime: HttpRuntime = {
    app,
    config,
    prisma: database.prisma,
    logger,
    metrics,
    clock,
    bootId,
    startedAt: new Date(),
    idempotency: new IdempotencyStore(database.prisma, config.IDEMPOTENCY_TTL_HOURS, clock),
    rateLimiter: new RateLimiter(database.prisma, config.RATE_LIMIT_PEPPER, clock, metrics),
    audit: new PrismaAuditPort(clock),
    runnerLoop: null,
    readinessChecks: [],
  };
  return { runtime, database };
}

/** Creates and initializes the Nest/Fastify app (not listening). */
export async function createHttpApp(
  rootModule: unknown,
  runtime: HttpRuntime,
  options: { cors: boolean },
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter(fastifyOptions(runtime));
  registerHttpHooks(adapter.getInstance(), runtime);
  const app = await NestFactory.create<NestFastifyApplication>(rootModule as never, adapter, {
    logger: new PinoNestLogger(runtime),
    bufferLogs: false,
    abortOnError: false,
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health/*path', 'internal/*path'] });
  if (options.cors) {
    const allowed = new Set(parseAllowedOrigins(runtime.config.CORS_ALLOWED_ORIGINS));
    app.enableCors({
      origin: (origin, cb) => cb(null, origin !== undefined && allowed.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: CORS_ALLOWED_HEADERS,
      exposedHeaders: CORS_EXPOSED_HEADERS,
      maxAge: 600,
    });
  }
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
