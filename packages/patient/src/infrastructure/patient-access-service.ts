import { createHash } from 'node:crypto';
import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, isUniqueViolation, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { dhakaDate } from '@hmedic/localization';
import { GUARDIAN_SCOPES, type PatientActor } from '../application/ports';
import type { PatientEvents } from './events';

export interface PatientAccountView {
  id: string;
  userId: string;
  patientId: string;
  relationship: 'SELF';
  verificationMethod: string;
  status: string;
  verifiedAt: string | null;
  createdAt: string;
  rowVersion: number;
}

export interface GuardianshipView {
  id: string;
  guardianUserId: string;
  guardianPatientId: string | null;
  dependentPatientId: string;
  relationship: string;
  authorityScope: string[];
  status: string;
  verificationMethod: string | null;
  startsOn: string;
  endsOn: string | null;
  createdAt: string;
  rowVersion: number;
}

export interface CareTeamMemberView {
  id: string;
  patientId: string;
  memberUserId: string;
  role: string;
  startsAt: string;
  endsAt: string | null;
  reason: string | null;
  rowVersion: number;
}

/** A patient user (OTP-authenticated) acting outside any tenant context. */
export interface PatientUser {
  userId: string;
  phoneE164: string | null;
  requestId?: string;
  correlationId?: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const localDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dateValue = (s: string) => new Date(`${s}T00:00:00.000Z`);

/**
 * Patient accounts, guardianships and care teams (AUTHORIZATION-MATRIX §4; DOMAIN-SERVICE-CONTRACTS §1).
 * - OTP login alone links nothing. `autoLinkOnOtpVerify` links a user to exactly one patient per tenant whose
 *   VERIFIED phone equals the verified login phone; several matches → nothing (staff verify).
 * - A guardianship becomes ACTIVE only through staff with `guardianship.manage`.
 */
export class PatientAccessService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly events: PatientEvents,
    private readonly clock: Clock = systemClock,
  ) {}

  private accountView(a: {
    id: string;
    userId: string;
    patientId: string;
    verificationMethod: string;
    status: string;
    verifiedAt: Date | null;
    createdAt: Date;
    rowVersion: number;
  }): PatientAccountView {
    return {
      id: a.id,
      userId: a.userId,
      patientId: a.patientId,
      relationship: 'SELF',
      verificationMethod: a.verificationMethod,
      status: a.status,
      verifiedAt: a.verifiedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      rowVersion: a.rowVersion,
    };
  }

  private guardianshipView(g: {
    id: string;
    guardianUserId: string;
    guardianPatientId: string | null;
    dependentPatientId: string;
    relationship: string;
    authorityScope: unknown;
    status: string;
    verificationMethod: string | null;
    startsOn: Date;
    endsOn: Date | null;
    createdAt: Date;
    rowVersion: number;
  }): GuardianshipView {
    return {
      id: g.id,
      guardianUserId: g.guardianUserId,
      guardianPatientId: g.guardianPatientId,
      dependentPatientId: g.dependentPatientId,
      relationship: g.relationship,
      authorityScope: Array.isArray(g.authorityScope) ? (g.authorityScope as string[]) : [],
      status: g.status,
      verificationMethod: g.verificationMethod,
      startsOn: localDate(g.startsOn)!,
      endsOn: localDate(g.endsOn),
      createdAt: g.createdAt.toISOString(),
      rowVersion: g.rowVersion,
    };
  }

  private careView(c: {
    id: string;
    patientId: string;
    memberUserId: string;
    role: string;
    startsAt: Date;
    endsAt: Date | null;
    reason: string | null;
    rowVersion: number;
  }): CareTeamMemberView {
    return {
      id: c.id,
      patientId: c.patientId,
      memberUserId: c.memberUserId,
      role: c.role,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt?.toISOString() ?? null,
      reason: c.reason,
      rowVersion: c.rowVersion,
    };
  }

  // ---------------------------------------------------------------- accounts

  /**
   * Called after OTP verification (AUTHORIZATION-MATRIX §4): for every ACTIVE tenant where exactly one ACTIVE
   * patient has this VERIFIED phone as an active contact, create (or keep) an ACTIVE `OTP_PHONE_MATCH`
   * account. Idempotent. Returns the tenant ids linked in this call.
   */
  async autoLinkOnOtpVerify(userId: string, phoneE164: string, correlationId?: string): Promise<string[]> {
    const contacts = await this.prisma.patientContact.findMany({
      where: {
        type: 'PHONE',
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
        normalizedValueHash: sha256(phoneE164),
      },
      select: { tenantId: true, patientId: true },
    });
    const perTenant = new Map<string, Set<string>>();
    for (const c of contacts)
      perTenant.set(c.tenantId, new Set([...(perTenant.get(c.tenantId) ?? []), c.patientId]));
    const linked: string[] = [];
    for (const [tenantId, patients] of perTenant) {
      if (patients.size !== 1) continue; // ambiguous: staff must verify
      const patientId = [...patients][0]!;
      const now = this.clock.now();
      const done = await withTransaction(this.prisma, async (tx) => {
        const existing = await tx.patientAccount.findFirst({
          where: { tenantId, userId, patientId, status: { in: ['PENDING', 'ACTIVE'] } },
        });
        if (existing?.status === 'ACTIVE') return false;
        const patient = await tx.patient.findFirst({ where: { tenantId, id: patientId, status: 'ACTIVE' } });
        if (!patient) return false;
        let id: string;
        if (existing) {
          id = existing.id;
          await tx.patientAccount.update({
            where: { id },
            data: {
              status: 'ACTIVE',
              verificationMethod: 'OTP_PHONE_MATCH',
              verifiedAt: now,
              updatedAt: now,
              rowVersion: { increment: 1 },
            },
          });
        } else {
          id = newId();
          try {
            await tx.patientAccount.create({
              data: {
                id,
                tenantId,
                userId,
                patientId,
                relationship: 'SELF',
                verificationMethod: 'OTP_PHONE_MATCH',
                verifiedAt: now,
                status: 'ACTIVE',
                createdAt: now,
                updatedAt: now,
              },
            });
          } catch (error) {
            if (isUniqueViolation(error, 'uq_patient_accounts_live')) return false;
            throw error;
          }
        }
        await this.audit.append(tx, {
          tenantId,
          actorUserId: userId,
          actorType: 'PATIENT_CONTEXT',
          actingAs: 'SELF',
          onBehalfOfPatientId: patientId,
          action: 'PATIENT_ACCOUNT_LINKED',
          resourceType: 'patient_account',
          resourceId: id,
          outcome: 'SUCCESS',
          correlationId: correlationId ?? null,
          metadata: { patientId, method: 'OTP_PHONE_MATCH' },
        });
        await this.events.emit(tx, {
          tenantId,
          name: 'PatientAccountLinked',
          aggregateType: 'patient_account',
          aggregateId: id,
          actorId: userId,
          correlationId,
          payload: { accountId: id, patientId, userId, method: 'OTP_PHONE_MATCH' },
        });
        return true;
      });
      if (done) linked.push(tenantId);
    }
    return linked;
  }

  /** `POST /patient-accounts/link-requests`: a PENDING request the tenant's staff must verify. */
  async requestLink(
    user: PatientUser,
    input: { tenantId: string; patientId: string },
  ): Promise<PatientAccountView> {
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { tenantId: input.tenantId, id: input.patientId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!patient) throw new AppError('FORBIDDEN');
      try {
        const row = await tx.patientAccount.create({
          data: {
            id: newId(),
            tenantId: input.tenantId,
            userId: user.userId,
            patientId: input.patientId,
            relationship: 'SELF',
            verificationMethod: 'STAFF_VERIFIED_IN_PERSON',
            status: 'PENDING',
            createdAt: now,
            updatedAt: now,
          },
        });
        await this.audit.append(tx, {
          tenantId: input.tenantId,
          actorUserId: user.userId,
          actorType: 'PATIENT_CONTEXT',
          actingAs: 'SELF',
          onBehalfOfPatientId: input.patientId,
          action: 'PATIENT_ACCOUNT_LINK_REQUESTED',
          resourceType: 'patient_account',
          resourceId: row.id,
          outcome: 'SUCCESS',
          requestId: user.requestId ?? null,
          metadata: { patientId: input.patientId },
        });
        return this.accountView(row);
      } catch (error) {
        if (isUniqueViolation(error, 'uq_patient_accounts_live')) {
          throw new AppError('VALIDATION_FAILED', undefined, {
            fieldErrors: [
              { path: 'patientId', code: 'already_requested', message: 'validation.already_requested' },
            ],
          });
        }
        throw error;
      }
    });
  }

  async listAccounts(
    actor: PatientActor,
    input: { status?: string; cursor?: string; limit?: number },
  ): Promise<{ items: PatientAccountView[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const rows = await this.prisma.patientAccount.findMany({
      where: {
        tenantId: actor.tenant.tenantId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.cursor ? { id: { lt: input.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => this.accountView(r)),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      hasMore: rows.length > limit,
    };
  }

  async verifyAccount(
    actor: PatientActor,
    accountId: string,
    input: { expectedRowVersion: number; method: 'STAFF_VERIFIED_IN_PERSON' | 'STAFF_VERIFIED_DOCUMENT' },
  ): Promise<PatientAccountView> {
    return this.transitionAccount(actor, accountId, input.expectedRowVersion, 'PENDING', 'ACTIVE', {
      verificationMethod: input.method,
      verifiedByUserId: actor.userId,
      verifiedAt: this.clock.now(),
    });
  }

  async revokeAccount(
    actor: PatientActor,
    accountId: string,
    expectedRowVersion: number,
  ): Promise<PatientAccountView> {
    return this.transitionAccount(actor, accountId, expectedRowVersion, null, 'REVOKED', {});
  }

  private async transitionAccount(
    actor: PatientActor,
    accountId: string,
    expectedRowVersion: number,
    from: string | null,
    to: 'ACTIVE' | 'REVOKED',
    extra: Record<string, unknown>,
  ): Promise<PatientAccountView> {
    const tenantId = actor.tenant.tenantId;
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      if (!(await lockRow(tx, 'patient_accounts', accountId, tenantId)))
        throw new AppError('RESOURCE_NOT_FOUND');
      const a = await tx.patientAccount.findUniqueOrThrow({ where: { id: accountId } });
      if (a.rowVersion !== expectedRowVersion) throw new AppError('STALE_VERSION');
      if (from !== null && a.status !== from) throw new AppError('INVALID_TRANSITION');
      if (a.status === 'REVOKED') throw new AppError('INVALID_TRANSITION');
      const row = await tx.patientAccount.update({
        where: { id: accountId },
        data: {
          ...extra,
          status: to,
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        } as never,
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: to === 'ACTIVE' ? 'PATIENT_ACCOUNT_VERIFIED' : 'PATIENT_ACCOUNT_REVOKED',
        resourceType: 'patient_account',
        resourceId: accountId,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        rolePermissionsVersion: actor.tenant.rolePermissionsVersion,
        metadata: { patientId: a.patientId, userId: a.userId },
      });
      if (to === 'ACTIVE') {
        await this.events.emit(tx, {
          tenantId,
          name: 'PatientAccountLinked',
          aggregateType: 'patient_account',
          aggregateId: accountId,
          actorId: actor.userId,
          correlationId: actor.correlationId,
          payload: {
            accountId,
            patientId: a.patientId,
            userId: a.userId,
            method: String(extra.verificationMethod),
          },
        });
      }
      return this.accountView(row);
    });
  }

  // ---------------------------------------------------------------- guardianships

  /** `POST /patients/{id}/guardianships`: PENDING from a patient user; staff may create PENDING too. */
  async requestGuardianship(
    who: { kind: 'staff'; actor: PatientActor } | { kind: 'user'; user: PatientUser; tenantId: string },
    dependentPatientId: string,
    input: {
      guardianUserId?: string;
      guardianPatientId?: string;
      relationship: string;
      authorityScope: string[];
    },
  ): Promise<GuardianshipView> {
    const tenantId = who.kind === 'staff' ? who.actor.tenant.tenantId : who.tenantId;
    const guardianUserId = who.kind === 'staff' ? input.guardianUserId : who.user.userId;
    if (!guardianUserId) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'guardianUserId', code: 'required', message: 'validation.required' }],
      });
    }
    const scope = [...new Set(input.authorityScope)].filter((s) =>
      (GUARDIAN_SCOPES as readonly string[]).includes(s),
    );
    if (scope.length === 0) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'authorityScope', code: 'empty', message: 'validation.empty' }],
      });
    }
    const now = this.clock.now();
    const actorUserId = who.kind === 'staff' ? who.actor.userId : who.user.userId;
    return withTransaction(this.prisma, async (tx) => {
      const dependent = await tx.patient.findFirst({
        where: { tenantId, id: dependentPatientId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!dependent) throw new AppError(who.kind === 'staff' ? 'RESOURCE_NOT_FOUND' : 'FORBIDDEN');
      if (input.guardianPatientId) {
        const gp = await tx.patient.findFirst({
          where: { tenantId, id: input.guardianPatientId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!gp) throw new AppError('RESOURCE_NOT_FOUND');
      }
      let row;
      try {
        row = await tx.patientGuardianship.create({
          data: {
            id: newId(),
            tenantId,
            guardianUserId,
            guardianPatientId: input.guardianPatientId ?? null,
            dependentPatientId,
            relationship: input.relationship,
            authorityScope: scope,
            status: 'PENDING',
            startsOn: dateValue(dhakaDate(now)),
            createdAt: now,
            updatedAt: now,
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error, 'uq_guardianships_live')) {
          throw new AppError('VALIDATION_FAILED', undefined, {
            fieldErrors: [
              {
                path: 'dependentPatientId',
                code: 'already_requested',
                message: 'validation.already_requested',
              },
            ],
          });
        }
        throw error;
      }
      await this.audit.append(tx, {
        tenantId,
        actorUserId,
        actorType: who.kind === 'staff' ? 'USER' : 'PATIENT_CONTEXT',
        actingAs: who.kind === 'staff' ? null : 'SELF',
        onBehalfOfPatientId: who.kind === 'staff' ? null : dependentPatientId,
        action: 'GUARDIANSHIP_REQUESTED',
        resourceType: 'patient_guardianship',
        resourceId: row.id,
        outcome: 'SUCCESS',
        requestId: (who.kind === 'staff' ? who.actor.requestId : who.user.requestId) ?? null,
        metadata: { dependentPatientId, guardianUserId, relationship: input.relationship, scope },
      });
      await this.events.emit(tx, {
        tenantId,
        name: 'GuardianshipRequested',
        aggregateType: 'patient_guardianship',
        aggregateId: row.id,
        actorId: actorUserId,
        payload: {
          guardianshipId: row.id,
          dependentPatientId,
          guardianUserId,
          relationship: input.relationship,
        },
      });
      return this.guardianshipView(row);
    });
  }

  async listGuardianships(
    actor: PatientActor,
    input: { patientId?: string; status?: string; cursor?: string; limit?: number },
  ): Promise<{ items: GuardianshipView[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const rows = await this.prisma.patientGuardianship.findMany({
      where: {
        tenantId: actor.tenant.tenantId,
        ...(input.patientId ? { dependentPatientId: input.patientId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.cursor ? { id: { lt: input.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => this.guardianshipView(r)),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      hasMore: rows.length > limit,
    };
  }

  async activateGuardianship(
    actor: PatientActor,
    id: string,
    input: {
      expectedRowVersion: number;
      verificationMethod: 'STAFF_VERIFIED_IN_PERSON' | 'STAFF_VERIFIED_DOCUMENT';
      evidenceRef?: string;
      startsOn?: string;
      endsOn?: string | null;
      authorityScope?: string[];
    },
  ): Promise<GuardianshipView> {
    const tenantId = actor.tenant.tenantId;
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      if (!(await lockRow(tx, 'patient_guardianships', id, tenantId)))
        throw new AppError('RESOURCE_NOT_FOUND');
      const g = await tx.patientGuardianship.findUniqueOrThrow({ where: { id } });
      if (g.rowVersion !== input.expectedRowVersion) throw new AppError('STALE_VERSION');
      if (g.status !== 'PENDING') throw new AppError('INVALID_TRANSITION');
      const startsOn = input.startsOn ? dateValue(input.startsOn) : g.startsOn;
      const endsOn =
        input.endsOn === undefined ? g.endsOn : input.endsOn === null ? null : dateValue(input.endsOn);
      if (endsOn && endsOn < startsOn) {
        throw new AppError('VALIDATION_FAILED', undefined, {
          fieldErrors: [{ path: 'endsOn', code: 'before_start', message: 'validation.before_start' }],
        });
      }
      const scope = input.authorityScope
        ? [...new Set(input.authorityScope)].filter((s) => (GUARDIAN_SCOPES as readonly string[]).includes(s))
        : (g.authorityScope as string[]);
      const row = await tx.patientGuardianship.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          verificationMethod: input.verificationMethod,
          verifiedByUserId: actor.userId,
          verifiedAt: now,
          evidenceRef: input.evidenceRef ?? null,
          startsOn,
          endsOn,
          authorityScope: scope,
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'GUARDIANSHIP_ACTIVATED',
        resourceType: 'patient_guardianship',
        resourceId: id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        rolePermissionsVersion: actor.tenant.rolePermissionsVersion,
        metadata: { dependentPatientId: g.dependentPatientId, method: input.verificationMethod, scope },
      });
      await this.events.emit(tx, {
        tenantId,
        name: 'GuardianshipActivated',
        aggregateType: 'patient_guardianship',
        aggregateId: id,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        payload: {
          guardianshipId: id,
          dependentPatientId: g.dependentPatientId,
          guardianUserId: g.guardianUserId,
        },
      });
      return this.guardianshipView(row);
    });
  }

  async endGuardianship(
    actor: PatientActor,
    id: string,
    input: { expectedRowVersion: number; outcome: 'ENDED' | 'REVOKED'; reason?: string },
  ): Promise<GuardianshipView> {
    const tenantId = actor.tenant.tenantId;
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      if (!(await lockRow(tx, 'patient_guardianships', id, tenantId)))
        throw new AppError('RESOURCE_NOT_FOUND');
      const g = await tx.patientGuardianship.findUniqueOrThrow({ where: { id } });
      if (g.rowVersion !== input.expectedRowVersion) throw new AppError('STALE_VERSION');
      if (g.status !== 'PENDING' && g.status !== 'ACTIVE') throw new AppError('INVALID_TRANSITION');
      const today = dateValue(dhakaDate(now));
      const row = await tx.patientGuardianship.update({
        where: { id },
        data: {
          status: input.outcome,
          endsOn: g.endsOn && g.endsOn < today ? g.endsOn : today < g.startsOn ? g.startsOn : today,
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: input.outcome === 'ENDED' ? 'GUARDIANSHIP_ENDED' : 'GUARDIANSHIP_REVOKED',
        resourceType: 'patient_guardianship',
        resourceId: id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        rolePermissionsVersion: actor.tenant.rolePermissionsVersion,
        metadata: { dependentPatientId: g.dependentPatientId, reason: input.reason ?? null },
      });
      await this.events.emit(tx, {
        tenantId,
        name: 'GuardianshipEnded',
        aggregateType: 'patient_guardianship',
        aggregateId: id,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        payload: { guardianshipId: id, dependentPatientId: g.dependentPatientId, outcome: input.outcome },
      });
      return this.guardianshipView(row);
    });
  }

  // ---------------------------------------------------------------- care team

  async listCareTeam(actor: PatientActor, patientId: string): Promise<CareTeamMemberView[]> {
    const rows = await this.prisma.careTeamMember.findMany({
      where: { tenantId: actor.tenant.tenantId, patientId },
      orderBy: [{ endsAt: 'asc' }, { startsAt: 'desc' }],
      take: 200,
    });
    return rows.map((r) => this.careView(r));
  }

  async addCareTeamMember(
    actor: PatientActor,
    patientId: string,
    input: { memberUserId: string; role: 'DOCTOR' | 'NURSE' | 'OTHER'; reason?: string; startsAt?: string },
  ): Promise<CareTeamMemberView> {
    const tenantId = actor.tenant.tenantId;
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { tenantId, id: patientId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!patient) throw new AppError('RESOURCE_NOT_FOUND');
      const member = await tx.tenantMembership.findFirst({
        where: { tenantId, userId: input.memberUserId, status: 'ACTIVE' },
        select: { role: true },
      });
      if (!member) throw new AppError('RESOURCE_NOT_FOUND');
      if (input.role === 'DOCTOR' && member.role !== 'doctor') {
        throw new AppError('VALIDATION_FAILED', undefined, {
          fieldErrors: [{ path: 'role', code: 'member_not_doctor', message: 'validation.member_not_doctor' }],
        });
      }
      if (input.role === 'NURSE' && member.role !== 'nurse') {
        throw new AppError('VALIDATION_FAILED', undefined, {
          fieldErrors: [{ path: 'role', code: 'member_not_nurse', message: 'validation.member_not_nurse' }],
        });
      }
      let row;
      try {
        row = await tx.careTeamMember.create({
          data: {
            id: newId(),
            tenantId,
            patientId,
            memberUserId: input.memberUserId,
            role: input.role,
            startsAt: input.startsAt ? new Date(input.startsAt) : now,
            reason: input.reason ?? null,
            addedByUserId: actor.userId,
            createdAt: now,
            updatedAt: now,
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error, 'uq_care_team_open')) {
          throw new AppError('VALIDATION_FAILED', undefined, {
            fieldErrors: [
              { path: 'memberUserId', code: 'already_member', message: 'validation.already_member' },
            ],
          });
        }
        throw error;
      }
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'CARE_TEAM_MEMBER_ADDED',
        resourceType: 'care_team_member',
        resourceId: row.id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        rolePermissionsVersion: actor.tenant.rolePermissionsVersion,
        metadata: { patientId, memberUserId: input.memberUserId, role: input.role },
      });
      await this.events.emit(tx, {
        tenantId,
        name: 'CareTeamMemberAdded',
        aggregateType: 'care_team_member',
        aggregateId: row.id,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        payload: { careTeamMemberId: row.id, patientId, memberUserId: input.memberUserId, role: input.role },
      });
      return this.careView(row);
    });
  }

  async endCareTeamMember(
    actor: PatientActor,
    id: string,
    expectedRowVersion: number,
  ): Promise<CareTeamMemberView> {
    const tenantId = actor.tenant.tenantId;
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      if (!(await lockRow(tx, 'care_team_members', id, tenantId))) throw new AppError('RESOURCE_NOT_FOUND');
      const c = await tx.careTeamMember.findUniqueOrThrow({ where: { id } });
      if (c.rowVersion !== expectedRowVersion) throw new AppError('STALE_VERSION');
      if (c.endsAt !== null) throw new AppError('INVALID_TRANSITION');
      const endsAt = now > c.startsAt ? now : new Date(c.startsAt.getTime() + 1000);
      const row = await tx.careTeamMember.update({
        where: { id },
        data: { endsAt, updatedAt: now, updatedByUserId: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'CARE_TEAM_MEMBER_ENDED',
        resourceType: 'care_team_member',
        resourceId: id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        rolePermissionsVersion: actor.tenant.rolePermissionsVersion,
        metadata: { patientId: c.patientId, memberUserId: c.memberUserId },
      });
      await this.events.emit(tx, {
        tenantId,
        name: 'CareTeamMemberEnded',
        aggregateType: 'care_team_member',
        aggregateId: id,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        payload: { careTeamMemberId: id, patientId: c.patientId, memberUserId: c.memberUserId },
      });
      return this.careView(row);
    });
  }

  /** AssignmentPolicy rule 3 helper: active care-team membership of `userId` for `patientId` at `at`. */
  async isCareTeamMember(
    tx: Tx | PrismaClient,
    tenantId: string,
    patientId: string,
    userId: string,
    role: string,
    at: Date,
  ) {
    const row = await tx.careTeamMember.findFirst({
      where: {
        tenantId,
        patientId,
        memberUserId: userId,
        role,
        startsAt: { lte: at },
        OR: [{ endsAt: null }, { endsAt: { gt: at } }],
      },
      select: { id: true },
    });
    return row !== null;
  }
}
