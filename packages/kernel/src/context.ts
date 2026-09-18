import type { MembershipId, SessionId, TenantId, UserId } from './ids';

/** Who is calling (AUTH-IMPLEMENTATION.md §2.5). No PHI, no tenant list. */
export interface ActorContext {
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly authnMethods: readonly string[];
  readonly clientType: 'WEB' | 'ANDROID' | 'IOS';
}

export type StaffRole =
  'tenant_owner' | 'clinic_admin' | 'doctor' | 'nurse' | 'receptionist' | 'billing_manager';

/** Resolved per request from X-Tenant-ID after a membership check. */
export interface TenantContext {
  readonly tenantId: TenantId;
  readonly membershipId: MembershipId;
  readonly role: StaffRole;
  readonly effectivePermissions: ReadonlySet<string>;
  readonly clinicIds: readonly string[];
  readonly chamberIds: readonly string[];
  readonly rolePermissionsVersion: number;
}

/** Platform operator context (AUTH-IMPLEMENTATION.md §2.6). Never combined with a TenantContext. */
export interface PlatformContext {
  readonly operatorId: string;
  readonly userId: UserId;
  readonly permissions: ReadonlySet<string>;
}

/** Request correlation carried into use cases, jobs and events. */
export interface RequestMeta {
  readonly requestId: string;
  readonly correlationId: string;
  readonly ipHash?: string | undefined;
  readonly userAgentHash?: string | undefined;
}
