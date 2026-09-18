import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError, isUuid } from '@hmedic/kernel';
import { withTransaction } from '@hmedic/database';
import { HTTP_RUNTIME, type HttpRuntime, PUBLIC_ROUTE, hmState, routeTemplate } from '@hmedic/http-kit';
import { enrichLogContext, hashForLog } from '@hmedic/observability';
import type { TenantPermission } from '../domain/authz/permissions';
import { REQUIRED_PERMISSION, REQUIRES_TENANT } from './decorators';
import { IDENTITY_SERVICES, type IdentityServices } from './identity-services';

function header(request: FastifyRequest, name: string): string | undefined {
  const v = request.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Default-deny request authentication and authorization (AUTH-IMPLEMENTATION §2.5): every route needs a
 * valid bearer access token unless marked `@Public()`. `X-Tenant-ID` resolves a membership-backed
 * TenantContext; `@RequirePermission` checks effective permissions. Resource scope stays in use cases.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  // Stateless; constructed here rather than injected so the guard works even when the package resolves its
  // own copy of @nestjs/core (optional peer variants), where Reflector class identity differs.
  private readonly reflector = new Reflector();

  constructor(
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
    @Inject(IDENTITY_SERVICES) private readonly identity: IdentityServices,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = header(request, 'authorization');
    if (!auth?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED');
    const actor = await this.identity.sessions.authenticate(auth.slice(7));
    const state = hmState(request);
    state.actor = actor;
    state.actorUserId = actor.userId;
    enrichLogContext({ actorHash: hashForLog(actor.userId, this.runtime.config.LOG_HASH_PEPPER) });

    const tenantHeader = header(request, 'x-tenant-id');
    if (tenantHeader !== undefined && header(request, 'x-platform-context') !== undefined) {
      throw new AppError('PLATFORM_CONTEXT_REQUIRED');
    }
    const permission = this.reflector.getAllAndOverride<TenantPermission | undefined>(
      REQUIRED_PERMISSION,
      targets,
    );
    const requiresTenant =
      permission !== undefined || this.reflector.getAllAndOverride<boolean>(REQUIRES_TENANT, targets);

    if (tenantHeader !== undefined) {
      if (!isUuid(tenantHeader)) throw new AppError('TENANT_CONTEXT_REQUIRED');
      const tenant = await this.identity.tenants.resolve(actor.userId, tenantHeader);
      if (!tenant) {
        await this.deny(request, actor.userId, null, 'CROSS_TENANT_ATTEMPT');
        throw new AppError('FORBIDDEN');
      }
      state.tenant = tenant;
      state.tenantId = tenant.tenantId;
      enrichLogContext({ tenantHash: hashForLog(tenant.tenantId, this.runtime.config.LOG_HASH_PEPPER) });
    } else if (requiresTenant) {
      throw new AppError('TENANT_CONTEXT_REQUIRED');
    }

    if (permission !== undefined && !state.tenant?.effectivePermissions.has(permission)) {
      await this.deny(request, actor.userId, state.tenant?.tenantId ?? null, 'AUTHZ_DENIED', permission);
      throw new AppError('FORBIDDEN');
    }
    return true;
  }

  /** Security audit of a denial (tenant chain when known). Bounded by the caller's own requests. */
  private async deny(
    request: FastifyRequest,
    userId: string,
    tenantId: string | null,
    action: 'CROSS_TENANT_ATTEMPT' | 'AUTHZ_DENIED',
    permission?: string,
  ): Promise<void> {
    await withTransaction(this.runtime.prisma, (tx) =>
      this.runtime.audit.append(tx, {
        tenantId,
        actorUserId: userId,
        actorType: 'USER',
        action,
        resourceType: 'route',
        outcome: 'DENIED',
        requestId: request.id,
        rolePermissionsVersion: request.hm?.tenant?.rolePermissionsVersion ?? null,
        metadata: {
          route: `${request.method} ${routeTemplate(request)}`,
          ...(permission ? { permission } : {}),
        },
      }),
    );
  }
}
