import { Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import { HTTP_RUNTIME, type HttpRuntime } from '@hmedic/http-kit';
import { maskPhone } from '@hmedic/localization';
import {
  CurrentActor,
  CurrentTenant,
  IDENTITY_SERVICES,
  type IdentityServices,
  RequireTenant,
} from '@hmedic/identity-access/nest';

/** MeUser DTO: no PHI beyond the caller's own masked phone and email. */
export async function loadMeUser(runtime: HttpRuntime, userId: string) {
  const u = await runtime.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    phoneMasked: u.phoneE164 ? maskPhone(u.phoneE164) : null,
    emailVerified: u.emailVerifiedAt !== null,
    phoneVerified: u.phoneVerifiedAt !== null,
  };
}

@Controller('me')
export class MeController {
  constructor(
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
    @Inject(IDENTITY_SERVICES) private readonly identity: IdentityServices,
  ) {}

  @Get()
  async me(@CurrentActor() actor: ActorContext) {
    const memberships = await this.runtime.prisma.tenantMembership.findMany({
      where: { userId: actor.userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    const tenants = await this.runtime.prisma.tenant.findMany({
      where: { id: { in: memberships.map((m) => m.tenantId) }, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    const operator = await this.runtime.prisma.platformOperator.findFirst({
      where: { userId: actor.userId, status: 'ACTIVE' },
      select: { id: true },
    });
    return {
      user: await loadMeUser(this.runtime, actor.userId),
      memberships: memberships
        .filter((m) => names.has(m.tenantId))
        .map((m) => ({
          membershipId: m.id,
          tenantId: m.tenantId,
          tenantName: names.get(m.tenantId)!,
          role: m.role,
        })),
      platformOperator: operator !== null,
    };
  }

  /**
   * Tenant picker for patient users (AUTHORIZATION-MATRIX §4). `patient_accounts`/`patient_guardianships`
   * arrive with the patient context in Stage 5, so no context can exist yet (deferred, IMPLEMENTATION-STATUS).
   */
  @Get('patient-contexts')
  patientContexts() {
    return [];
  }

  @Get('tenant-context')
  @RequireTenant()
  tenantContext(@CurrentTenant() tenant: TenantContext) {
    return {
      tenantId: tenant.tenantId,
      role: tenant.role,
      permissions: [...tenant.effectivePermissions].sort(),
      rolePermissionsVersion: tenant.rolePermissionsVersion,
    };
  }

  @Get('sessions')
  async sessions(@CurrentActor() actor: ActorContext) {
    const now = this.runtime.clock.now();
    const rows = await this.runtime.prisma.session.findMany({
      where: {
        userId: actor.userId,
        revokedAt: null,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 50,
    });
    return rows.map((s) => ({
      id: s.id,
      clientType: s.clientType,
      deviceLabel: s.deviceLabel,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s.id === actor.sessionId,
    }));
  }

  @Delete('sessions/:id')
  @HttpCode(200)
  async revokeSession(@CurrentActor() actor: ActorContext, @Param('id', new ParseUUIDPipe()) id: string) {
    const own = await this.runtime.prisma.session.findFirst({
      where: { id, userId: actor.userId },
      select: { id: true },
    });
    if (!own) throw new AppError('RESOURCE_NOT_FOUND');
    await this.identity.sessions.revoke(id, 'LOGOUT');
    return null;
  }
}
