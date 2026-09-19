import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { PatientActor, PatientContextActor } from '../application/ports';
import type { PatientEvents } from './events';

export interface ConsentView {
  id: string;
  patientId: string;
  purpose: string;
  status: string;
  policyVersion: number;
  givenByRelationship: string;
  capturedAt: string;
  withdrawnAt: string | null;
  rowVersion: number;
}

export type ConsentActor =
  { kind: 'staff'; actor: PatientActor } | { kind: 'context'; actor: PatientContextActor };

/**
 * Consents (DATABASE §3.4 `patient_consents`; DOMAIN-SERVICE-CONTRACTS §1). A grant is a new row; withdrawal
 * is the only permitted update. Guardians need the `GIVE_CONSENT` scope; consent rows record who gave them.
 */
export class ConsentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly events: PatientEvents,
    private readonly clock: Clock = systemClock,
  ) {}

  private view(c: {
    id: string;
    patientId: string;
    purpose: string;
    status: string;
    policyVersion: number;
    givenByRelationship: string;
    capturedAt: Date;
    withdrawnAt: Date | null;
    rowVersion: number;
  }): ConsentView {
    return {
      id: c.id,
      patientId: c.patientId,
      purpose: c.purpose,
      status: c.status,
      policyVersion: c.policyVersion,
      givenByRelationship: c.givenByRelationship,
      capturedAt: c.capturedAt.toISOString(),
      withdrawnAt: c.withdrawnAt?.toISOString() ?? null,
      rowVersion: c.rowVersion,
    };
  }

  private scope(a: ConsentActor, patientId: string) {
    if (a.kind === 'staff') {
      return {
        tenantId: a.actor.tenant.tenantId,
        userId: a.actor.userId,
        actorType: 'USER' as const,
        actingAs: null,
        relationship: 'STAFF_RECORDED' as const,
        requestId: a.actor.requestId ?? null,
        correlationId: a.actor.correlationId ?? null,
      };
    }
    if (a.actor.patientId !== patientId) throw new AppError('FORBIDDEN');
    if (a.actor.actingAs === 'GUARDIAN' && !a.actor.authorityScope.has('GIVE_CONSENT')) {
      throw new AppError('FORBIDDEN');
    }
    return {
      tenantId: a.actor.tenantId,
      userId: a.actor.userId,
      actorType: 'PATIENT_CONTEXT' as const,
      actingAs: a.actor.actingAs,
      relationship: a.actor.actingAs === 'GUARDIAN' ? ('GUARDIAN' as const) : ('SELF' as const),
      requestId: a.actor.requestId ?? null,
      correlationId: a.actor.correlationId ?? null,
    };
  }

  async list(a: ConsentActor, patientId: string): Promise<ConsentView[]> {
    const tenantId = a.kind === 'staff' ? a.actor.tenant.tenantId : a.actor.tenantId;
    if (a.kind === 'context' && a.actor.patientId !== patientId) throw new AppError('FORBIDDEN');
    const rows = await this.prisma.patientConsent.findMany({
      where: { tenantId, patientId },
      orderBy: [{ purpose: 'asc' }, { capturedAt: 'desc' }],
      take: 200,
    });
    return rows.map((r) => this.view(r));
  }

  async grant(
    a: ConsentActor,
    patientId: string,
    input: { purpose: string; policyVersion: number; evidenceRef?: string },
  ): Promise<ConsentView> {
    const s = this.scope(a, patientId);
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      if (!(await lockRow(tx, 'patients', patientId, s.tenantId))) throw new AppError('RESOURCE_NOT_FOUND');
      const row = await tx.patientConsent.create({
        data: {
          id: newId(),
          tenantId: s.tenantId,
          patientId,
          purpose: input.purpose,
          status: 'GRANTED',
          policyVersion: input.policyVersion,
          givenByUserId: s.userId,
          givenByRelationship: s.relationship,
          evidenceRef: input.evidenceRef ?? null,
          capturedAt: now,
          createdAt: now,
          updatedAt: now,
          createdByUserId: s.userId,
          updatedByUserId: s.userId,
        },
      });
      await this.audit.append(tx, {
        tenantId: s.tenantId,
        actorUserId: s.userId,
        actorType: s.actorType,
        actingAs: s.actingAs,
        onBehalfOfPatientId: s.actorType === 'PATIENT_CONTEXT' ? patientId : null,
        action: 'CONSENT_GRANTED',
        resourceType: 'patient_consent',
        resourceId: row.id,
        outcome: 'SUCCESS',
        requestId: s.requestId,
        correlationId: s.correlationId,
        metadata: { patientId, purpose: input.purpose, policyVersion: input.policyVersion },
      });
      await this.events.emit(tx, {
        tenantId: s.tenantId,
        name: 'ConsentGranted',
        aggregateType: 'patient_consent',
        aggregateId: row.id,
        actorId: s.userId,
        correlationId: s.correlationId,
        payload: { patientId, consentId: row.id, purpose: input.purpose, policyVersion: input.policyVersion },
      });
      return this.view(row);
    });
  }

  async withdraw(a: ConsentActor, consentId: string, expectedRowVersion: number): Promise<ConsentView> {
    const tenantId = a.kind === 'staff' ? a.actor.tenant.tenantId : a.actor.tenantId;
    const existing = await this.prisma.patientConsent.findFirst({ where: { tenantId, id: consentId } });
    if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
    const s = this.scope(a, existing.patientId);
    const now = this.clock.now();
    return withTransaction(this.prisma, async (tx) => {
      await lockRow(tx, 'patients', existing.patientId, tenantId);
      if (!(await lockRow(tx, 'patient_consents', consentId, tenantId)))
        throw new AppError('RESOURCE_NOT_FOUND');
      const c = await tx.patientConsent.findUniqueOrThrow({ where: { id: consentId } });
      if (c.rowVersion !== expectedRowVersion) throw new AppError('STALE_VERSION');
      if (c.status !== 'GRANTED') throw new AppError('INVALID_TRANSITION');
      const row = await tx.patientConsent.update({
        where: { id: consentId },
        data: {
          status: 'WITHDRAWN',
          withdrawnAt: now,
          updatedAt: now,
          updatedByUserId: s.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId: s.userId,
        actorType: s.actorType,
        actingAs: s.actingAs,
        onBehalfOfPatientId: s.actorType === 'PATIENT_CONTEXT' ? existing.patientId : null,
        action: 'CONSENT_WITHDRAWN',
        resourceType: 'patient_consent',
        resourceId: consentId,
        outcome: 'SUCCESS',
        requestId: s.requestId,
        correlationId: s.correlationId,
        metadata: { patientId: existing.patientId, purpose: c.purpose },
      });
      await this.events.emit(tx, {
        tenantId,
        name: 'ConsentWithdrawn',
        aggregateType: 'patient_consent',
        aggregateId: consentId,
        actorId: s.userId,
        correlationId: s.correlationId,
        payload: { patientId: existing.patientId, consentId, purpose: c.purpose },
      });
      return this.view(row);
    });
  }
}
