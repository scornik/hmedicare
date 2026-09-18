import { AppError, type Clock, type PlatformContext, type UserId, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import {
  PLATFORM_PERMISSIONS,
  type PlatformPermission,
  isPlatformPermission,
} from '../domain/authz/permissions';

function permissionsOf(value: unknown): PlatformPermission[] {
  return Array.isArray(value)
    ? value.filter((v): v is PlatformPermission => typeof v === 'string' && isPlatformPermission(v))
    : [];
}

/**
 * Platform operators (AUTH §2.6, AUTHORIZATION-MATRIX §1.1): explicit subset of the platform catalog, no
 * implicit superuser, no tenant data. Grants/revocations always append a platform-chain audit event.
 */
export class PlatformOperatorService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly clock: Clock = systemClock,
  ) {}

  async resolve(userId: string): Promise<PlatformContext | null> {
    const row = await this.prisma.platformOperator.findFirst({ where: { userId, status: 'ACTIVE' } });
    if (!row) return null;
    return {
      operatorId: row.id,
      userId: userId as UserId,
      permissions: new Set(permissionsOf(row.permissions)),
    };
  }

  /**
   * Grants (or re-grants) operator permissions. `grantedBy` is the CLI identity for DB-access grants or the
   * granting operator's user id. Operators cannot grant to themselves.
   */
  async grant(input: {
    email: string;
    permissions: string[];
    grantedBy: string;
    grantorUserId: string | null;
  }): Promise<{ operatorId: string; userId: string; permissions: PlatformPermission[] }> {
    const unknown = input.permissions.filter((p) => !isPlatformPermission(p));
    if (unknown.length || input.permissions.length === 0) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [
          { path: 'permissions', code: 'invalid_enum_value', message: 'validation.platform_permission' },
        ],
      });
    }
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { emailNormalized: email } });
    if (!user || user.status !== 'ACTIVE') throw new AppError('RESOURCE_NOT_FOUND');
    if (input.grantorUserId !== null && input.grantorUserId === user.id) throw new AppError('FORBIDDEN');
    if (!user.passwordHash || !user.phoneE164 || !user.phoneVerifiedAt) {
      // Operators authenticate with password + OTP on every session.
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [
          {
            path: 'email',
            code: 'needs_password_and_verified_phone',
            message: 'validation.operator_prerequisites',
          },
        ],
      });
    }
    const permissions = [...new Set(input.permissions as PlatformPermission[])].sort();
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      const existing = await tx.platformOperator.findUnique({ where: { userId: user.id } });
      const operatorId = existing?.id ?? newId();
      if (existing) {
        await tx.platformOperator.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            permissions,
            grantedBy: input.grantedBy,
            grantedAt: now,
            revokedAt: null,
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });
      } else {
        await tx.platformOperator.create({
          data: {
            id: operatorId,
            userId: user.id,
            status: 'ACTIVE',
            permissions,
            grantedBy: input.grantedBy,
            grantedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      await this.audit.append(tx, {
        tenantId: null,
        actorUserId: input.grantorUserId,
        actorType: input.grantorUserId ? 'OPERATOR' : 'SYSTEM',
        action: 'PLATFORM_OPERATOR_GRANTED',
        resourceType: 'platform_operator',
        resourceId: operatorId,
        outcome: 'SUCCESS',
        metadata: { userId: user.id, permissions, grantedBy: input.grantedBy },
      });
      return { operatorId, userId: user.id, permissions };
    });
  }

  async revoke(input: { email: string; revokedBy: string; revokerUserId: string | null }): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: input.email.trim().toLowerCase() },
    });
    const row = user ? await this.prisma.platformOperator.findUnique({ where: { userId: user.id } }) : null;
    if (!user || !row) throw new AppError('RESOURCE_NOT_FOUND');
    const now = this.clock.now();
    await withTransaction(this.prisma, async (tx) => {
      await tx.platformOperator.update({
        where: { id: row.id },
        data: { status: 'REVOKED', revokedAt: now, updatedAt: now, rowVersion: { increment: 1 } },
      });
      await this.audit.append(tx, {
        tenantId: null,
        actorUserId: input.revokerUserId,
        actorType: input.revokerUserId ? 'OPERATOR' : 'SYSTEM',
        action: 'PLATFORM_OPERATOR_REVOKED',
        resourceType: 'platform_operator',
        resourceId: row.id,
        outcome: 'SUCCESS',
        metadata: { userId: user.id, revokedBy: input.revokedBy },
      });
    });
  }
}

export { PLATFORM_PERMISSIONS };
