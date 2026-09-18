import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '@hmedic/kernel';
import type { ActorContext, TenantContext } from '@hmedic/kernel';
import type { TenantPermission } from '../domain/authz/permissions';

export const REQUIRED_PERMISSION = 'hm:required-permission';
export const REQUIRES_TENANT = 'hm:requires-tenant';

/** Route requires `X-Tenant-ID` with an ACTIVE membership holding `permission` (AUTH §2.5 step 6). */
export const RequirePermission = (permission: TenantPermission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

/** Route requires a tenant context but no specific permission (e.g. read own membership). */
export const RequireTenant = () => SetMetadata(REQUIRES_TENANT, true);

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): ActorContext => {
  const actor = ctx.switchToHttp().getRequest<FastifyRequest>().hm?.actor;
  if (!actor) throw new AppError('UNAUTHENTICATED');
  return actor;
});

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const tenant = ctx.switchToHttp().getRequest<FastifyRequest>().hm?.tenant;
  if (!tenant) throw new AppError('TENANT_CONTEXT_REQUIRED');
  return tenant;
});
