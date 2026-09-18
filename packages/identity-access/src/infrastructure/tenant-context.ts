import type { MembershipId, TenantContext, TenantId } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import { PolicyEngine, isStaffRole } from '../domain/authz/policy-engine';

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Resolves `X-Tenant-ID` into a TenantContext (AUTH-IMPLEMENTATION §2.5 step 4): an ACTIVE membership in an
 * ACTIVE tenant; effective permissions from the PolicyEngine. Read-only access to `tenant_memberships`
 * (owned and written by tenant-org). Never cached across requests.
 */
export class TenantContextResolver {
  constructor(private readonly prisma: PrismaClient) {}

  async resolve(userId: string, tenantId: string): Promise<TenantContext | null> {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { tenantId, userId, status: 'ACTIVE' },
    });
    if (!membership || !isStaffRole(membership.role)) return null;
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!tenant) return null;
    const overrides = (membership.permissions ?? {}) as { grants?: unknown; denials?: unknown };
    return {
      tenantId: tenantId as TenantId,
      membershipId: membership.id as MembershipId,
      role: membership.role,
      effectivePermissions: PolicyEngine.effectivePermissions(membership.role, {
        grants: stringArray(overrides.grants),
        denials: stringArray(overrides.denials),
      }),
      clinicIds: stringArray(membership.clinicIds),
      chamberIds: stringArray(membership.chamberIds),
      rolePermissionsVersion: PolicyEngine.version,
    };
  }
}
