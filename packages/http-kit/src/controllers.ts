import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ping } from '@hmedic/database';
import { Public, RawResponse } from './decorators';
import { InternalToken } from './internal-token';
import { setResponseStatus } from './request';
import { HTTP_RUNTIME, type HttpRuntime } from './runtime';

const READY_TIMEOUT_MS = 500;

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise.catch(() => fallback), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** `GET /health/live` and `GET /health/ready` (API-IMPLEMENTATION §3.1). Bodies carry no secrets or PHI. */
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime) {}

  @Get('live')
  @RawResponse()
  live() {
    return {
      status: 'ok',
      app: this.runtime.app,
      bootId: this.runtime.bootId,
      version: this.runtime.config.APP_VERSION,
      uptimeSeconds: Math.floor((Date.now() - this.runtime.startedAt.getTime()) / 1000),
    };
  }

  @Get('ready')
  @RawResponse()
  async ready(@Req() request: FastifyRequest) {
    const checks: Record<string, 'ok' | 'degraded' | 'fail'> = {};
    checks.db = (await ping(this.runtime.prisma, READY_TIMEOUT_MS)) ? 'ok' : 'fail';
    for (const check of this.runtime.readinessChecks) {
      const r = await withTimeout(check.run(), READY_TIMEOUT_MS, { ok: false });
      checks[check.name] = !r.ok ? 'fail' : r.degraded ? 'degraded' : 'ok';
    }
    const values = Object.values(checks);
    const status = values.includes('fail')
      ? 'unavailable'
      : values.includes('degraded')
        ? 'degraded'
        : 'ready';
    if (status === 'unavailable') setResponseStatus(request, 503);
    return { status, checks };
  }
}

/** `GET /internal/metrics` (Prometheus text; bearer INTERNAL_METRICS_TOKEN). */
@Public()
@Controller('internal')
export class InternalMetricsController {
  constructor(@Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime) {}

  @Get('metrics')
  @RawResponse()
  @InternalToken('INTERNAL_METRICS_TOKEN')
  async metrics(@Res({ passthrough: true }) reply: FastifyReply) {
    void reply.header('content-type', this.runtime.metrics.registry.contentType);
    return this.runtime.metrics.registry.metrics();
  }
}

/**
 * `POST /internal/jobs/run` (cron kick, ADR-015 §7): one bounded batch under the singleton lock. `202`
 * with `skipped: runner_active` when another runner holds it (the request still keeps the process warm).
 */
@Public()
@Controller('internal/jobs')
export class InternalJobsController {
  constructor(@Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime) {}

  @Post('run')
  @HttpCode(200)
  @RawResponse()
  @InternalToken('INTERNAL_CRON_TOKEN')
  async run(@Req() request: FastifyRequest) {
    const loop = this.runtime.runnerLoop;
    if (!loop) {
      setResponseStatus(request, 202);
      return { skipped: 'runner_disabled' };
    }
    const result = await loop.runCronBatch(
      this.runtime.config.JOB_CRON_BATCH_MAX,
      this.runtime.config.JOB_CRON_TIME_BUDGET_SECONDS,
    );
    if (result.skipped) setResponseStatus(request, 202);
    return result;
  }
}
