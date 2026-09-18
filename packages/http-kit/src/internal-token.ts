import { createHash, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError } from '@hmedic/kernel';
import { withTransaction } from '@hmedic/database';
import { SECURITY_ACTIONS } from '@hmedic/audit';
import { routeTemplate } from './request';
import { HTTP_RUNTIME, type HttpRuntime } from './runtime';

export const INTERNAL_TOKEN = 'hm:internal-token';
export type InternalTokenName = 'INTERNAL_METRICS_TOKEN' | 'INTERNAL_CRON_TOKEN';

/** Marks a route as protected by `Authorization: Bearer <token from env>` (API-IMPLEMENTATION §3.1). */
export const InternalToken = (name: InternalTokenName) => SetMetadata(INTERNAL_TOKEN, name);

/** Constant-time comparison of SHA-256 digests (length-independent). */
export function tokenMatches(presented: string | undefined, expected: string | undefined): boolean {
  if (!presented || !expected) return false;
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

const REJECTION_LIMIT = { scope: 'internal:ip', limit: 30, windowSeconds: 60 };

@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const name = this.reflector.get<InternalTokenName | undefined>(INTERNAL_TOKEN, context.getHandler());
    if (!name) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = request.headers.authorization;
    const presented = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (tokenMatches(presented, this.runtime.config[name])) return true;

    // Failures are rate-limited per IP before anything is written (no audit amplification).
    await this.runtime.rateLimiter.enforce([{ rule: REJECTION_LIMIT, subject: request.ip }]);
    await withTransaction(this.runtime.prisma, (tx) =>
      this.runtime.audit.append(tx, {
        tenantId: null,
        actorUserId: null,
        actorType: 'SYSTEM',
        action: SECURITY_ACTIONS.INTERNAL_TOKEN_REJECTED,
        resourceType: 'internal_route',
        outcome: 'DENIED',
        requestId: request.id,
        metadata: { route: routeTemplate(request), tokenPresent: presented !== undefined },
      }),
    );
    throw new AppError('UNAUTHENTICATED');
  }
}
