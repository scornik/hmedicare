import {
  AppError,
  type Clock,
  type FieldError,
  type StaffRole,
  type TenantContext,
  newId,
  systemClock,
} from '@hmedic/kernel';
import {
  type PrismaClient,
  type Tx,
  assertRowVersionMatched,
  lockRow,
  withTransaction,
} from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { PolicyEngine, ROLE_PERMISSIONS_VERSION, isStaffRole } from '@hmedic/identity-access';
import { normalizeBdMobile } from '@hmedic/localization';

export interface PermissionOverrides {
  grants: string[];
  denials: string[];
}

export interface MembershipView {
  id: string;
  userId: string;
  displayName: string | null;
  email: string | null;
  /** The staff member's active doctor profile, or null for anyone who is not a doctor. */
  doctorProfileId: string | null;
  role: StaffRole;
  status: string;
  permissions: PermissionOverrides;
  clinicIds: string[];
  chamberIds: string[];
  rowVersion: number;
}

interface Actor {
  userId: string;
  tenant: TenantContext;
  requestId?: string;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function overridesOf(value: unknown): PermissionOverrides {
  const v = (value ?? {}) as { grants?: unknown; denials?: unknown };
  return { grants: strings(v.grants), denials: strings(v.denials) };
}

function validation(fieldErrors: FieldError[]): AppError {
  return new AppError('VALIDATION_FAILED', undefined, { fieldErrors });
}

/**
 * Membership management (AUTHORIZATION-MATRIX §1.2, §5 row 1; API §3.3). Overrides are validated against the
 * tenant catalog on write (platform permissions rejected, T31); clinic admins cannot create owners or grant
 * tenant.manage / ai.policy.manage; nobody changes their own role/status; the last active owner stays.
 */
export class MembershipService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly clock: Clock = systemClock,
  ) {}

  private checkOverrides(role: StaffRole, overrides: PermissionOverrides, actor: Actor): void {
    const problems = PolicyEngine.validateOverrides(role, overrides, actor.tenant.role);
    if (problems.length) {
      throw validation(
        problems.map((p) => ({
          path: `permissions.${p.permission}`,
          code: p.kind,
          message: `validation.${p.kind.toLowerCase()}`,
        })),
      );
    }
  }

  private checkRoleAssignment(role: StaffRole, actor: Actor): void {
    if (role === 'tenant_owner' && actor.tenant.role !== 'tenant_owner') throw new AppError('FORBIDDEN');
  }

  async list(tenantId: string): Promise<MembershipView[]> {
    const rows = await this.prisma.tenantMembership.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, displayName: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    // A doctor's clinical identity is their profile, not their membership, and creating a chamber asks
    // for the profile. Without this a tenant could list its doctors and still have no way to name one
    // (audit row C-56), which is how a fresh installation ended up unable to create its first chamber.
    const profiles = await this.prisma.doctorProfile.findMany({
      where: { tenantId, userId: { in: rows.map((r) => r.userId) }, status: 'ACTIVE' },
      select: { id: true, userId: true },
    });
    const profileByUser = new Map(profiles.map((p) => [p.userId, p.id]));
    return rows.map((m) => this.view(m, byId.get(m.userId), profileByUser.get(m.userId) ?? null));
  }

  private view(
    m: {
      id: string;
      userId: string;
      role: string;
      status: string;
      permissions: unknown;
      clinicIds: unknown;
      chamberIds: unknown;
      rowVersion: number;
    },
    u?: { displayName: string | null; email: string | null },
    doctorProfileId: string | null = null,
  ): MembershipView {
    return {
      id: m.id,
      userId: m.userId,
      displayName: u?.displayName ?? null,
      email: u?.email ?? null,
      doctorProfileId,
      role: m.role as StaffRole,
      status: m.status,
      permissions: overridesOf(m.permissions),
      clinicIds: strings(m.clinicIds),
      chamberIds: strings(m.chamberIds),
      rowVersion: m.rowVersion,
    };
  }

  /** Creates (or reuses) the user by email/phone and adds an ACTIVE membership plus its profile row. */
  async create(
    actor: Actor,
    input: {
      email?: string | undefined;
      phone?: string | undefined;
      displayName: string;
      role: StaffRole;
      permissions?: PermissionOverrides | undefined;
      clinicIds?: string[] | undefined;
      chamberIds?: string[] | undefined;
    },
    tx?: Tx,
  ): Promise<MembershipView> {
    if (!isStaffRole(input.role))
      throw validation([{ path: 'role', code: 'invalid_enum_value', message: 'validation.role' }]);
    this.checkRoleAssignment(input.role, actor);
    const overrides = input.permissions ?? { grants: [], denials: [] };
    this.checkOverrides(input.role, overrides, actor);
    const email = input.email?.trim().toLowerCase();
    const phone = input.phone ? normalizeBdMobile(input.phone) : null;
    if (input.phone && !phone)
      throw validation([{ path: 'phone', code: 'invalid_string', message: 'validation.phone_bd_mobile' }]);
    if (!email && !phone)
      throw validation([{ path: 'email', code: 'required', message: 'validation.email_or_phone' }]);
    const tenantId = actor.tenant.tenantId;
    const run = async (t: Tx) => {
      const now = this.clock.now();
      let user = email
        ? await t.user.findUnique({ where: { emailNormalized: email } })
        : await t.user.findUnique({ where: { phoneE164: phone! } });
      if (!user) {
        user = await t.user.create({
          data: {
            id: newId(),
            email: email ?? null,
            emailNormalized: email ?? null,
            phoneE164: phone,
            displayName: input.displayName,
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      if (
        await t.tenantMembership.findFirst({ where: { tenantId, userId: user.id }, select: { id: true } })
      ) {
        throw validation([
          { path: email ? 'email' : 'phone', code: 'already_member', message: 'validation.already_member' },
        ]);
      }
      const membership = await t.tenantMembership.create({
        data: {
          id: newId(),
          tenantId,
          userId: user.id,
          role: input.role,
          permissions: overrides as never,
          clinicIds: input.clinicIds ?? [],
          chamberIds: input.chamberIds ?? [],
          status: 'ACTIVE',
          rolePermissionsVersion: ROLE_PERMISSIONS_VERSION,
          createdAt: now,
          updatedAt: now,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await this.ensureProfile(t, tenantId, user.id, input.role, input.displayName, actor.userId, now);
      await this.audit.append(t, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'MEMBERSHIP_CREATED',
        resourceType: 'tenant_membership',
        resourceId: membership.id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        rolePermissionsVersion: ROLE_PERMISSIONS_VERSION,
        metadata: { role: input.role, grants: overrides.grants, denials: overrides.denials },
      });
      return this.view(membership, user);
    };
    return tx ? run(tx) : withTransaction(this.prisma, run);
  }

  async ensureProfile(
    t: Tx,
    tenantId: string,
    userId: string,
    role: StaffRole,
    displayName: string,
    actorUserId: string | null,
    now: Date,
  ) {
    if (role === 'doctor') {
      if (!(await t.doctorProfile.findFirst({ where: { tenantId, userId }, select: { id: true } }))) {
        await t.doctorProfile.create({
          data: {
            id: newId(),
            tenantId,
            userId,
            displayName,
            specialties: [],
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId,
          },
        });
      }
    } else if (!(await t.staffProfile.findFirst({ where: { tenantId, userId }, select: { id: true } }))) {
      await t.staffProfile.create({
        data: {
          id: newId(),
          tenantId,
          userId,
          title: role,
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        },
      });
    }
  }

  async update(
    actor: Actor,
    membershipId: string,
    input: {
      expectedRowVersion: number;
      role?: StaffRole | undefined;
      permissions?: PermissionOverrides | undefined;
      clinicIds?: string[] | undefined;
      chamberIds?: string[] | undefined;
      status?: 'ACTIVE' | 'SUSPENDED' | 'REMOVED' | undefined;
    },
  ): Promise<MembershipView> {
    const tenantId = actor.tenant.tenantId;
    return withTransaction(this.prisma, async (t) => {
      if (!(await lockRow(t, 'tenant_memberships', membershipId, tenantId)))
        throw new AppError('RESOURCE_NOT_FOUND');
      const current = await t.tenantMembership.findUniqueOrThrow({ where: { id: membershipId } });
      if (current.rowVersion !== input.expectedRowVersion) throw new AppError('STALE_VERSION');
      const self = current.userId === actor.userId;
      if (
        self &&
        (input.role !== undefined || input.status !== undefined || input.permissions !== undefined)
      ) {
        throw new AppError('FORBIDDEN');
      }
      if (current.role === 'tenant_owner' && actor.tenant.role !== 'tenant_owner')
        throw new AppError('FORBIDDEN');
      const role = (input.role ?? current.role) as StaffRole;
      if (input.role !== undefined) this.checkRoleAssignment(input.role, actor);
      const overrides = input.permissions ?? overridesOf(current.permissions);
      if (input.permissions !== undefined || input.role !== undefined)
        this.checkOverrides(role, overrides, actor);
      const status = input.status ?? current.status;
      if (
        current.role === 'tenant_owner' &&
        current.status === 'ACTIVE' &&
        (role !== 'tenant_owner' || status !== 'ACTIVE')
      ) {
        const owners = await t.tenantMembership.count({
          where: { tenantId, role: 'tenant_owner', status: 'ACTIVE' },
        });
        if (owners <= 1)
          throw validation([{ path: 'role', code: 'last_owner', message: 'validation.last_owner' }]);
      }
      const now = this.clock.now();
      const r = await t.tenantMembership.updateMany({
        where: { id: membershipId, tenantId, rowVersion: input.expectedRowVersion },
        data: {
          role,
          permissions: overrides as never,
          clinicIds: input.clinicIds ?? strings(current.clinicIds),
          chamberIds: input.chamberIds ?? strings(current.chamberIds),
          status,
          rolePermissionsVersion: ROLE_PERMISSIONS_VERSION,
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      assertRowVersionMatched(r.count);
      const permissionsChanged =
        input.permissions !== undefined &&
        JSON.stringify(overrides) !== JSON.stringify(overridesOf(current.permissions));
      await this.audit.append(t, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: permissionsChanged ? 'MEMBERSHIP_PERMISSIONS_CHANGED' : 'MEMBERSHIP_UPDATED',
        resourceType: 'tenant_membership',
        resourceId: membershipId,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        rolePermissionsVersion: ROLE_PERMISSIONS_VERSION,
        metadata: {
          fromRole: current.role,
          toRole: role,
          fromStatus: current.status,
          toStatus: status,
          grants: overrides.grants,
          denials: overrides.denials,
        },
      });
      if (role === 'doctor' && current.role !== 'doctor') {
        const u = await t.user.findUniqueOrThrow({
          where: { id: current.userId },
          select: { displayName: true },
        });
        await this.ensureProfile(
          t,
          tenantId,
          current.userId,
          role,
          u.displayName ?? 'Doctor',
          actor.userId,
          now,
        );
      }
      const updated = await t.tenantMembership.findUniqueOrThrow({ where: { id: membershipId } });
      const u = await t.user.findUniqueOrThrow({
        where: { id: updated.userId },
        select: { displayName: true, email: true },
      });
      return this.view(updated, u);
    });
  }
}
