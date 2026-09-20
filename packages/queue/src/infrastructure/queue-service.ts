import { createHash } from 'node:crypto';
import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import {
  type PrismaClient,
  type Tx,
  isUniqueViolation,
  lockRow,
  allocateCounter,
  lockRows,
  withTransaction,
} from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { PatientContextActor, PatientReadPort } from '@hmedic/patient';
import {
  type CareMode,
  type ChamberDayFacts,
  type QueueActorRef,
  QueueEventWriter,
  type SchedulingActor,
  dayFacts,
  localInstant,
} from '@hmedic/scheduling';
import {
  type Placement,
  type QueueRow,
  estimatedPosition,
  estimatedWaitMinutes,
  isLateArrival,
  peopleAhead,
  placementFor,
  reorderAssignments,
} from '../domain/positions';
import {
  DUPLICATE_GUARDED_STATUSES,
  QUEUE_ACTIVE_STATUSES,
  type SerialStatus,
  serialTransition,
} from '../domain/transitions';
import type { QueueOutbox } from './events';
import { type SerialActor, type SerialView, type SerialService, serialView } from './serial-service';

export interface QueueEntry {
  serialId: string;
  serialNumber: number;
  queuePosition: number | null;
  status: SerialStatus;
  careMode: string;
  source: string;
  patientId: string;
  patientDisplayName: string;
  medicalRecordNumber: string;
  lateArrival: boolean;
  recallCount: number;
  recallDeadlineAt: string | null;
  remoteReady: boolean;
  duplicateOverride: boolean;
  rowVersion: number;
}

export interface QueueSnapshot {
  chamberDayId: string;
  localDate: string;
  status: string;
  queueOrderVersion: number;
  expectedDelayMinutes: number | null;
  avgConsultationMinutes: number;
  counts: { waiting: number; called: number; inConsultation: number; completed: number; total: number };
  entries: QueueEntry[];
  asOf: string;
  /** Strong ETag over the snapshot body (QUEUE §3.5 polling). */
  etag: string;
}

/** Patient-facing serial view (QUEUE §4.2): never another patient's identity, always labelled an estimate. */
export interface PatientSerialView {
  serialId: string;
  serialNumber: number;
  status: SerialStatus;
  chamberDayId: string;
  localDate: string;
  dayStatus: string;
  careMode: string;
  /** Live queue position count, once the patient has arrived. */
  peopleAhead: number | null;
  /** Estimated position before arrival (not a queue position). */
  estimatedPosition: number | null;
  estimatedWaitMinutes: number | null;
  expectedDelayMinutes: number | null;
  recallDeadlineAt: string | null;
  recallsRemaining: number | null;
  asOf: string;
}

export interface IssueWalkInInput {
  patientId: string;
  careMode: CareMode;
  duplicateOverride?: { reason: string } | null;
}

type SerialRow = Awaited<ReturnType<PrismaClient['serial']['findFirstOrThrow']>>;

const TX_OPTS = {
  isolation: 'ReadCommitted' as const,
  timeoutMs: 5_000,
  maxWaitMs: 2_000,
  exhaustedCode: 'QUEUE_BUSY' as const,
};
const OPEN_DAY: ReadonlySet<string> = new Set(['OPEN', 'PAUSED']);

const queueRow = (s: {
  id: string;
  serialNumber: number;
  queuePosition: number | null;
  status: string;
}): QueueRow => ({
  id: s.id,
  serialNumber: s.serialNumber,
  queuePosition: s.queuePosition,
  status: s.status as SerialStatus,
});

/**
 * Queue-active lifecycle and live reads (QUEUE-IMPLEMENTATION §3–§5): walk-in issuance, check-in, waiting,
 * call, skip, recall, remote readiness, the interim consultation transitions (ADR-021), reorder, and the
 * staff and patient views. Single-serial commands reuse `SerialService`'s transition machinery, so the
 * transition table, the audit row, the queue event and the outbox event stay in one place.
 */
export class QueueService {
  private readonly queueEvents: QueueEventWriter;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly outbox: QueueOutbox,
    private readonly serials: SerialService,
    private readonly patients: PatientReadPort,
    private readonly clock: Clock = systemClock,
  ) {
    this.queueEvents = new QueueEventWriter(clock);
  }

  // ---------------------------------------------------------------- walk-in issuance (QUEUE §5.2)

  /**
   * IssueWalkInSerial: allocates under the chamber-day lock and lands the serial in `CHECKED_IN`, then
   * `WAITING` unless the policy asks staff to confirm. A second active serial for the same patient and day
   * is refused by the database key unless an audited override is supplied.
   */
  async issueWalkIn(
    actor: SchedulingActor,
    chamberDayId: string,
    input: IssueWalkInInput,
    opts: { idempotencyKey?: string | null } = {},
  ): Promise<SerialView> {
    const tenantId = actor.tenant.tenantId;
    const patient = await this.patients.resolveActive(tenantId, input.patientId);
    if (!patient || patient.status !== 'ACTIVE') {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'patientId', code: 'unknown_patient', message: 'validation.unknown_patient' }],
      });
    }
    if (input.duplicateOverride && !this.mayOverride(actor)) throw new AppError('FORBIDDEN');
    const now = this.clock.now();
    const actorRef: QueueActorRef = { userId: actor.userId, actorType: 'USER' };
    const row = await withTransaction(
      this.prisma,
      async (tx) => {
        await lockRow(tx, 'chamber_days', chamberDayId, tenantId);
        const dayRow = await tx.chamberDay.findFirst({ where: { tenantId, id: chamberDayId } });
        if (!dayRow) throw new AppError('RESOURCE_NOT_FOUND');
        const day = dayFacts(dayRow);
        if (!OPEN_DAY.has(day.status))
          throw new AppError('QUEUE_STATE_CONFLICT', undefined, { details: { dayStatus: day.status } });
        if (!day.policy.walkInsEnabled) {
          throw new AppError('VALIDATION_FAILED', undefined, {
            fieldErrors: [
              { path: 'chamberDayId', code: 'walk_ins_disabled', message: 'validation.walk_ins_disabled' },
            ],
          });
        }
        const counts = await this.serials.countsForDay(tx, tenantId, day.id);
        if (day.policy.capacity !== null && counts.nonCancelled >= day.policy.capacity)
          throw new AppError('CAPACITY_EXCEEDED', undefined, { details: { reason: 'capacity' } });
        if (day.policy.maxWalkIns !== null && counts.walkIns >= day.policy.maxWalkIns)
          throw new AppError('CAPACITY_EXCEEDED', undefined, { details: { reason: 'max_walk_ins' } });

        const rows = await this.dayRows(tx, tenantId, day.id);
        // Atomic: the increment and the read are one statement, so no two transactions can consume the
        // same number even when one of them is later rolled back (uq_serials_number).
        const n = await allocateCounter(tx, 'chamber_days', 'next_serial_number', day.id, tenantId);
        // A walk-in is by definition on time: it joins the back of the queue.
        const placement = placementFor({
          rows,
          serialNumber: n,
          lateArrival: false,
          policy: day.policy,
        });
        const waiting = !day.policy.waitingRequiresConfirmation;
        const id = newId();
        try {
          await tx.serial.create({
            data: {
              id,
              tenantId,
              chamberDayId: day.id,
              patientId: patient.id,
              serialNumber: n,
              queuePosition: placement.position,
              source: 'WALK_IN',
              careMode: input.careMode,
              status: waiting ? 'WAITING' : 'CHECKED_IN',
              duplicateOverride: Boolean(input.duplicateOverride),
              duplicateOverrideReason: input.duplicateOverride?.reason ?? null,
              duplicateOverrideByUserId: input.duplicateOverride ? actor.userId : null,
              checkedInAt: now,
              waitingAt: waiting ? now : null,
              createdAt: now,
              updatedAt: now,
              createdByUserId: actor.userId,
              updatedByUserId: actor.userId,
            },
          });
        } catch (error) {
          if (!isUniqueViolation(error, 'uq_serials_active_patient_day')) throw error;
          const existing = await tx.serial.findFirst({
            where: {
              tenantId,
              chamberDayId: day.id,
              patientId: patient.id,
              status: { in: [...DUPLICATE_GUARDED_STATUSES] },
            },
            select: { id: true },
          });
          throw new AppError('DUPLICATE_ACTIVE_SERIAL', undefined, {
            details: { existingSerialId: existing?.id ?? null },
          });
        }
        await tx.checkIn.create({
          data: {
            id: newId(),
            tenantId,
            serialId: id,
            method: 'STAFF_DESK',
            checkedInAt: now,
            verifiedByUserId: actor.userId,
            createdAt: now,
            updatedAt: now,
          },
        });
        const key = opts.idempotencyKey;
        const details = { serialNumber: n, source: 'WALK_IN', careMode: input.careMode };
        await this.queueEvents.append(tx, {
          tenantId,
          chamberDayId: day.id,
          serialId: id,
          eventType: 'SERIAL_ISSUED',
          toStatus: 'CHECKED_IN',
          positionAfter: placement.position,
          details,
          actor: actorRef,
          idempotencyKey: key ? `${key}:SERIAL_ISSUED` : null,
        });
        if (input.duplicateOverride) {
          await this.queueEvents.append(tx, {
            tenantId,
            chamberDayId: day.id,
            serialId: id,
            eventType: 'DUPLICATE_OVERRIDE',
            reason: input.duplicateOverride.reason,
            actor: actorRef,
            idempotencyKey: key ? `${key}:DUPLICATE_OVERRIDE` : null,
          });
        }
        await this.queueEvents.append(tx, {
          tenantId,
          chamberDayId: day.id,
          serialId: id,
          eventType: 'CHECKED_IN',
          fromStatus: 'CHECKED_IN',
          toStatus: 'CHECKED_IN',
          positionAfter: placement.position,
          details: { method: 'STAFF_DESK' },
          actor: actorRef,
          idempotencyKey: key ? `${key}:CHECKED_IN` : null,
        });
        if (waiting) {
          await this.queueEvents.append(tx, {
            tenantId,
            chamberDayId: day.id,
            serialId: id,
            eventType: 'WAITING',
            fromStatus: 'CHECKED_IN',
            toStatus: 'WAITING',
            positionAfter: placement.position,
            actor: actorRef,
            idempotencyKey: key ? `${key}:WAITING` : null,
          });
        }
        await this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'SERIAL_ISSUED',
          resourceType: 'serial',
          resourceId: id,
          outcome: 'SUCCESS',
          requestId: actor.requestId ?? null,
          correlationId: actor.correlationId ?? null,
          metadata: {
            chamberDayId: day.id,
            serialNumber: n,
            source: 'WALK_IN',
            queuePosition: placement.position,
            ...(input.duplicateOverride ? { duplicateOverride: true } : {}),
          },
        });
        await this.outbox.emit(tx, {
          tenantId,
          name: 'SerialIssued',
          aggregateType: 'serial',
          aggregateId: id,
          payload: {
            serialId: id,
            chamberDayId: day.id,
            patientId: patient.id,
            serialNumber: n,
            source: 'WALK_IN',
            status: waiting ? 'WAITING' : 'CHECKED_IN',
          },
          actorId: actor.userId,
          correlationId: actor.correlationId ?? null,
          idempotencyKey: key ? `${key}:SerialIssued` : null,
        });
        return tx.serial.findFirstOrThrow({ where: { id } });
      },
      { ...TX_OPTS, context: 'queue:walk_in' },
    );
    return serialView(row);
  }

  private mayOverride(actor: SchedulingActor): boolean {
    // The policy lists the roles allowed to create a second active serial; it is read from the day at issue
    // time, but the role check itself needs no day, so the chamber default is enough here.
    return actor.tenant.effectivePermissions.has('serial.manage');
  }

  // ---------------------------------------------------------------- arrival (QUEUE §3.2, §4.1)

  /**
   * CheckInSerial: the day must be OPEN (or SCHEDULED within `earlyCheckInMinutes` of the local start).
   * Late arrivals are placed per `lateArrivalPlacement`; a `BY_SERIAL_NUMBER` insertion shifts the serials
   * behind it and bumps `queue_order_version`, because it reorders other people.
   */
  async checkIn(
    actor: SerialActor,
    serialId: string,
    input: {
      expectedRowVersion: number;
      method?: 'STAFF_DESK' | 'PATIENT_APP' | 'REMOTE_READY' | 'KIOSK';
      idempotencyKey?: string | null;
    },
  ): Promise<SerialView> {
    const method = input.method ?? (actor.kind === 'patient' ? 'PATIENT_APP' : 'STAFF_DESK');
    // Placement is decided (and the shifted rows are locked) before the transition writes to the hash chain,
    // because the chain checkpoint is ranked after every row lock (QUEUE-CONCURRENCY §1).
    let placement: (Placement & { late: boolean }) | null = null;
    return this.serials.transitionSerial(actor, serialId, input.expectedRowVersion, 'check_in', {
      idempotencyKey: input.idempotencyKey ?? null,
      guard: (s, day) => {
        this.assertCheckInWindow(day);
        if (s.careMode === 'REMOTE' && actor.kind === 'patient' && method !== 'REMOTE_READY') {
          throw new AppError('VALIDATION_FAILED', undefined, {
            fieldErrors: [
              { path: 'method', code: 'remote_ready_required', message: 'validation.remote_ready_required' },
            ],
          });
        }
      },
      guardAsync: async (tx, s, day) => {
        placement = await this.prepareArrival(tx, day, s);
      },
      after: async (tx, day, s) => this.finishArrival(tx, day, s, placement!, method, actor),
    });
  }

  private assertCheckInWindow(day: ChamberDayFacts): void {
    if (OPEN_DAY.has(day.status)) return;
    if (day.status !== 'SCHEDULED')
      throw new AppError('QUEUE_STATE_CONFLICT', undefined, { details: { dayStatus: day.status } });
    const opensFrom = new Date(
      localInstant(day.localDate, day.localStartTime).getTime() - day.policy.earlyCheckInMinutes * 60_000,
    );
    if (this.clock.now() < opensFrom)
      throw new AppError('QUEUE_STATE_CONFLICT', undefined, { details: { reason: 'too_early' } });
  }

  /**
   * Decides the placement and takes every row lock it needs (the shifted serials), before the transition
   * writes its queue event: the chain checkpoint is ranked after all row locks, so no lock may follow it.
   */
  private async prepareArrival(
    tx: Tx,
    day: ChamberDayFacts,
    s: SerialRow,
  ): Promise<Placement & { late: boolean }> {
    const now = this.clock.now();
    const rows = await this.dayRows(tx, day.tenantId, day.id);
    const expectedStart = await this.expectedStart(tx, day, s);
    const late = isLateArrival({
      now,
      expectedStart,
      graceMinutes: day.policy.lateArrivalGraceMinutes,
      serialNumber: s.serialNumber,
      rows,
    });
    const placement = placementFor({
      rows,
      serialNumber: s.serialNumber,
      lateArrival: late,
      policy: day.policy,
    });
    if (placement.shifted.length) {
      await lockRows(
        tx,
        'serials',
        placement.shifted.map((x) => x.id),
        day.tenantId,
      );
      for (const move of placement.shifted) {
        await tx.serial.update({
          where: { id: move.id },
          data: { queuePosition: move.to, updatedAt: now, rowVersion: { increment: 1 } },
        });
      }
    }
    return { ...placement, late };
  }

  /** Writes the check-in row, the position and the automatic WAITING step with their events. */
  private async finishArrival(
    tx: Tx,
    day: ChamberDayFacts,
    s: SerialRow,
    placement: Placement & { late: boolean },
    method: string,
    actor: SerialActor,
  ): Promise<void> {
    const now = this.clock.now();
    const late = placement.late;
    const ref: QueueActorRef =
      actor.kind === 'staff'
        ? { userId: actor.actor.userId, actorType: 'USER' }
        : { userId: actor.context.userId, actorType: 'PATIENT_CONTEXT' };
    await tx.checkIn.create({
      data: {
        id: newId(),
        tenantId: day.tenantId,
        serialId: s.id,
        method,
        remoteReady: method === 'REMOTE_READY',
        remoteReadyAt: method === 'REMOTE_READY' ? now : null,
        checkedInAt: now,
        verifiedByUserId: ref.actorType === 'USER' ? ref.userId : null,
        createdAt: now,
        updatedAt: now,
      },
    });
    await tx.serial.update({
      where: { id: s.id },
      data: { queuePosition: placement.position, lateArrival: late },
    });
    const waiting = !day.policy.waitingRequiresConfirmation;
    if (waiting) {
      await tx.serial.update({
        where: { id: s.id },
        data: { status: 'WAITING', waitingAt: now, rowVersion: { increment: 1 } },
      });
      await this.queueEvents.append(tx, {
        tenantId: day.tenantId,
        chamberDayId: day.id,
        serialId: s.id,
        eventType: 'WAITING',
        fromStatus: 'CHECKED_IN',
        toStatus: 'WAITING',
        positionAfter: placement.position,
        details: { lateArrival: late },
        actor: ref,
      });
    }
    if (placement.reordersOthers) {
      await tx.chamberDay.update({
        where: { id: day.id },
        data: { queueOrderVersion: { increment: 1 } },
      });
      await this.queueEvents.append(tx, {
        tenantId: day.tenantId,
        chamberDayId: day.id,
        serialId: s.id,
        eventType: 'QUEUE_REORDERED',
        details: {
          reason: 'late_arrival_by_serial_number',
          shifted: placement.shifted.map((x) => x.id),
        },
        actor: ref,
      });
    }
  }

  /** The instant this serial was expected: its slot start, else the chamber day's local start. */
  private async expectedStart(tx: Tx, day: ChamberDayFacts, s: SerialRow): Promise<Date> {
    if (s.appointmentId) {
      const appointment = await tx.appointment.findFirst({
        where: { tenantId: day.tenantId, id: s.appointmentId },
        select: { slotId: true },
      });
      if (appointment?.slotId) {
        const slot = await tx.appointmentSlot.findFirst({
          where: { tenantId: day.tenantId, id: appointment.slotId },
          select: { startsAt: true },
        });
        if (slot) return slot.startsAt;
      }
    }
    return localInstant(day.localDate, day.localStartTime);
  }

  /** MarkWaiting: only meaningful when the policy asks staff to confirm the arrival. */
  markWaiting(
    actor: SerialActor,
    serialId: string,
    input: { expectedRowVersion: number },
  ): Promise<SerialView> {
    return this.serials.transitionSerial(actor, serialId, input.expectedRowVersion, 'mark_waiting', {
      guard: (_s, day) => {
        if (!day.policy.waitingRequiresConfirmation) {
          throw new AppError('INVALID_TRANSITION', undefined, {
            details: { reason: 'waiting_is_automatic' },
          });
        }
      },
    });
  }

  /** MarkRemoteReady: a remote patient signals readiness; the serial keeps its state. */
  async markRemoteReady(
    actor: SerialActor,
    serialId: string,
    input: { expectedRowVersion: number },
  ): Promise<SerialView> {
    const tenantId = actor.kind === 'staff' ? actor.actor.tenant.tenantId : actor.context.tenantId;
    if (
      actor.kind === 'patient' &&
      actor.context.actingAs === 'GUARDIAN' &&
      !actor.context.authorityScope.has('MANAGE_SERIALS')
    ) {
      throw new AppError('FORBIDDEN');
    }
    const before = await this.serials.require(tenantId, serialId);
    if (actor.kind === 'patient' && before.patientId !== actor.context.patientId)
      throw new AppError('FORBIDDEN');
    if (before.careMode !== 'REMOTE' && before.careMode !== 'HYBRID') {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'serialId', code: 'not_remote', message: 'validation.not_remote' }],
      });
    }
    const ref: QueueActorRef =
      actor.kind === 'staff'
        ? { userId: actor.actor.userId, actorType: 'USER' }
        : { userId: actor.context.userId, actorType: 'PATIENT_CONTEXT' };
    const now = this.clock.now();
    const row = await withTransaction(
      this.prisma,
      async (tx) => {
        await lockRow(tx, 'chamber_days', before.chamberDayId, tenantId);
        const day = dayFacts(
          await tx.chamberDay.findFirstOrThrow({ where: { tenantId, id: before.chamberDayId } }),
        );
        await lockRow(tx, 'serials', serialId, tenantId);
        const s = await tx.serial.findFirstOrThrow({ where: { tenantId, id: serialId } });
        if (s.rowVersion !== input.expectedRowVersion) {
          throw new AppError('STALE_VERSION', undefined, {
            details: { currentRowVersion: s.rowVersion, status: s.status },
          });
        }
        const check = await tx.checkIn.findFirst({ where: { tenantId, serialId, revokedAt: null } });
        if (check) {
          await tx.checkIn.update({
            where: { id: check.id },
            data: { remoteReady: true, remoteReadyAt: now, updatedAt: now, rowVersion: { increment: 1 } },
          });
        } else {
          await tx.checkIn.create({
            data: {
              id: newId(),
              tenantId,
              serialId,
              method: 'REMOTE_READY',
              remoteReady: true,
              remoteReadyAt: now,
              checkedInAt: now,
              createdAt: now,
              updatedAt: now,
            },
          });
        }
        await tx.serial.update({
          where: { id: serialId },
          data: { updatedAt: now, rowVersion: { increment: 1 } },
        });
        await this.queueEvents.append(tx, {
          tenantId,
          chamberDayId: day.id,
          serialId,
          eventType: 'REMOTE_READY',
          fromStatus: s.status,
          toStatus: s.status,
          actor: ref,
        });
        await this.audit.append(tx, {
          tenantId,
          actorUserId: ref.userId,
          actorType: ref.actorType,
          action: 'SERIAL_REMOTE_READY',
          resourceType: 'serial',
          resourceId: serialId,
          outcome: 'SUCCESS',
          metadata: { chamberDayId: day.id },
        });
        await this.outbox.emit(tx, {
          tenantId,
          name: 'SerialRemoteReady',
          aggregateType: 'serial',
          aggregateId: serialId,
          payload: { serialId, chamberDayId: day.id, patientId: s.patientId },
          actorId: ref.userId,
        });
        return tx.serial.findFirstOrThrow({ where: { id: serialId } });
      },
      { ...TX_OPTS, context: 'queue:remote_ready' },
    );
    return serialView(row);
  }

  // ---------------------------------------------------------------- call, skip, recall

  /** CallSerial: a remote serial needs `remote_ready` unless the policy allows an audited override. */
  call(
    actor: SerialActor,
    serialId: string,
    input: { expectedRowVersion: number; overrideReason?: string | null },
  ): Promise<SerialView> {
    return this.serials.transitionSerial(actor, serialId, input.expectedRowVersion, 'call', {
      reason: input.overrideReason ?? null,
      guardAsync: async (tx, s, day) => {
        if (s.status === 'CHECKED_IN' && !day.policy.waitingRequiresConfirmation) {
          throw new AppError('QUEUE_STATE_CONFLICT', undefined, { details: { reason: 'not_waiting_yet' } });
        }
        if (s.careMode === 'REMOTE' || s.careMode === 'HYBRID') {
          const ready = await tx.checkIn.findFirst({
            where: { tenantId: day.tenantId, serialId: s.id, revokedAt: null, remoteReady: true },
            select: { id: true },
          });
          if (!ready && !(day.policy.allowRemoteCallWithoutReady && input.overrideReason)) {
            throw new AppError('QUEUE_STATE_CONFLICT', undefined, {
              details: { reason: 'remote_not_ready' },
            });
          }
        }
      },
      dataFromDay: (day) => ({
        recallDeadlineAt: new Date(this.clock.now().getTime() + day.policy.recallDeadlineMinutes * 60_000),
      }),
    });
  }

  /** SkipSerial: a reason is required; the position is kept for history. */
  skip(
    actor: SerialActor,
    serialId: string,
    input: { expectedRowVersion: number; reason: string },
  ): Promise<SerialView> {
    return this.serials.transitionSerial(actor, serialId, input.expectedRowVersion, 'skip', {
      reason: input.reason,
      data: { recallDeadlineAt: null },
    });
  }

  /** RecallSerial: bounded by `recallLimit`; the recall count and a fresh deadline are written. */
  recall(actor: SerialActor, serialId: string, input: { expectedRowVersion: number }): Promise<SerialView> {
    return this.serials.transitionSerial(actor, serialId, input.expectedRowVersion, 'recall', {
      guard: (s, day) => {
        if (s.recallCount >= day.policy.recallLimit) {
          throw new AppError('RECALL_LIMIT_REACHED', undefined, {
            details: { recallCount: s.recallCount, recallLimit: day.policy.recallLimit },
          });
        }
      },
      dataFromDay: (day) => ({
        recallCount: { increment: 1 },
        recallDeadlineAt: new Date(this.clock.now().getTime() + day.policy.recallDeadlineMinutes * 60_000),
      }),
    });
  }

  /**
   * StartConsultation / CompleteConsultation (ADR-021, audit C-42): the interim pre-clinical transitions of
   * Stage 5. `encounter_id` stays null and both are retired when Stage 6 introduces encounters.
   */
  startConsultation(
    actor: SerialActor,
    serialId: string,
    input: { expectedRowVersion: number },
  ): Promise<SerialView> {
    return this.serials.transitionSerial(actor, serialId, input.expectedRowVersion, 'start_consultation', {
      guardAsync: (tx, _s, day) => this.assertChamberDoctor(tx, actor, day),
    });
  }

  completeConsultation(
    actor: SerialActor,
    serialId: string,
    input: { expectedRowVersion: number },
  ): Promise<SerialView> {
    return this.serials.transitionSerial(actor, serialId, input.expectedRowVersion, 'complete', {
      guardAsync: (tx, _s, day) => this.assertChamberDoctor(tx, actor, day),
    });
  }

  /**
   * ADR-021: only the doctor of the chamber may run the interim consultation transitions. The covering
   * doctor rule (AUTHORIZATION-MATRIX §3) arrives with the encounter use cases in Stage 6.
   */
  private async assertChamberDoctor(tx: Tx, actor: SerialActor, day: ChamberDayFacts): Promise<void> {
    if (actor.kind !== 'staff') throw new AppError('FORBIDDEN');
    const profile = await tx.doctorProfile.findFirst({
      where: { tenantId: day.tenantId, id: day.doctorProfileId },
      select: { userId: true },
    });
    if (!profile || profile.userId !== actor.actor.userId) throw new AppError('FORBIDDEN');
  }

  // ---------------------------------------------------------------- reorder (QUEUE §5.3)

  async reorder(
    actor: SchedulingActor,
    chamberDayId: string,
    input: { expectedQueueOrderVersion: number; orderedSerialIds: string[] },
  ): Promise<QueueSnapshot> {
    const tenantId = actor.tenant.tenantId;
    if (
      input.orderedSerialIds.length === 0 ||
      new Set(input.orderedSerialIds).size !== input.orderedSerialIds.length
    ) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'orderedSerialIds', code: 'invalid_list', message: 'validation.invalid_list' }],
      });
    }
    const now = this.clock.now();
    await withTransaction(
      this.prisma,
      async (tx) => {
        await lockRow(tx, 'chamber_days', chamberDayId, tenantId);
        const dayRow = await tx.chamberDay.findFirst({ where: { tenantId, id: chamberDayId } });
        if (!dayRow) throw new AppError('RESOURCE_NOT_FOUND');
        const day = dayFacts(dayRow);
        if (day.queueOrderVersion !== input.expectedQueueOrderVersion) {
          throw new AppError('QUEUE_VERSION_CONFLICT', undefined, {
            details: { currentQueueOrderVersion: day.queueOrderVersion },
          });
        }
        const ids = [...input.orderedSerialIds].sort();
        await lockRows(tx, 'serials', ids, tenantId);
        const rows = await tx.serial.findMany({ where: { tenantId, chamberDayId, id: { in: ids } } });
        if (rows.length !== ids.length) throw new AppError('RESOURCE_NOT_FOUND');
        for (const r of rows) {
          if (r.status !== 'CHECKED_IN' && r.status !== 'WAITING') {
            throw new AppError('QUEUE_STATE_CONFLICT', undefined, {
              details: { serialId: r.id, status: r.status },
            });
          }
          if (r.queuePosition === null) {
            throw new AppError('QUEUE_STATE_CONFLICT', undefined, {
              details: { serialId: r.id, reason: 'no_position' },
            });
          }
        }
        const before = input.orderedSerialIds.map((id) => rows.find((r) => r.id === id)!.queuePosition!);
        const moves = reorderAssignments(rows.map(queueRow), input.orderedSerialIds);
        for (const move of moves) {
          await tx.serial.update({
            where: { id: move.id },
            data: { queuePosition: move.to, updatedAt: now, rowVersion: { increment: 1 } },
          });
        }
        await tx.chamberDay.update({
          where: { id: chamberDayId },
          data: { queueOrderVersion: { increment: 1 }, updatedAt: now, updatedByUserId: actor.userId },
        });
        await this.queueEvents.append(tx, {
          tenantId,
          chamberDayId,
          eventType: 'QUEUE_REORDERED',
          details: {
            before: input.orderedSerialIds.map((id, i) => `${id}:${before[i]}`),
            after: moves.map((m) => `${m.id}:${m.to}`),
          },
          actor: { userId: actor.userId, actorType: 'USER' },
          idempotencyKey: actor.requestId ? `${actor.requestId}:QUEUE_REORDERED:${chamberDayId}` : null,
        });
        await this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'QUEUE_REORDERED',
          resourceType: 'chamber_day',
          resourceId: chamberDayId,
          outcome: 'SUCCESS',
          requestId: actor.requestId ?? null,
          correlationId: actor.correlationId ?? null,
          metadata: { serialIds: input.orderedSerialIds },
        });
        await this.outbox.emit(tx, {
          tenantId,
          name: 'QueueReordered',
          aggregateType: 'chamber_day',
          aggregateId: chamberDayId,
          payload: { chamberDayId, serialIds: input.orderedSerialIds },
          actorId: actor.userId,
          correlationId: actor.correlationId ?? null,
        });
      },
      { ...TX_OPTS, context: 'queue:reorder' },
    );
    return this.snapshot(tenantId, chamberDayId);
  }

  // ---------------------------------------------------------------- live reads (QUEUE §3.5)

  private async dayRows(tx: Tx, tenantId: string, chamberDayId: string): Promise<QueueRow[]> {
    const rows = await tx.serial.findMany({
      where: { tenantId, chamberDayId },
      select: { id: true, serialNumber: true, queuePosition: true, status: true },
      orderBy: { serialNumber: 'asc' },
    });
    return rows.map(queueRow);
  }

  /** Staff queue snapshot with a strong ETag; `If-None-Match` turns a poll into a 304 (QUEUE §3.5). */
  async snapshot(tenantId: string, chamberDayId: string): Promise<QueueSnapshot> {
    const dayRow = await this.prisma.chamberDay.findFirst({ where: { tenantId, id: chamberDayId } });
    if (!dayRow) throw new AppError('RESOURCE_NOT_FOUND');
    const day = dayFacts(dayRow);
    const serials = await this.prisma.serial.findMany({
      where: { tenantId, chamberDayId },
      orderBy: [{ queuePosition: 'asc' }, { serialNumber: 'asc' }],
    });
    const facts = await this.patients.factsByIds(tenantId, [...new Set(serials.map((s) => s.patientId))]);
    const ready = new Set(
      (
        await this.prisma.checkIn.findMany({
          where: { tenantId, serialId: { in: serials.map((s) => s.id) }, revokedAt: null, remoteReady: true },
          select: { serialId: true },
        })
      ).map((c) => c.serialId),
    );
    const entries: QueueEntry[] = serials.map((s) => ({
      serialId: s.id,
      serialNumber: s.serialNumber,
      queuePosition: s.queuePosition,
      status: s.status as SerialStatus,
      careMode: s.careMode,
      source: s.source,
      patientId: s.patientId,
      patientDisplayName: facts.get(s.patientId)?.displayName ?? '',
      medicalRecordNumber: facts.get(s.patientId)?.medicalRecordNumber ?? '',
      lateArrival: s.lateArrival,
      recallCount: s.recallCount,
      recallDeadlineAt: s.recallDeadlineAt?.toISOString() ?? null,
      remoteReady: ready.has(s.id),
      duplicateOverride: s.duplicateOverride,
      rowVersion: s.rowVersion,
    }));
    const count = (p: (s: SerialStatus) => boolean) => entries.filter((e) => p(e.status)).length;
    const body = {
      chamberDayId,
      localDate: day.localDate,
      status: day.status,
      queueOrderVersion: day.queueOrderVersion,
      expectedDelayMinutes: day.expectedDelayMinutes,
      avgConsultationMinutes: day.policy.avgConsultationMinutes,
      counts: {
        waiting: count((s) => s === 'WAITING' || s === 'CHECKED_IN'),
        called: count((s) => s === 'CALLED'),
        inConsultation: count((s) => s === 'IN_CONSULTATION'),
        completed: count((s) => s === 'COMPLETED'),
        total: entries.length,
      },
      entries,
    };
    // The ETag covers the day tokens and every serial's identity/state, so any mutation changes it.
    const etag = createHash('sha256')
      .update(
        JSON.stringify([
          day.queueOrderVersion,
          dayRow.rowVersion,
          day.status,
          day.expectedDelayMinutes,
          entries.map((e) => [e.serialId, e.status, e.queuePosition, e.rowVersion, e.remoteReady]),
        ]),
      )
      .digest('hex')
      .slice(0, 32);
    return { ...body, asOf: this.clock.now().toISOString(), etag: `"${etag}"` };
  }

  /**
   * Patient-facing serial view (QUEUE §4.2): the serial number and an estimate before arrival, people ahead
   * once waiting, the recall deadline when called. Never another patient's name, status or reason.
   */
  async patientView(ctx: PatientContextActor, serialId: string): Promise<PatientSerialView> {
    const s = await this.prisma.serial.findFirst({ where: { tenantId: ctx.tenantId, id: serialId } });
    if (!s) throw new AppError('RESOURCE_NOT_FOUND');
    if (s.patientId !== ctx.patientId) throw new AppError('FORBIDDEN');
    const dayRow = await this.prisma.chamberDay.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, id: s.chamberDayId },
    });
    const day = dayFacts(dayRow);
    const rows = (
      await this.prisma.serial.findMany({
        where: { tenantId: ctx.tenantId, chamberDayId: s.chamberDayId },
        select: { id: true, serialNumber: true, queuePosition: true, status: true },
      })
    ).map(queueRow);
    const status = s.status as SerialStatus;
    const arrived = QUEUE_ACTIVE_STATUSES.has(status) && s.queuePosition !== null;
    const ahead = arrived ? peopleAhead(rows, s.queuePosition!) : null;
    const estimate = arrived ? null : estimatedPosition(rows, s.serialNumber);
    return {
      serialId: s.id,
      serialNumber: s.serialNumber,
      status,
      chamberDayId: s.chamberDayId,
      localDate: day.localDate,
      dayStatus: day.status,
      careMode: s.careMode,
      peopleAhead: ahead,
      estimatedPosition: estimate,
      estimatedWaitMinutes:
        status === 'CALLED' || status === 'IN_CONSULTATION'
          ? 0
          : estimatedWaitMinutes({
              ahead: ahead ?? (estimate ?? 1) - 1,
              avgConsultationMinutes: day.policy.avgConsultationMinutes,
              expectedDelayMinutes: day.expectedDelayMinutes,
            }),
      expectedDelayMinutes: day.expectedDelayMinutes,
      recallDeadlineAt: status === 'CALLED' ? (s.recallDeadlineAt?.toISOString() ?? null) : null,
      recallsRemaining: status === 'SKIPPED' ? Math.max(0, day.policy.recallLimit - s.recallCount) : null,
      asOf: this.clock.now().toISOString(),
    };
  }

  /** `GET /me/serials`: the context patient's serials, newest day first. */
  async listMine(ctx: PatientContextActor, limit = 20): Promise<PatientSerialView[]> {
    const serials = await this.prisma.serial.findMany({
      where: { tenantId: ctx.tenantId, patientId: ctx.patientId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      select: { id: true },
    });
    return Promise.all(serials.map((s) => this.patientView(ctx, s.id)));
  }
}

/** Re-exported so the API layer can name the transition target without importing the row type. */
export type { SerialStatus };
export { serialTransition };
