import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';
import { parseTrustProxy } from '@hmedic/config';
import { isUuid, newId } from '@hmedic/kernel';
import { runWithLogContext, statusClass } from '@hmedic/observability';
import { toProblem } from './problem-details';
import { routeTemplate } from './request';
import type { HttpRuntime } from './runtime';

/**
 * Fastify server options (API-IMPLEMENTATION §1, OBSERVABILITY §1). The request id is the inbound
 * `X-Request-ID` when it is a UUID, else a new UUIDv7. JSON bodies are capped (uploads never pass through
 * the API). Proxy trust is by peer address only (`TRUST_PROXY`, audit C-48, HOST-013): a hop count would let
 * a direct client spoof X-Forwarded-For, which is why Fastify >= 5.12 fails closed on numeric trust.
 */
export function fastifyOptions(runtime: Pick<HttpRuntime, 'config'>): FastifyServerOptions {
  return {
    logger: false,
    requestIdHeader: false,
    genReqId: (req) => {
      const inbound = req.headers['x-request-id'];
      return typeof inbound === 'string' && isUuid(inbound) ? inbound.toLowerCase() : newId();
    },
    bodyLimit: 1_048_576,
    trustProxy: trustProxyOption(runtime.config.TRUST_PROXY),
    connectionTimeout: 30_000,
    requestTimeout: 25_000,
    return503OnClosing: true,
  };
}

/** `false` (ignore every X-Forwarded-* header) unless at least one trusted proxy is configured. */
export function trustProxyOption(value: string): string[] | false {
  const list = parseTrustProxy(value) ?? [];
  return list.length ? list : false;
}

/** Security headers for JSON API responses (SECURITY-IMPLEMENTATION §1, ADR-013 §2). */
export function securityHeaders(deployed: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-site',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'x-dns-prefetch-control': 'off',
  };
  if (deployed) headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

export function sendProblem(
  runtime: HttpRuntime,
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
) {
  const problem = toProblem(error, request.id);
  if (request.hm) request.hm.statusOverride = undefined;
  if (problem.unexpected) {
    runtime.logger.error(
      { err: error, route: routeTemplate(request), method: request.method, errorClass: problem.body.code },
      'request failed',
    );
  }
  if (problem.body.retryAfterSeconds !== undefined) {
    void reply.header('retry-after', String(problem.body.retryAfterSeconds));
  }
  return reply
    .status(problem.status)
    .header('content-type', 'application/problem+json; charset=utf-8')
    .send(problem.body);
}

/** Registers request context, access logging/metrics and security headers. */
export function registerHttpHooks(fastify: FastifyInstance, runtime: HttpRuntime): void {
  const deployed = runtime.config.APP_ENV === 'staging' || runtime.config.APP_ENV === 'production';
  const headers = securityHeaders(deployed);

  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-request-id', request.id);
    runWithLogContext({ requestId: request.id, correlationId: request.id }, done);
  });

  fastify.addHook('onSend', (request, reply, payload, done) => {
    const override = request.hm?.statusOverride;
    if (override !== undefined && reply.statusCode < 400) void reply.status(override);
    for (const [name, value] of Object.entries(headers)) void reply.header(name, value);
    if (!reply.hasHeader('cache-control')) void reply.header('cache-control', 'no-store');
    done(null, payload);
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    const route = routeTemplate(request);
    const labels = { route, method: request.method, status_class: statusClass(reply.statusCode) };
    runtime.metrics.httpRequests.inc(labels);
    runtime.metrics.httpDuration.observe(labels, reply.elapsedTime / 1000);
    if (!route.startsWith('/health/')) {
      runtime.logger.info(
        {
          requestId: request.id,
          route,
          method: request.method,
          status: reply.statusCode,
          latencyMs: Math.round(reply.elapsedTime),
        },
        'request completed',
      );
    }
    done();
  });

  // Nest installs the Fastify error handler and routes body-parser/limit errors through ProblemDetailsFilter.
}
