import type { Clock } from '@hmedic/kernel';
import type { ServerConfig } from '@hmedic/config';
import type { PrismaClient } from '@hmedic/database';
import type { IdempotencyStore, RateLimiter, RunnerLoop } from '@hmedic/jobs';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { Logger, Metrics } from '@hmedic/observability';

export interface ReadinessResult {
  ok: boolean;
  /** Degraded keeps 200 but is reported (e.g. job lag above threshold). */
  degraded?: boolean;
}

export interface ReadinessCheck {
  name: string;
  run(): Promise<ReadinessResult>;
}

/** Everything the shared HTTP layer needs, built once by the app composition root. */
export interface HttpRuntime {
  app: 'api' | 'worker';
  config: ServerConfig;
  prisma: PrismaClient;
  logger: Logger;
  metrics: Metrics;
  clock: Clock;
  bootId: string;
  startedAt: Date;
  idempotency: IdempotencyStore;
  rateLimiter: RateLimiter;
  audit: PrismaAuditPort;
  /** Present when this process serves `POST /internal/jobs/run`. */
  runnerLoop?: RunnerLoop | null;
  /** Present only on the worker with DIAGNOSTICS_ENABLED (SMS-002 free provider probes). */
  smsDiagnostics?: (() => Promise<unknown>) | null;
  readinessChecks: ReadinessCheck[];
}

export const HTTP_RUNTIME = Symbol('HTTP_RUNTIME');
