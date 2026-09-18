import type { StaffRole } from '@hmedic/kernel';
import { STAFF_ROLES, type TenantPermission, isPlatformPermission, isTenantPermission } from './permissions';
import {
  CLINIC_ADMIN_CANNOT_GRANT,
  NON_GRANTABLE,
  ROLE_PERMISSIONS,
  ROLE_PERMISSIONS_VERSION,
} from './role-permissions';

/** `tenant_memberships.permissions` JSON (AUTHORIZATION-MATRIX §1.2). */
export interface MembershipPermissionOverrides {
  grants: readonly string[];
  denials: readonly string[];
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

export type OverrideProblem =
  | { kind: 'UNKNOWN_PERMISSION'; permission: string }
  | { kind: 'PLATFORM_PERMISSION'; permission: string }
  | { kind: 'NOT_GRANTABLE_TO_ROLE'; permission: string }
  | { kind: 'GRANTOR_CANNOT_GRANT'; permission: string };

/**
 * PolicyEngine (AUTHORIZATION-MATRIX §1): `effective = (ROLE_PERMISSIONS[role] ∪ grants) − denials`;
 * denials always win. Pure and deterministic; resource scope is checked by use cases.
 */
export const PolicyEngine = {
  version: ROLE_PERMISSIONS_VERSION,

  effectivePermissions(
    role: StaffRole,
    overrides: MembershipPermissionOverrides = { grants: [], denials: [] },
  ) {
    const set = new Set<string>(ROLE_PERMISSIONS[role]);
    for (const g of overrides.grants) if (isTenantPermission(g)) set.add(g);
    for (const d of overrides.denials) set.delete(d);
    return set as ReadonlySet<string>;
  },

  can(effective: ReadonlySet<string>, permission: TenantPermission): boolean {
    return effective.has(permission);
  },

  /**
   * Validates overrides on write: tenant catalog only (platform permissions rejected), per-role
   * non-grantable approvals, and grantor restrictions (clinic admins cannot grant tenant.manage /
   * ai.policy.manage).
   */
  validateOverrides(
    role: StaffRole,
    overrides: MembershipPermissionOverrides,
    grantorRole: StaffRole | null,
  ): OverrideProblem[] {
    const problems: OverrideProblem[] = [];
    for (const p of [...overrides.grants, ...overrides.denials]) {
      if (isPlatformPermission(p)) problems.push({ kind: 'PLATFORM_PERMISSION', permission: p });
      else if (!isTenantPermission(p)) problems.push({ kind: 'UNKNOWN_PERMISSION', permission: p });
    }
    for (const g of overrides.grants) {
      if (!isTenantPermission(g)) continue;
      if (NON_GRANTABLE[role]?.includes(g)) problems.push({ kind: 'NOT_GRANTABLE_TO_ROLE', permission: g });
      if (grantorRole === 'clinic_admin' && CLINIC_ADMIN_CANNOT_GRANT.includes(g)) {
        problems.push({ kind: 'GRANTOR_CANNOT_GRANT', permission: g });
      }
    }
    return problems;
  },
};
