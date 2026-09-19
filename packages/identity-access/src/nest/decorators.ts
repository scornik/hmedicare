import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '@hmedic/kernel';
import type { ActorContext, TenantContext } from '@hmedic/kernel';
import type { PlatformPermission, TenantPermission } from '../domain/authz/permissions';

import type { ResolvedPatientContext } from '../application/ports';

export const REQUIRED_PERMISSION = 'hm:required-permission';
export const REQUIRES_TENANT = 'hm:requires-tenant';
export const PLATFORM_ROUTE = 'hm:platform-route';
export const PATIENT_CONTEXT_ROUTE = 'hm:patient-context-route';
export const TENANT_MEMBERSHIP_OPTIONAL = 'hm:tenant-membership-optional';

export interface PatientContextRouteOptions {
  /** Guardian authority scope required for this route (SELF contexts always pass). */
  scope?: string;
  /** `'only'`: the route exists for patient contexts alone; `'or-staff'`: a staff permission also works. */
  mode: 'only' | 'or-staff';
}

/**
 * Route accepts `X-Patient-Context` (AUTHORIZATION-MATRIX §4). With `mode: 'or-staff'` the route's
 * `@RequirePermission` applies only when no patient context is presented; the use case then branches on
 * which context it received. Scope checks happen in the guard; resource scope stays in the use case.
 */
export const PatientContextRoute = (options: PatientContextRouteOptions) =>
  SetMetadata(PATIENT_CONTEXT_ROUTE, options);

export const CurrentPatientContext = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ResolvedPatientContext | undefined =>
    ctx.switchToHttp().getRequest<FastifyRequest>().hm?.patientContext,
);

/**
 * Platform operator route (AUTH §2.6, API §3.12): requires `X-Platform-Context: operator`, a pwd+otp session,
 * an ACTIVE operator holding `permission`; audited on the platform chain. Never combined with X-Tenant-ID.
 */
export const PlatformRoute = (permission: PlatformPermission) => SetMetadata(PLATFORM_ROUTE, permission);

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

/** The staff tenant context when present; `undefined` on a patient-context request (`@PatientContextRoute`). */
export const OptionalTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantContext | undefined =>
    ctx.switchToHttp().getRequest<FastifyRequest>().hm?.tenant,
);

/**
 * Route that any authenticated user may call with `X-Tenant-ID` naming a tenant they are not a member of
 * (AUTHORIZATION-MATRIX §4: a patient user requesting a guardianship). The guard still resolves a membership
 * when one exists; without one it records only the tenant id, never a TenantContext.
 */
export const TenantMembershipOptional = () => SetMetadata(TENANT_MEMBERSHIP_OPTIONAL, true);
