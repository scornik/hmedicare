import { AppError, type Clock, type TenantContext, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { Metrics } from '@hmedic/observability';
import type { QueueActorRef } from '@hmedic/scheduling';
import type { SerialLifecyclePort } from '@hmedic/queue';
import {
  type EncounterCommand,
  type EncounterStatus,
  encounterTransition,
} from '../domain/encounter-transitions';
import type { AssignmentPolicy, AssignmentResult } from './assignment-policy';

/** Just enough of the note service for the lifecycle to close the draft, without depending on all of it. */
export interface NoteDraftLockPort {
  lockDraftForCompletion(tx: Tx, tenantId: string, encounterId: string, now: Date): Promise<void>;
}
import type { ClinicalOutbox } from './events';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface ClinicalActor {
  userId: string;
  tenant: TenantContext;
  /** The acting doctor's profile. Null for staff, who are never assigned and cannot run these commands. */
  doctorProfileId: string | null;
  // Same shape as `SchedulingActor`, so an actor can be handed to the queue's use cases without a
  // conversion at every boundary — conversions are where fields quietly go missing.
  requestId?: string;
  correlationId?: string;
}

export interface EncounterView {
  id: string;
  patientId: string;
  doctorProfileId: string;
  chamberId: string;
  serialId: string;
  appointmentId: string | null;
  coveringDoctorProfileId: string | null;
  careMode: string;
  status: EncounterStatus;
  legacyInterim: boolean;
  startedAt: string;
  interruptedAt: string | null;
  resumedAt: string | null;
  completedAt: string | null;
  rowVersion: number;
}

type EncounterRow = {
  id: string;
  patientId: string;
  doctorProfileId: string;
  chamberId: string;
  serialId: string;
  appointmentId: string | null;
  coveringDoctorProfileId: string | null;
  careMode: string;
  status: string;
  legacyInterim: boolean;
  startedAt: Date;
  interruptedAt: Date | null;
  resumedAt: Date | null;
  completedAt: Date | null;
  rowVersion: number;
};

export function encounterView(r: EncounterRow): EncounterView {
  return {
    id: r.id,
    patientId: r.patientId,
    doctorProfileId: r.doctorProfileId,
    chamberId: r.chamberId,
    serialId: r.serialId,
    appointmentId: r.appointmentId,
    coveringDoctorProfileId: r.coveringDoctorProfileId,
    careMode: r.careMode,
    status: r.status as EncounterStatus,
    legacyInterim: r.legacyInterim,
    startedAt: r.startedAt.toISOString(),
    interruptedAt: r.interruptedAt?.toISOString() ?? null,
    resumedAt: r.resumedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    rowVersion: r.rowVersion,
  };
}

/** One line of a patient's history: enough to choose which consultation to open, and no clinical text. */
export interface EncounterSummary {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: EncounterStatus;
  doctorProfileId: string;
  chamberId: string;
  careMode: string;
  legacyInterim: boolean;
  /** 0 when nothing was ever signed — an abandoned consultation, or a legacy ADR-021 row. */
  signedRevisions: number;
}

const TX_OPTS = { timeout: 15_000, maxWait: 10_000 } as const;

/**
 * The encounter lifecycle (CLIN-002). Everything that moves a serial and an encounter does both in one
 * transaction, because the invariant is a conjunction: a serial is `IN_CONSULTATION` if and only if
 * exactly one live encounter references it. Half of that committing is worse than neither.
 *
 * The database holds the other half of the guarantee. `uq_encounters_serial` means a second start loses
 * on the unique key rather than on a check this service happened to run first, so two doctors clicking at
 * the same instant cannot both open the room.
 */
export class EncounterService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly outbox: ClinicalOutbox,
    private readonly serials: SerialLifecyclePort,
    private readonly assignment: AssignmentPolicy,
    private readonly clock: Clock = systemClock,
    /**
     * Set by the composition root. Optional so the lifecycle can be built and tested on its own, which
     * is how CP6 exercised it before notes existed.
     */
    private readonly notes?: NoteDraftLockPort,
    private readonly metrics?: Metrics,
  ) {}

  private ref(actor: ClinicalActor): QueueActorRef {
    return { userId: actor.userId, actorType: 'USER' };
  }

  private correlation(actor: ClinicalActor) {
    return {
      requestId: actor.requestId ?? null,
      correlationId: actor.correlationId ?? actor.requestId ?? newId(),
    };
  }

  private async require(tenantId: string, encounterId: string): Promise<EncounterRow> {
    const row = await this.prisma.encounter.findFirst({ where: { tenantId, id: encounterId } });
    if (!row) throw new AppError('RESOURCE_NOT_FOUND');
    return row as EncounterRow;
  }

  /**
   * StartEncounter. The serial must be in the state the queue says a consultation begins from, the actor
   * must be assigned to the patient, and both writes land together.
   */
  async start(
    actor: ClinicalActor,
    serialId: string,
    input: { expectedRowVersion: number },
    opts: { idempotencyKey?: string | null } = {},
  ): Promise<EncounterView> {
    const tenantId = actor.tenant.tenantId;
    if (!actor.doctorProfileId) throw new AppError('FORBIDDEN');
    const serial = await this.prisma.serial.findFirst({ where: { tenantId, id: serialId } });
    if (!serial) throw new AppError('RESOURCE_NOT_FOUND');

    // Assignment is decided before the transaction opens: it is several reads, and holding the chamber
    // day's lock while running them would serialise the whole queue behind one authorization check.
    const assigned = await this.assignment.isAssignedToPatient(
      { tenantId, doctorProfileId: actor.doctorProfileId },
      serial.patientId,
    );
    if (!assigned.assigned) throw new AppError('FORBIDDEN');

    const { requestId, correlationId } = this.correlation(actor);
    const now = this.clock.now();
    const encounterId = newId();
    const startedAt = process.hrtime.bigint();

    const row = await withTransaction(
      this.prisma,
      async (tx) => {
        const current = await tx.serial.findFirst({ where: { tenantId, id: serialId } });
        if (!current) throw new AppError('RESOURCE_NOT_FOUND');
        if (current.rowVersion !== input.expectedRowVersion) {
          throw new AppError('STALE_VERSION', undefined, {
            details: { currentRowVersion: current.rowVersion, status: current.status },
          });
        }
        const day = await this.serials.markInConsultation(tx, tenantId, serialId, {
          actor: this.ref(actor),
          correlationId,
          requestId,
          idempotencyKey: opts.idempotencyKey ?? null,
        });

        const created = await tx.encounter.create({
          data: {
            id: encounterId,
            tenantId,
            patientId: current.patientId,
            doctorProfileId: actor.doctorProfileId!,
            chamberId: day.chamberId,
            serialId,
            appointmentId: current.appointmentId,
            // Recorded only when coverage is what allowed this, together with the grant it relied on —
            // the schema refuses one without the other.
            coveringDoctorProfileId: assigned.via === 'coverage' ? actor.doctorProfileId : null,
            doctorCoverageId: assigned.coverage?.id ?? null,
            careMode: current.careMode,
            status: 'IN_PROGRESS',
            startedAt: now,
            createdAt: now,
            updatedAt: now,
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
        });

        // The draft exists from the start, so autosave never has to create one and two tabs cannot race
        // to create two (`uq_encounter_notes_open_draft` would refuse the second anyway).
        await tx.encounterNote.create({
          data: {
            id: newId(),
            tenantId,
            encounterId,
            authorDoctorProfileId: actor.doctorProfileId!,
            status: 'DRAFT',
            sectionSources: [],
            createdAt: now,
            updatedAt: now,
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
        });

        await this.serials.linkEncounter(tx, tenantId, serialId, encounterId);
        await this.writeAudit(tx, actor, 'ENCOUNTER_STARTED', encounterId, {
          serialId,
          patientId: current.patientId,
          assignedVia: assigned.via ?? 'none',
        });
        await this.outbox.emit(tx, {
          tenantId,
          name: 'EncounterStarted',
          aggregateType: 'encounter',
          aggregateId: encounterId,
          payload: {
            encounterId,
            serialId,
            patientId: current.patientId,
            doctorProfileId: actor.doctorProfileId!,
            careMode: current.careMode,
          },
          actorId: actor.userId,
          correlationId,
          idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:EncounterStarted` : null,
        });
        return created as EncounterRow;
      },
      { ...TX_OPTS, context: 'encounter:start' },
    );
    this.metrics?.encounterStartDuration.observe(
      { outcome: 'started' },
      Number(process.hrtime.bigint() - startedAt) / 1e9,
    );
    // Coverage is worth watching on its own: a clinic where most consultations run under a grant rather
    // than direct assignment is telling you something about how it is staffed.
    if (assigned.via === 'coverage') this.metrics?.coveringDoctorActions.inc({ action: 'encounter_start' });
    return encounterView(row);
  }

  interrupt(
    actor: ClinicalActor,
    encounterId: string,
    input: { expectedRowVersion: number; reason: string },
    opts: { idempotencyKey?: string | null } = {},
  ): Promise<EncounterView> {
    return this.transition(actor, encounterId, 'interrupt', input.expectedRowVersion, {
      reason: input.reason,
      data: { interruptedAt: this.clock.now(), interruptionReason: input.reason.slice(0, 32) },
      idempotencyKey: opts.idempotencyKey,
    });
  }

  resume(
    actor: ClinicalActor,
    encounterId: string,
    input: { expectedRowVersion: number },
    opts: { idempotencyKey?: string | null } = {},
  ): Promise<EncounterView> {
    return this.transition(actor, encounterId, 'resume', input.expectedRowVersion, {
      data: { resumedAt: this.clock.now() },
      idempotencyKey: opts.idempotencyKey,
    });
  }

  /** CompleteEncounter: the encounter and its serial finish together. */
  complete(
    actor: ClinicalActor,
    encounterId: string,
    input: { expectedRowVersion: number },
    opts: { idempotencyKey?: string | null } = {},
  ): Promise<EncounterView> {
    return this.transition(actor, encounterId, 'complete', input.expectedRowVersion, {
      data: { completedAt: this.clock.now() },
      idempotencyKey: opts.idempotencyKey,
      alsoCompleteSerial: true,
    });
  }

  /**
   * The only way out of a completed encounter: it is voided, with a reason, and the row stays.
   *
   * `async` matters here rather than being a style choice. The guard below runs before any await, so a
   * plain method returning `Promise` would throw synchronously and a caller's `.catch()` would never see
   * it — the exception would escape past the promise chain into whatever called the caller.
   */
  async enterInError(
    actor: ClinicalActor,
    encounterId: string,
    input: { expectedRowVersion: number; reason: string },
    opts: { idempotencyKey?: string | null } = {},
  ): Promise<EncounterView> {
    if (!input.reason.trim()) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'reason', code: 'required', message: 'validation.required' }],
      });
    }
    return this.transition(actor, encounterId, 'enter_in_error', input.expectedRowVersion, {
      reason: input.reason,
      data: { enteredInErrorReason: input.reason.slice(0, 300) },
      idempotencyKey: opts.idempotencyKey,
    });
  }

  private async transition(
    actor: ClinicalActor,
    encounterId: string,
    command: EncounterCommand,
    expectedRowVersion: number,
    o: {
      reason?: string;
      data?: Record<string, unknown>;
      idempotencyKey?: string | null;
      alsoCompleteSerial?: boolean;
    },
  ): Promise<EncounterView> {
    const tenantId = actor.tenant.tenantId;
    const before = await this.require(tenantId, encounterId);
    // Assignment to the *encounter*, not the patient: closing or voiding a consultation attaches a name
    // to it, and patient-level assignment is not enough for that (AUTHORIZATION-MATRIX §3).
    const assigned = await this.assignment.isAssignedToEncounter(
      { tenantId, doctorProfileId: actor.doctorProfileId },
      encounterId,
    );
    if (!assigned.assigned) throw new AppError('FORBIDDEN');

    const { requestId, correlationId } = this.correlation(actor);
    const now = this.clock.now();

    const row = await withTransaction(
      this.prisma,
      async (tx) => {
        // Order matters more than it looks. A queue transition ends by appending to the day's hash chain,
        // which locks the chain head at rank 80 — last, by design. So when the serial is moving too, its
        // path is locked first (40, 44), then the encounter (50), and only then is the transition asked
        // for: chamber_days → serials → encounters → chain. Re-locking rows already held is exempt, so
        // the second pass inside `markCompleted` costs nothing.
        if (o.alsoCompleteSerial) {
          await this.serials.lockSerialPath(tx, tenantId, before.serialId);
        }
        await lockRow(tx, 'encounters', encounterId, tenantId);
        // The consultation is over, so the draft stops accepting saves — in the same transaction as the
        // status change, because a draft still open against a finished encounter is a door left unlocked.
        //
        // It happens here rather than after the update, and is keyed on the command rather than on the
        // resulting status, because `markCompleted` below ends at the day's hash chain (rank 80) and
        // `encounter_notes` is 54. Locking it afterwards would be a lock-order violation; an invalid
        // transition further down rolls this back with everything else.
        if (command === 'complete' || command === 'enter_in_error') {
          await this.notes?.lockDraftForCompletion(tx, tenantId, encounterId, now);
        }
        if (o.alsoCompleteSerial) {
          await this.serials.markCompleted(tx, tenantId, before.serialId, {
            actor: this.ref(actor),
            correlationId,
            requestId,
            idempotencyKey: o.idempotencyKey ?? null,
          });
        }
        const current = (await tx.encounter.findFirstOrThrow({
          where: { tenantId, id: encounterId },
        })) as EncounterRow;
        if (current.rowVersion !== expectedRowVersion) {
          throw new AppError('STALE_VERSION', undefined, {
            details: { currentRowVersion: current.rowVersion, status: current.status },
          });
        }
        const to = encounterTransition(current.status as EncounterStatus, command);
        if (!to) {
          throw new AppError('INVALID_TRANSITION', undefined, {
            details: { from: current.status, command },
          });
        }
        const updated = await tx.encounter.update({
          where: { id: encounterId },
          data: {
            ...(o.data ?? {}),
            status: to,
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        const action = `ENCOUNTER_${to === 'IN_PROGRESS' ? 'RESUMED' : to}`;
        await this.writeAudit(tx, actor, action, encounterId, {
          from: current.status,
          to,
          ...(o.reason ? { reason: o.reason } : {}),
        });
        const name = (
          {
            INTERRUPTED: 'EncounterInterrupted',
            IN_PROGRESS: 'EncounterResumed',
            COMPLETED: 'EncounterCompleted',
            ENTERED_IN_ERROR: 'EncounterEnteredInError',
          } as const
        )[to];
        await this.outbox.emit(tx, {
          tenantId,
          name,
          aggregateType: 'encounter',
          aggregateId: encounterId,
          payload: {
            encounterId,
            serialId: before.serialId,
            patientId: before.patientId,
            from: current.status,
            to,
          },
          actorId: actor.userId,
          correlationId,
          idempotencyKey: o.idempotencyKey ? `${o.idempotencyKey}:${name}` : null,
        });
        return updated as EncounterRow;
      },
      { ...TX_OPTS, context: `encounter:${command}` },
    );
    return encounterView(row);
  }

  /**
   * `EncounterInterruptionPort`. Called by the queue, inside its transaction, when a serial that is
   * mid-consultation is cancelled: the patient left, so the encounter did not finish and must not be left
   * looking as though it is still running.
   */
  async interruptForSerial(
    tx: Tx,
    tenantId: string,
    serialId: string,
    input: { reason: string; actor: QueueActorRef; correlationId: string },
  ): Promise<string | null> {
    const live = await tx.encounter.findFirst({
      where: { tenantId, serialId, status: { in: ['IN_PROGRESS', 'INTERRUPTED'] } },
      select: { id: true, status: true, patientId: true },
    });
    if (!live || live.status === 'INTERRUPTED') return null;
    const now = this.clock.now();
    await lockRow(tx, 'encounters', live.id, tenantId);
    await tx.encounter.update({
      where: { id: live.id },
      data: {
        status: 'INTERRUPTED',
        interruptedAt: now,
        interruptionReason: 'SERIAL_CANCELLED',
        updatedAt: now,
        updatedByUserId: input.actor.userId,
        rowVersion: { increment: 1 },
      },
    });
    await this.audit.append(tx, {
      tenantId,
      actorUserId: input.actor.userId,
      actorType: input.actor.actorType,
      actingAs: input.actor.actingAs ?? null,
      onBehalfOfPatientId: input.actor.onBehalfOfPatientId ?? null,
      action: 'ENCOUNTER_INTERRUPTED',
      resourceType: 'encounter',
      resourceId: live.id,
      outcome: 'SUCCESS',
      correlationId: input.correlationId,
      metadata: { serialId, reason: 'SERIAL_CANCELLED' },
    });
    await this.outbox.emit(tx, {
      tenantId,
      name: 'EncounterInterrupted',
      aggregateType: 'encounter',
      aggregateId: live.id,
      payload: { encounterId: live.id, serialId, patientId: live.patientId, reason: 'SERIAL_CANCELLED' },
      actorId: input.actor.userId,
      correlationId: input.correlationId,
    });
    return live.id;
  }

  private async writeAudit(
    tx: Tx,
    actor: ClinicalActor,
    action: string,
    encounterId: string,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    const { requestId, correlationId } = this.correlation(actor);
    await this.audit.append(tx, {
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
    });
  }

  /**
   * A patient's past consultations, newest first, for the workspace's history panel.
   *
   * Assignment is checked at the *patient* level here, not the encounter level: a doctor treating this
   * patient today needs to see what happened at the last visit, including consultations another doctor
   * ran. That is the point of a medical record. Signing and amending stay at encounter level, because
   * those attach a name to a specific consultation.
   *
   * The summary deliberately carries no note text. The workspace asks for a revision by id when the
   * doctor opens one, and that read is audited on its own.
   */
  async listForPatient(
    actor: ClinicalActor,
    patientId: string,
    opts: { limit?: number; excludeEncounterId?: string } = {},
  ): Promise<EncounterSummary[]> {
    const tenantId = actor.tenant.tenantId;
    const patient = await this.prisma.patient.findFirst({
      where: { tenantId, id: patientId },
      select: { id: true },
    });
    if (!patient) throw new AppError('RESOURCE_NOT_FOUND');
    const assigned = await this.assignment.isAssignedToPatient(
      { tenantId, doctorProfileId: actor.doctorProfileId },
      patientId,
    );
    if (!assigned.assigned) throw new AppError('FORBIDDEN');

    const rows = await this.prisma.encounter.findMany({
      where: {
        tenantId,
        patientId,
        ...(opts.excludeEncounterId ? { id: { not: opts.excludeEncounterId } } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: Math.min(opts.limit ?? 20, 50),
    });
    const signed = await this.prisma.encounterNoteVersion.groupBy({
      by: ['encounterId'],
      where: { tenantId, encounterId: { in: rows.map((r) => r.id) } },
      _max: { revision: true },
    });
    const revisions = new Map(signed.map((s) => [s.encounterId, s._max.revision ?? 0]));

    await withTransaction(
      this.prisma,
      (tx) =>
        this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'PATIENT_ENCOUNTER_HISTORY_VIEWED',
          resourceType: 'patient',
          resourceId: patientId,
          outcome: 'SUCCESS',
          ...this.correlation(actor),
          metadata: { count: rows.length, assignedVia: assigned.via ?? 'none' },
        }),
      { ...TX_OPTS, context: 'encounter:history-audit' },
    );

    return rows.map((r) => ({
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      status: r.status as EncounterStatus,
      doctorProfileId: r.doctorProfileId,
      chamberId: r.chamberId,
      careMode: r.careMode,
      legacyInterim: r.legacyInterim,
      signedRevisions: revisions.get(r.id) ?? 0,
    }));
  }

  /** Read one encounter, for the workspace and for tests. Assignment is checked by the caller. */
  async get(actor: ClinicalActor, encounterId: string): Promise<EncounterView> {
    return encounterView(await this.require(actor.tenant.tenantId, encounterId));
  }

  /** Whether this actor may read the encounter at all, exposed so routes ask the rule rather than copy it. */
  assignmentFor(actor: ClinicalActor, encounterId: string): Promise<AssignmentResult> {
    return this.assignment.isAssignedToEncounter(
      { tenantId: actor.tenant.tenantId, doctorProfileId: actor.doctorProfileId },
      encounterId,
    );
  }
}
