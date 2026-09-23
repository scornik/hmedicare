import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { Metrics } from '@hmedic/observability';
import type { ClinicalAccessPolicy } from './clinical-access';
import type { ClinicalActor } from './encounter-service';
import type { ClinicalOutbox } from './events';

const TX_OPTS = { timeout: 15_000, maxWait: 10_000 } as const;

export const DIAGNOSIS_CLINICAL_STATUSES = ['ACTIVE', 'RESOLVED', 'RULED_OUT', 'ENTERED_IN_ERROR'] as const;
export const CERTAINTIES = ['CONFIRMED', 'PROVISIONAL', 'DIFFERENTIAL'] as const;
export const SYMPTOM_SEVERITIES = ['MILD', 'MODERATE', 'SEVERE', 'UNKNOWN'] as const;
export const SYMPTOM_SOURCES = ['PATIENT_REPORTED', 'CLINICIAN_OBSERVED'] as const;

export type DiagnosisClinicalStatus = (typeof DIAGNOSIS_CLINICAL_STATUSES)[number];
export type Certainty = (typeof CERTAINTIES)[number];

/**
 * The only `source` this stage can write. `ai_approved` exists in the schema for Stage 10 and is
 * deliberately not part of this union, so a code path that tried to set it would not compile — test 13
 * asserts the same thing from the outside.
 */
const HUMAN_SOURCE = 'doctor' as const;

export interface DiagnosisView {
  id: string;
  encounterId: string;
  patientId: string;
  authorDoctorProfileId: string;
  codeSystem: string | null;
  code: string | null;
  display: string;
  displayBn: string | null;
  clinicalStatus: DiagnosisClinicalStatus;
  certainty: Certainty;
  source: string;
  notes: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  replacesDiagnosisId: string | null;
  createdAt: string;
  rowVersion: number;
}

export interface SymptomView {
  id: string;
  encounterId: string;
  patientId: string;
  normalizedCode: string | null;
  codeSystem: string | null;
  display: string;
  detail: string | null;
  onset: string | null;
  severity: string | null;
  source: string;
  certainty: Certainty;
  status: string;
  createdAt: string;
  rowVersion: number;
}

type DiagnosisRow = {
  id: string;
  encounterId: string;
  patientId: string;
  authorDoctorProfileId: string;
  codeSystem: string | null;
  code: string | null;
  display: string;
  displayBn: string | null;
  clinicalStatus: string;
  certainty: string;
  source: string;
  notes: string | null;
  voidReason: string | null;
  voidedAt: Date | null;
  replacesDiagnosisId: string | null;
  createdAt: Date;
  rowVersion: number;
};

export function diagnosisView(r: DiagnosisRow): DiagnosisView {
  return {
    id: r.id,
    encounterId: r.encounterId,
    patientId: r.patientId,
    authorDoctorProfileId: r.authorDoctorProfileId,
    codeSystem: r.codeSystem,
    code: r.code,
    display: r.display,
    displayBn: r.displayBn,
    clinicalStatus: r.clinicalStatus as DiagnosisClinicalStatus,
    certainty: r.certainty as Certainty,
    source: r.source,
    notes: r.notes,
    voidReason: r.voidReason,
    voidedAt: r.voidedAt?.toISOString() ?? null,
    replacesDiagnosisId: r.replacesDiagnosisId,
    createdAt: r.createdAt.toISOString(),
    rowVersion: r.rowVersion,
  };
}

export interface AddDiagnosisInput {
  display: string;
  displayBn?: string | null;
  codeSystem?: string | null;
  code?: string | null;
  clinicalStatus?: DiagnosisClinicalStatus;
  certainty: Certainty;
  notes?: string | null;
  /** Set when this diagnosis replaces one just voided, so the correction reads as a correction. */
  replacesDiagnosisId?: string | null;
}

/**
 * Diagnoses and symptoms (CLIN-004).
 *
 * The rule that shapes this service is in the prompt and in DATABASE §3.8: a diagnosis is editable while
 * the note is unsigned, and after signing it is **voided with a reason and replaced**, never edited. The
 * reason is not bureaucratic. Once a note is signed, someone may have acted on the diagnosis in it — a
 * referral, a prescription, a decision not to investigate further. Editing it in place would make that
 * decision look like it was taken against text it never saw.
 *
 * Coding is optional and no code list ships. Free text is always allowed, and a code is accepted only
 * together with the system that issued it, which the database also enforces.
 */
export class DiagnosisService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly outbox: ClinicalOutbox,
    private readonly access: ClinicalAccessPolicy,
    private readonly clock: Clock = systemClock,
    private readonly metrics?: Metrics,
  ) {}

  private correlation(actor: ClinicalActor) {
    return {
      requestId: actor.requestId ?? null,
      correlationId: actor.correlationId ?? actor.requestId ?? newId(),
    };
  }

  /**
   * A diagnosis is attributable to the doctor who made it, so writing one needs assignment and a profile.
   * Reading is wider: the matrix gives nurses "C/R observed/proposed (scope)" on the diagnoses panel.
   */
  private async authorizeWrite(actor: ClinicalActor, encounterId: string) {
    const { encounter } = await this.access.assigned(actor, encounterId);
    if (!actor.doctorProfileId) throw new AppError('FORBIDDEN');
    return { tenantId: actor.tenant.tenantId, encounter, doctorProfileId: actor.doctorProfileId };
  }

  private async authorizeRead(actor: ClinicalActor, encounterId: string) {
    const { encounter } = await this.access.assignedOrScoped(actor, encounterId);
    return { tenantId: actor.tenant.tenantId, encounter };
  }

  /** True once any revision of the encounter's note has been signed. */
  private async isSigned(tenantId: string, encounterId: string): Promise<boolean> {
    const count = await this.prisma.encounterNoteVersion.count({ where: { tenantId, encounterId } });
    return count > 0;
  }

  private assertCoding(input: { code?: string | null; codeSystem?: string | null }): void {
    const hasCode = Boolean(input.code?.trim());
    const hasSystem = Boolean(input.codeSystem?.trim());
    if (hasCode !== hasSystem) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [
          {
            path: hasCode ? 'codeSystem' : 'code',
            code: 'required',
            message: 'validation.required',
          },
        ],
        // A code with no system says nothing about which vocabulary it belongs to, and a system with no
        // code is a label with nothing under it.
        details: { reason: 'code_and_system_together' },
      });
    }
  }

  async list(actor: ClinicalActor, encounterId: string): Promise<DiagnosisView[]> {
    const { tenantId } = await this.authorizeRead(actor, encounterId);
    const rows = await this.prisma.diagnosis.findMany({
      where: { tenantId, encounterId },
      orderBy: { createdAt: 'asc' },
    });
    await this.auditRead(actor, 'DIAGNOSIS_LIST_VIEWED', encounterId, { count: rows.length });
    return (rows as DiagnosisRow[]).map(diagnosisView);
  }

  async add(
    actor: ClinicalActor,
    encounterId: string,
    input: AddDiagnosisInput,
    opts: { idempotencyKey?: string | null } = {},
  ): Promise<DiagnosisView> {
    const { tenantId, encounter, doctorProfileId } = await this.authorizeWrite(actor, encounterId);
    this.assertCoding(input);
    if (encounter.status === 'COMPLETED' || encounter.status === 'ENTERED_IN_ERROR') {
      throw new AppError('INVALID_TRANSITION', undefined, {
        details: { encounterStatus: encounter.status, command: 'addDiagnosis' },
      });
    }
    const { requestId, correlationId } = this.correlation(actor);
    const now = this.clock.now();
    const id = newId();

    const row = await withTransaction(
      this.prisma,
      async (tx) => {
        if (input.replacesDiagnosisId) {
          const replaced = await tx.diagnosis.findFirst({
            where: { tenantId, id: input.replacesDiagnosisId, encounterId },
            select: { id: true, clinicalStatus: true },
          });
          if (!replaced) throw new AppError('RESOURCE_NOT_FOUND');
          // A replacement only makes sense for something that was withdrawn. Pointing at a live
          // diagnosis would leave two current answers and a claim that one supersedes the other.
          if (replaced.clinicalStatus !== 'ENTERED_IN_ERROR') {
            throw new AppError('INVALID_TRANSITION', undefined, {
              details: { replacesStatus: replaced.clinicalStatus, command: 'addDiagnosis' },
            });
          }
        }
        const created = await tx.diagnosis.create({
          data: {
            id,
            tenantId,
            encounterId,
            patientId: encounter.patientId,
            authorDoctorProfileId: doctorProfileId,
            codeSystem: input.codeSystem?.trim() || null,
            code: input.code?.trim() || null,
            display: input.display.trim(),
            displayBn: input.displayBn?.trim() || null,
            clinicalStatus: input.clinicalStatus ?? 'ACTIVE',
            certainty: input.certainty,
            source: HUMAN_SOURCE,
            notes: input.notes?.trim() || null,
            replacesDiagnosisId: input.replacesDiagnosisId ?? null,
            createdAt: now,
            updatedAt: now,
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
        });
        await this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'DIAGNOSIS_RECORDED',
          resourceType: 'diagnosis',
          resourceId: id,
          outcome: 'SUCCESS',
          requestId,
          correlationId,
          // No `display`: the wording of a diagnosis is clinical content, and the audit trail records
          // that one was made, not what it said.
          metadata: {
            encounterId,
            certainty: input.certainty,
            coded: Boolean(input.code),
            replaces: input.replacesDiagnosisId ?? null,
          },
        });
        await this.outbox.emit(tx, {
          tenantId,
          name: 'DiagnosisRecorded',
          aggregateType: 'diagnosis',
          aggregateId: id,
          // The diagnosis id is the event's `aggregateId`; `replacesId` is the one identifier that is
          // not already on the envelope. Neither the wording nor the reason travels.
          payload: {
            encounterId,
            patientId: encounter.patientId,
            certainty: input.certainty,
            coded: Boolean(input.code),
            replacesId: input.replacesDiagnosisId ?? null,
          },
          actorId: actor.userId,
          correlationId,
          idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:DiagnosisRecorded` : null,
        });
        return created as DiagnosisRow;
      },
      { ...TX_OPTS, context: 'diagnosis:add' },
    );
    return diagnosisView(row);
  }

  /**
   * Editing in place, allowed only while nothing has been signed. After that the record is fixed and the
   * route out is `void` plus a replacement.
   */
  async update(
    actor: ClinicalActor,
    diagnosisId: string,
    input: {
      expectedRowVersion: number;
      display?: string;
      displayBn?: string | null;
      codeSystem?: string | null;
      code?: string | null;
      clinicalStatus?: Exclude<DiagnosisClinicalStatus, 'ENTERED_IN_ERROR'>;
      certainty?: Certainty;
      notes?: string | null;
    },
  ): Promise<DiagnosisView> {
    const tenantId = actor.tenant.tenantId;
    const existing = await this.prisma.diagnosis.findFirst({ where: { tenantId, id: diagnosisId } });
    if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
    await this.authorizeWrite(actor, existing.encounterId);
    this.assertCoding({
      code: input.code ?? existing.code,
      codeSystem: input.codeSystem ?? existing.codeSystem,
    });
    if (await this.isSigned(tenantId, existing.encounterId)) {
      throw new AppError('INVALID_TRANSITION', undefined, {
        // The client turns this into "void and replace", which is the documented way to change a signed
        // diagnosis (prompt §3.3).
        details: { reason: 'note_signed', command: 'updateDiagnosis' },
      });
    }
    if (existing.clinicalStatus === 'ENTERED_IN_ERROR') {
      throw new AppError('INVALID_TRANSITION', undefined, {
        details: { clinicalStatus: existing.clinicalStatus, command: 'updateDiagnosis' },
      });
    }

    const { requestId, correlationId } = this.correlation(actor);
    const now = this.clock.now();
    const row = await withTransaction(
      this.prisma,
      async (tx) => {
        await lockRow(tx, 'diagnoses', diagnosisId, tenantId);
        const current = (await tx.diagnosis.findFirst({ where: { id: diagnosisId } })) as DiagnosisRow;
        if (current.rowVersion !== input.expectedRowVersion) {
          throw new AppError('STALE_VERSION', undefined, {
            details: { currentRowVersion: current.rowVersion },
          });
        }
        const updated = await tx.diagnosis.update({
          where: { id: diagnosisId },
          data: {
            ...(input.display !== undefined ? { display: input.display.trim() } : {}),
            ...(input.displayBn !== undefined ? { displayBn: input.displayBn?.trim() || null } : {}),
            ...(input.codeSystem !== undefined ? { codeSystem: input.codeSystem?.trim() || null } : {}),
            ...(input.code !== undefined ? { code: input.code?.trim() || null } : {}),
            ...(input.clinicalStatus !== undefined ? { clinicalStatus: input.clinicalStatus } : {}),
            ...(input.certainty !== undefined ? { certainty: input.certainty } : {}),
            ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'DIAGNOSIS_UPDATED',
          resourceType: 'diagnosis',
          resourceId: diagnosisId,
          outcome: 'SUCCESS',
          requestId,
          correlationId,
          metadata: { encounterId: current.encounterId, fields: Object.keys(input).length - 1 },
        });
        if (input.clinicalStatus !== undefined && input.clinicalStatus !== current.clinicalStatus) {
          await this.outbox.emit(tx, {
            tenantId,
            name: 'DiagnosisStatusChanged',
            aggregateType: 'diagnosis',
            aggregateId: diagnosisId,
            payload: {
              encounterId: current.encounterId,
              patientId: current.patientId,
              from: current.clinicalStatus,
              to: input.clinicalStatus,
              voided: false,
            },
            actorId: actor.userId,
            correlationId,
          });
        }
        return updated as DiagnosisRow;
      },
      { ...TX_OPTS, context: 'diagnosis:update' },
    );
    return diagnosisView(row);
  }

  /**
   * Void with a reason. The row stays, marked `ENTERED_IN_ERROR` and carrying who withdrew it and why,
   * because "this was wrong" is itself part of the record.
   */
  async void(
    actor: ClinicalActor,
    diagnosisId: string,
    input: { expectedRowVersion: number; reason: string },
    opts: { idempotencyKey?: string | null } = {},
  ): Promise<DiagnosisView> {
    const tenantId = actor.tenant.tenantId;
    const existing = await this.prisma.diagnosis.findFirst({ where: { tenantId, id: diagnosisId } });
    if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
    const { doctorProfileId } = await this.authorizeWrite(actor, existing.encounterId);
    const reason = input.reason.trim();
    if (!reason) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'reason', code: 'required', message: 'validation.required' }],
      });
    }

    const { requestId, correlationId } = this.correlation(actor);
    const now = this.clock.now();
    const row = await withTransaction(
      this.prisma,
      async (tx) => {
        await lockRow(tx, 'diagnoses', diagnosisId, tenantId);
        const current = (await tx.diagnosis.findFirst({ where: { id: diagnosisId } })) as DiagnosisRow;
        if (current.rowVersion !== input.expectedRowVersion) {
          throw new AppError('STALE_VERSION', undefined, {
            details: { currentRowVersion: current.rowVersion },
          });
        }
        if (current.clinicalStatus === 'ENTERED_IN_ERROR') {
          throw new AppError('INVALID_TRANSITION', undefined, {
            details: { clinicalStatus: current.clinicalStatus, command: 'voidDiagnosis' },
          });
        }
        const updated = await tx.diagnosis.update({
          where: { id: diagnosisId },
          data: {
            clinicalStatus: 'ENTERED_IN_ERROR',
            voidReason: reason.slice(0, 500),
            voidedAt: now,
            voidedByDoctorProfileId: doctorProfileId,
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'DIAGNOSIS_VOIDED',
          resourceType: 'diagnosis',
          resourceId: diagnosisId,
          outcome: 'SUCCESS',
          requestId,
          correlationId,
          metadata: { encounterId: current.encounterId, from: current.clinicalStatus },
        });
        await this.outbox.emit(tx, {
          tenantId,
          name: 'DiagnosisStatusChanged',
          aggregateType: 'diagnosis',
          aggregateId: diagnosisId,
          payload: {
            encounterId: current.encounterId,
            patientId: current.patientId,
            from: current.clinicalStatus,
            to: 'ENTERED_IN_ERROR',
            voided: true,
          },
          actorId: actor.userId,
          correlationId,
          idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:DiagnosisStatusChanged` : null,
        });
        return updated as DiagnosisRow;
      },
      { ...TX_OPTS, context: 'diagnosis:void' },
    );
    return diagnosisView(row);
  }

  // ------------------------------------------------------------------ symptoms

  async listSymptoms(actor: ClinicalActor, encounterId: string): Promise<SymptomView[]> {
    const { tenantId } = await this.authorizeRead(actor, encounterId);
    const rows = await this.prisma.symptomObservation.findMany({
      where: { tenantId, encounterId },
      orderBy: { createdAt: 'asc' },
    });
    await this.auditRead(actor, 'SYMPTOM_LIST_VIEWED', encounterId, { count: rows.length });
    return rows.map((r) => ({
      id: r.id,
      encounterId: r.encounterId,
      patientId: r.patientId,
      normalizedCode: r.normalizedCode,
      codeSystem: r.codeSystem,
      display: r.display,
      detail: r.detail,
      onset: r.onset,
      severity: r.severity,
      source: r.source,
      certainty: r.certainty as Certainty,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      rowVersion: r.rowVersion,
    }));
  }

  async addSymptom(
    actor: ClinicalActor,
    encounterId: string,
    input: {
      display: string;
      detail?: string | null;
      onset?: string | null;
      severity?: (typeof SYMPTOM_SEVERITIES)[number] | null;
      source: (typeof SYMPTOM_SOURCES)[number];
      certainty: Certainty;
      codeSystem?: string | null;
      normalizedCode?: string | null;
    },
    opts: { idempotencyKey?: string | null } = {},
  ): Promise<SymptomView> {
    // A symptom is an observation, not an attributed clinical judgement: the matrix gives nurses
    // "C/R observed/proposed (scope)", and the row records who reported it rather than who signed it.
    const { tenantId, encounter } = await this.authorizeRead(actor, encounterId);
    this.assertCoding({ code: input.normalizedCode, codeSystem: input.codeSystem });
    if (encounter.status === 'COMPLETED' || encounter.status === 'ENTERED_IN_ERROR') {
      throw new AppError('INVALID_TRANSITION', undefined, {
        details: { encounterStatus: encounter.status, command: 'addSymptom' },
      });
    }
    const { requestId, correlationId } = this.correlation(actor);
    const now = this.clock.now();
    const id = newId();

    await withTransaction(
      this.prisma,
      async (tx) => {
        await tx.symptomObservation.create({
          data: {
            id,
            tenantId,
            encounterId,
            patientId: encounter.patientId,
            normalizedCode: input.normalizedCode?.trim() || null,
            codeSystem: input.codeSystem?.trim() || null,
            display: input.display.trim(),
            detail: input.detail?.trim() || null,
            onset: input.onset?.trim() || null,
            severity: input.severity ?? null,
            source: input.source,
            certainty: input.certainty,
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
        });
        await this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'SYMPTOM_RECORDED',
          resourceType: 'symptom_observation',
          resourceId: id,
          outcome: 'SUCCESS',
          requestId,
          correlationId,
          metadata: { encounterId, source: input.source, severity: input.severity ?? null },
        });
        await this.outbox.emit(tx, {
          tenantId,
          name: 'SymptomRecorded',
          aggregateType: 'symptom_observation',
          aggregateId: id,
          payload: {
            symptomId: id,
            encounterId,
            patientId: encounter.patientId,
            source: input.source,
            severity: input.severity ?? null,
          },
          actorId: actor.userId,
          correlationId,
          idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:SymptomRecorded` : null,
        });
      },
      { ...TX_OPTS, context: 'symptom:add' },
    );

    const created = await this.prisma.symptomObservation.findFirstOrThrow({ where: { id } });
    return {
      id: created.id,
      encounterId: created.encounterId,
      patientId: created.patientId,
      normalizedCode: created.normalizedCode,
      codeSystem: created.codeSystem,
      display: created.display,
      detail: created.detail,
      onset: created.onset,
      severity: created.severity,
      source: created.source,
      certainty: created.certainty as Certainty,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
      rowVersion: created.rowVersion,
    };
  }

  private async auditRead(
    actor: ClinicalActor,
    action: string,
    encounterId: string,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    this.metrics?.phiReads.inc({ resource: 'diagnosis' });
    const { requestId, correlationId } = this.correlation(actor);
    await withTransaction(
      this.prisma,
      (tx) =>
        this.audit.append(tx, {
          tenantId: actor.tenant.tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action,
          resourceType: 'encounter',
          resourceId: encounterId,
          outcome: 'SUCCESS',
          requestId,
          correlationId,
          metadata,
        }),
      { ...TX_OPTS, context: 'diagnosis:audit-read' },
    );
  }
}
