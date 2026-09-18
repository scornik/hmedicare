import {
  type ArgumentsHost,
  type CallHandler,
  Catch,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  type LoggerService,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type Observable, catchError, from, map, mergeMap, of, throwError } from 'rxjs';
import { AppError } from '@hmedic/kernel';
import { withTransaction } from '@hmedic/database';
import { IDEMPOTENCY_KEY_RE, isIdempotencyConflict, requestHash } from '@hmedic/jobs';
import { IDEMPOTENT, RATE_LIMITS, RAW_RESPONSE, type RouteRateLimit } from './decorators';
import { sendProblem } from './fastify-hooks';
import { hmState, routeTemplate, setResponseStatus } from './request';
import { HTTP_RUNTIME, type HttpRuntime } from './runtime';

/** Maps every error to ProblemDetails (API-IMPLEMENTATION §1). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(@Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    void sendProblem(
      this.runtime,
      http.getRequest<FastifyRequest>(),
      http.getResponse<FastifyReply>(),
      error,
    );
  }
}

/** `{data, meta: {requestId, replayed?}}` envelope for every non-raw route. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    return next.handle().pipe(
      map((data: unknown) => ({
        data: data ?? null,
        meta: { requestId: request.id, ...(request.hm?.replayed ? { replayed: true } : {}) },
      })),
    );
  }
}

function defaultStatus(reflector: Reflector, context: ExecutionContext, method: string): number {
  const explicit = reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler());
  return explicit ?? (method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);
}

/**
 * Idempotency (API-IMPLEMENTATION §1, DATABASE-IMPLEMENTATION §3.2). Begins an IN_PROGRESS record before
 * the handler (a concurrent duplicate gets 409), then completes it with the response. Use cases that mutate
 * the database complete it inside their own transaction via `completeIdempotencyInTx` so the stored
 * response exists iff the change committed.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const mode = this.reflector.get<'required' | 'optional' | undefined>(IDEMPOTENT, context.getHandler());
    if (!mode) return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const header = request.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    if (!key) {
      if (mode === 'required') throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
      return next.handle();
    }
    if (!IDEMPOTENCY_KEY_RE.test(key)) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [
          { path: 'Idempotency-Key', code: 'invalid_string', message: 'validation.invalid_string' },
        ],
      });
    }
    const state = hmState(request);
    const scope = {
      tenantId: state.tenantId ?? null,
      scope: `${request.method} ${routeTemplate(request)}`.slice(0, 96),
      key,
      actorUserId: state.actorUserId ?? null,
      requestHash: requestHash({
        method: request.method,
        path: routeTemplate(request),
        body: { params: request.params ?? null, body: request.body ?? null },
      }),
    };
    const store = this.runtime.idempotency;
    const status = defaultStatus(this.reflector, context, request.method);

    return from(store.lookup(scope)).pipe(
      mergeMap((found) => {
        if (found.state === 'REPLAY') {
          state.replayed = true;
          setResponseStatus(request, found.response.status);
          void reply.header('idempotent-replayed', 'true');
          return of(found.response.body);
        }
        const begin = withTransaction(this.runtime.prisma, (tx) => store.begin(tx, scope)).catch(
          (error: unknown) => {
            if (isIdempotencyConflict(error)) throw new AppError('IDEMPOTENCY_IN_PROGRESS');
            throw error;
          },
        );
        return from(begin).pipe(
          mergeMap((recordId) => {
            state.idempotency = { recordId, completedInTx: false };
            return next.handle().pipe(
              mergeMap((body: unknown) =>
                from(
                  (async () => {
                    if (!state.idempotency?.completedInTx) await store.complete(recordId, { status, body });
                    return body;
                  })(),
                ),
              ),
              catchError((error: unknown) =>
                from(store.markRetryable(recordId).catch(() => undefined)).pipe(
                  mergeMap(() => throwError(() => error)),
                ),
              ),
            );
          }),
        );
      }),
    );
  }
}

/** Route-level IP rate limits (`@RateLimit`). */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limits = this.reflector.get<RouteRateLimit[] | undefined>(RATE_LIMITS, context.getHandler());
    if (!limits?.length) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    await this.runtime.rateLimiter.enforce(limits.map((l) => ({ rule: l.rule, subject: request.ip })));
    return true;
  }
}

/** Nest framework logs go to the redacted pino logger. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly runtime: Pick<HttpRuntime, 'logger'>) {}
  log(message: unknown, context?: string) {
    this.runtime.logger.debug({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    this.runtime.logger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.runtime.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.runtime.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.runtime.logger.trace({ context }, String(message));
  }
}
