import { AppError, type Clock, type TenantContext, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { validateCoverage } from '../domain/rules';

export interface CoverageView {
  id: string;
  coveredDoctorProfileId: string;
  coveringDoctorProfileId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  status: string;
  rowVersion: number;
}

interface Actor {
  userId: string;
  tenant: TenantContext;
  requestId?: string;
}

/**
 * Doctor coverage (AUTHORIZATION-MATRIX §3 rule 4, §5 "Care team / coverage"): owners/admins manage any
 * coverage; a doctor granted `coverage.manage` manages only coverages of their own doctor profile.
 * Coverage is not transitive and never outlives `COVERAGE_MAX_DAYS`.
 */
export class CoverageService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly maxDays: number,
    private readonly clock: Clock = systemClock,
  ) {}

  private view(c: {
    id: string;
    coveredDoctorProfileId: string;
    coveringDoctorProfileId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string;
    status: string;
    rowVersion: number;
  }): CoverageView {
    return { ...c, startsAt: c.startsAt.toISOString(), endsAt: c.endsAt.toISOString() };
  }

  private async ownDoctorProfileId(actor: Actor): Promise<string | null> {
    if (actor.tenant.role !== 'doctor') return null;
    const own = await this.prisma.doctorProfile.findFirst({
      where: { tenantId: actor.tenant.tenantId, userId: actor.userId },
      select: { id: true },
    });
    return own?.id ?? null;
  }

  async list(actor: Actor): Promise<CoverageView[]> {
    const own = await this.ownDoctorProfileId(actor);
    const rows = await this.prisma.doctorCoverage.findMany({
      where: {
        tenantId: actor.tenant.tenantId,
        ...(actor.tenant.role === 'doctor'
          ? { OR: [{ coveredDoctorProfileId: own ?? '-' }, { coveringDoctorProfileId: own ?? '-' }] }
          : {}),
      },
      orderBy: { startsAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.view(r));
  }

  async grant(
    actor: Actor,
    input: {
      coveredDoctorProfileId: string;
      coveringDoctorProfileId: string;
      startsAt: Date;
      endsAt: Date;
      reason: string;
    },
  ): Promise<CoverageView> {
    const now = this.clock.now();
    const problems = validateCoverage({ ...input, maxDays: this.maxDays, now });
    if (problems.length) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: problems.map((p) => ({ ...p, message: `validation.coverage_${p.code}` })),
      });
    }
    const tenantId = actor.tenant.tenantId;
    if (
      actor.tenant.role === 'doctor' &&
      (await this.ownDoctorProfileId(actor)) !== input.coveredDoctorProfileId
    ) {
      throw new AppError('FORBIDDEN');
    }
    const doctors = await this.prisma.doctorProfile.count({
      where: {
        tenantId,
        status: 'ACTIVE',
        id: { in: [input.coveredDoctorProfileId, input.coveringDoctorProfileId] },
      },
    });
    if (doctors !== 2) throw new AppError('RESOURCE_NOT_FOUND');
    return withTransaction(this.prisma, async (t) => {
      const c = await t.doctorCoverage.create({
        data: {
          id: newId(),
          tenantId,
          coveredDoctorProfileId: input.coveredDoctorProfileId,
          coveringDoctorProfileId: input.coveringDoctorProfileId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          reason: input.reason,
          status: 'ACTIVE',
          grantedByUserId: actor.userId,
          createdAt: now,
          updatedAt: now,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await this.audit.append(t, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'COVERAGE_GRANTED',
        resourceType: 'doctor_coverage',
        resourceId: c.id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        metadata: {
          coveredDoctorProfileId: c.coveredDoctorProfileId,
          coveringDoctorProfileId: c.coveringDoctorProfileId,
          startsAt: c.startsAt.toISOString(),
          endsAt: c.endsAt.toISOString(),
        },
      });
      return this.view(c);
    });
  }

  async revoke(actor: Actor, coverageId: string, expectedRowVersion: number): Promise<CoverageView> {
    const tenantId = actor.tenant.tenantId;
    const own = await this.ownDoctorProfileId(actor);
    return withTransaction(this.prisma, async (t) => {
      if (!(await lockRow(t, 'doctor_coverages', coverageId, tenantId)))
        throw new AppError('RESOURCE_NOT_FOUND');
      const c = await t.doctorCoverage.findUniqueOrThrow({ where: { id: coverageId } });
      if (actor.tenant.role === 'doctor' && c.coveredDoctorProfileId !== own) throw new AppError('FORBIDDEN');
      if (c.rowVersion !== expectedRowVersion) throw new AppError('STALE_VERSION');
      if (c.status !== 'ACTIVE') throw new AppError('INVALID_TRANSITION');
      const now = this.clock.now();
      const updated = await t.doctorCoverage.update({
        where: { id: coverageId },
        data: {
          status: 'REVOKED',
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.append(t, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'COVERAGE_REVOKED',
        resourceType: 'doctor_coverage',
        resourceId: coverageId,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        metadata: {},
      });
      return this.view(updated);
    });
  }

  /** Active coverers of a doctor at `at` (non-transitive; used by AssignmentPolicy rule 4 in Stage 5). */
  async activeCoverers(tenantId: string, coveredDoctorProfileId: string, at: Date): Promise<string[]> {
    const rows = await this.prisma.doctorCoverage.findMany({
      where: {
        tenantId,
        coveredDoctorProfileId,
        status: 'ACTIVE',
        startsAt: { lte: at },
        endsAt: { gt: at },
      },
      select: { coveringDoctorProfileId: true },
    });
    return rows.map((r) => r.coveringDoctorProfileId);
  }
}
