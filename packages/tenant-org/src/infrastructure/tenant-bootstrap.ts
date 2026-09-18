import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, isUniqueViolation, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { ROLE_PERMISSIONS_VERSION } from '@hmedic/identity-access';
import { normalizeBdMobile } from '@hmedic/localization';
import { slugify, soloOwnerGrants } from '../domain/rules';

export interface BootstrapInput {
  name: string;
  slug?: string | undefined;
  practiceType: 'SOLO' | 'GROUP';
  owner: { email?: string | undefined; phone?: string | undefined; displayName: string };
  actor: { userId: string | null; type: 'OPERATOR' | 'SYSTEM' };
  requestId?: string | undefined;
}

export interface BootstrapResult {
  tenantId: string;
  slug: string;
  ownerUserId: string;
  ownerMembershipId: string;
  ownerDoctorProfileId: string | null;
}

/**
 * Tenant bootstrap (API §3.3 `POST /tenants`, platform operator only; also used by the seed). A SOLO tenant
 * is created as GROUP and switched to SOLO with its owner doctor in the same transaction (the composite FK
 * `tenants(id, owner_doctor_profile_id) → doctor_profiles(tenant_id, id)` needs the profile to exist first).
 */
export class TenantBootstrapService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly clock: Clock = systemClock,
  ) {}

  async bootstrap(input: BootstrapInput, tx?: Tx): Promise<BootstrapResult> {
    const email = input.owner.email?.trim().toLowerCase();
    const phone = input.owner.phone ? normalizeBdMobile(input.owner.phone) : null;
    if (input.owner.phone && !phone) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'owner.phone', code: 'invalid_string', message: 'validation.phone_bd_mobile' }],
      });
    }
    if (!email && !phone) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'owner.email', code: 'required', message: 'validation.email_or_phone' }],
      });
    }
    const slug = input.slug ?? `${slugify(input.name) || 'clinic'}-${newId().slice(-6)}`;
    const run = async (t: Tx): Promise<BootstrapResult> => {
      const now = this.clock.now();
      const tenantId = newId();
      await t.tenant.create({
        data: { id: tenantId, name: input.name, slug, status: 'ACTIVE', createdAt: now, updatedAt: now },
      });
      let user = email
        ? await t.user.findUnique({ where: { emailNormalized: email } })
        : await t.user.findUnique({ where: { phoneE164: phone! } });
      user ??= await t.user.create({
        data: {
          id: newId(),
          email: email ?? null,
          emailNormalized: email ?? null,
          phoneE164: phone,
          displayName: input.owner.displayName,
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        },
      });
      const solo = input.practiceType === 'SOLO';
      const membershipId = newId();
      await t.tenantMembership.create({
        data: {
          id: membershipId,
          tenantId,
          userId: user.id,
          role: solo ? 'doctor' : 'tenant_owner',
          permissions: { grants: solo ? soloOwnerGrants() : [], denials: [] },
          clinicIds: [],
          chamberIds: [],
          status: 'ACTIVE',
          rolePermissionsVersion: ROLE_PERMISSIONS_VERSION,
          createdAt: now,
          updatedAt: now,
          createdByUserId: input.actor.userId,
          updatedByUserId: input.actor.userId,
        },
      });
      let ownerDoctorProfileId: string | null = null;
      if (solo) {
        ownerDoctorProfileId = newId();
        await t.doctorProfile.create({
          data: {
            id: ownerDoctorProfileId,
            tenantId,
            userId: user.id,
            displayName: input.owner.displayName,
            specialties: [],
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
            createdByUserId: input.actor.userId,
            updatedByUserId: input.actor.userId,
          },
        });
        await t.tenant.update({
          where: { id: tenantId },
          data: { practiceType: 'SOLO', ownerDoctorProfileId, rowVersion: { increment: 1 } },
        });
      } else {
        await t.staffProfile.create({
          data: {
            id: newId(),
            tenantId,
            userId: user.id,
            title: 'tenant_owner',
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
            createdByUserId: input.actor.userId,
            updatedByUserId: input.actor.userId,
          },
        });
      }
      const entry = {
        actorUserId: input.actor.userId,
        actorType: input.actor.type,
        action: 'TENANT_BOOTSTRAPPED',
        resourceType: 'tenant',
        resourceId: tenantId,
        outcome: 'SUCCESS' as const,
        requestId: input.requestId ?? null,
        rolePermissionsVersion: ROLE_PERMISSIONS_VERSION,
        metadata: { practiceType: input.practiceType, ownerMembershipId: membershipId },
      };
      await this.audit.append(t, { ...entry, tenantId });
      await this.audit.append(t, { ...entry, tenantId: null });
      return { tenantId, slug, ownerUserId: user.id, ownerMembershipId: membershipId, ownerDoctorProfileId };
    };
    try {
      return tx ? await run(tx) : await withTransaction(this.prisma, run);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_tenants_slug')) {
        throw new AppError('VALIDATION_FAILED', undefined, {
          fieldErrors: [{ path: 'slug', code: 'taken', message: 'validation.slug_taken' }],
        });
      }
      throw error;
    }
  }
}
