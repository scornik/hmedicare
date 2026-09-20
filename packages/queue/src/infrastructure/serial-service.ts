import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import {
  type PrismaClient,
  type Tx,
  isUniqueViolation,
  lockRow,
  lockRows,
  withTransaction,
} from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { dhakaDate } from '@hmedic/localization';
import type { PatientContextActor } from '@hmedic/patient';
import {
  type AppointmentService,
  type ChamberDayFacts,
  type IssueSerialForAppointmentInput,
  type IssuedSerial,
  type QueueActorRef,
  QueueEventWriter,
  type SchedulingActor,
  type SerialPort,
  type SettledSerial,
  dayFacts,
  localInstant,
} from '@hmedic/scheduling';
import {
  DUPLICATE_GUARDED_STATUSES,
  PATIENT_CANCELLABLE,
  type SerialCommand,
  type SerialStatus,
  TERMINAL_STATUSES,
  eventForTransition,
  serialTransition,
} from '../domain/transitions';
import type { QueueOutbox } from './events';

export interface SerialView {
  id: string;
  chamberDayId: string;
  patientId: string;
  appointmentId: string | null;
  serialNumber: number;
  queuePosition: number | null;
  source: string;
  careMode: string;
  status: SerialStatus;
  recallCount: number;
  recallDeadlineAt: string | null;
  lateArrival: boolean;
  duplicateOverride: boolean;
  rescheduledFromSerialId: string | null;
  rescheduledToSerialId: string | null;
  cancelReason: string | null;
  bookedAt: string | null;
  confirmedAt: string | null;
  checkedInAt: string | null;
  calledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

/** Staff or patient-context caller of a serial command. */
export type SerialActor =
  { kind: 'staff'; actor: SchedulingActor } | { kind: 'patient'; context: PatientContextActor };

type SerialRow = Awaited<ReturnType<PrismaClient['serial']['findFirstOrThrow']>>;

const NON_CANCELLED: SerialStatus[] = [
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'WAITING',
  'CALLED',
  'IN_CONSULTATION',
  'SKIPPED',
  'NO_SHOW',
  'COMPLETED',
];
const BOOKED_SOURCES = ['ADVANCE_BOOKING', 'FOLLOW_UP', 'RESCHEDULE'];
const TX_OPTS = {
  isolation: 'ReadCommitted' as const,
  timeoutMs: 5_000,
  maxWaitMs: 2_000,
  exhaustedCode: 'QUEUE_BUSY' as const,
};

export function serialView(s: SerialRow): SerialView {
  return {
    id: s.id,
    chamberDayId: s.chamberDayId,
    patientId: s.patientId,
    appointmentId: s.appointmentId,
    serialNumber: s.serialNumber,
    queuePosition: s.queuePosition,
    source: s.source,
    careMode: s.careMode,
    status: s.status as SerialStatus,
    recallCount: s.recallCount,
    recallDeadlineAt: s.recallDeadlineAt?.toISOString() ?? null,
    lateArrival: s.lateArrival,
    duplicateOverride: s.duplicateOverride,
    rescheduledFromSerialId: s.rescheduledFromSerialId,
    rescheduledToSerialId: s.rescheduledToSerialId,
    cancelReason: s.cancelReason,
    bookedAt: s.bookedAt?.toISOString() ?? null,
    confirmedAt: s.confirmedAt?.toISOString() ?? null,
    checkedInAt: s.checkedInAt?.toISOString() ?? null,
    calledAt: s.calledAt?.toISOString() ?? null,
    completedAt: s.completedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    rowVersion: s.rowVersion,
  };
}

function actorRef(actor: SerialActor): QueueActorRef {
  return actor.kind === 'staff'
    ? { userId: actor.actor.userId, actorType: 'USER' }
    : { userId: actor.context.userId, actorType: 'PATIENT_CONTEXT' };
}

function correlation(actor: SerialActor): { requestId: string | null; correlationId: string } {
  const a = actor.kind === 'staff' ? actor.actor : actor.context;
  return { requestId: a.requestId ?? null, correlationId: a.correlationId ?? a.requestId ?? newId() };
}

const timestampFor: Partial<Record<SerialStatus, keyof SerialRow>> = {
  CONFIRMED: 'confirmedAt',
  CHECKED_IN: 'checkedInAt',
  WAITING: 'waitingAt',
  CALLED: 'calledAt',
  IN_CONSULTATION: 'consultationStartedAt',
  COMPLETED: 'completedAt',
  CANCELLED: 'cancelledAt',
  NO_SHOW: 'noShowAt',
};

/**
 * Serial engine (QUEUE-IMPLEMENTATION §3–§5, QUEUE-CONCURRENCY-DESIGN). Checkpoint 4 delivers the booked
 * serial lifecycle: allocation for appointments (under the chamber-day lock, `next_serial_number`),
 * confirm, cancel, manual and job-driven no-show, reschedule, and the close/cancel settlement used by the
 * scheduling context. Every mutation locks the day (rank 40) then the serial (44) and writes one
 * `queue_events` row, one audit row and the outbox event in the same transaction.
 */
export class SerialService implements SerialPort<Tx> {
  private readonly queueEvents: QueueEventWriter;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly outbox: QueueOutbox,
    private readonly appointments: AppointmentService,
    private readonly clock: Clock = systemClock,
  ) {
    this.queueEvents = new QueueEventWriter(clock);
  }

  // ---------------------------------------------------------------- SerialPort (called under the day lock)

  async issueForAppointment(tx: Tx, input: IssueSerialForAppointmentInput): Promise<IssuedSerial> {
    const { day } = input;
    const row = await tx.chamberDay.findFirstOrThrow({ where: { tenantId: day.tenantId, id: day.id } });
    const n = row.nextSerialNumber;
    await tx.chamberDay.update({ where: { id: day.id }, data: { nextSerialNumber: n + 1 } });
    const now = this.clock.now();
    const id = newId();
    try {
      await tx.serial.create({
        data: {
          id,
          tenantId: day.tenantId,
          chamberDayId: day.id,
          patientId: input.patientId,
          appointmentId: input.appointmentId,
          serialNumber: n,
          source: input.source,
          careMode: input.careMode,
          status: 'BOOKED',
          rescheduledFromSerialId: input.rescheduledFromSerialId ?? null,
          bookedAt: now,
          createdAt: now,
          updatedAt: now,
          createdByUserId: input.actor.userId,
          updatedByUserId: input.actor.userId,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error, 'uq_serials_active_patient_day')) throw error;
      const existing = await tx.serial.findFirst({
        where: {
          tenantId: day.tenantId,
          chamberDayId: day.id,
          patientId: input.patientId,
          status: { in: [...DUPLICATE_GUARDED_STATUSES] },
        },
        select: { id: true },
      });
      throw new AppError('DUPLICATE_ACTIVE_SERIAL', undefined, {
        details: { existingSerialId: existing?.id ?? null },
      });
    }
    await this.queueEvents.append(tx, {
      tenantId: day.tenantId,
      chamberDayId: day.id,
      serialId: id,
      eventType: 'SERIAL_ISSUED',
      toStatus: 'BOOKED',
      details: {
        serialNumber: n,
        source: input.source,
        careMode: input.careMode,
        appointmentId: input.appointmentId,
        ...(input.rescheduledFromSerialId ? { rescheduledFrom: input.rescheduledFromSerialId } : {}),
      },
      actor: input.actor,
      idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:SERIAL_ISSUED` : null,
    });
    await this.audit.append(tx, {
      tenantId: day.tenantId,
      actorUserId: input.actor.userId,
      actorType: input.actor.actorType,
      action: 'SERIAL_ISSUED',
      resourceType: 'serial',
      resourceId: id,
      outcome: 'SUCCESS',
      correlationId: input.correlationId,
      metadata: {
        chamberDayId: day.id,
        serialNumber: n,
        source: input.source,
        appointmentId: input.appointmentId,
      },
    });
    await this.outbox.emit(tx, {
      tenantId: day.tenantId,
      name: 'SerialIssued',
      aggregateType: 'serial',
      aggregateId: id,
      payload: {
        serialId: id,
        chamberDayId: day.id,
        patientId: input.patientId,
        serialNumber: n,
        source: input.source,
        status: 'BOOKED',
      },
      actorId: input.actor.userId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:SerialIssued` : null,
    });
    return { serialId: id, serialNumber: n };
  }

  async cancelForAppointment(
    tx: Tx,
    input: {
      day: ChamberDayFacts;
      appointmentId: string;
      reason: string;
      actor: QueueActorRef;
      correlationId: string;
    },
  ): Promise<string | null> {
    const s = await tx.serial.findFirst({
      where: {
        tenantId: input.day.tenantId,
        appointmentId: input.appointmentId,
        status: { notIn: [...TERMINAL_STATUSES] },
      },
    });
    if (!s) return null;
    if (input.actor.actorType === 'PATIENT_CONTEXT' && !PATIENT_CANCELLABLE.has(s.status as SerialStatus))
      throw new AppError('INVALID_TRANSITION', undefined, { details: { from: s.status, command: 'cancel' } });
    await lockRow(tx, 'serials', s.id, input.day.tenantId);
    await this.applyTransition(tx, input.day, s, 'cancel', {
      actor: input.actor,
      reason: input.reason,
      correlationId: input.correlationId,
      requestId: null,
      data: { cancelReason: input.reason },
    });
    return s.id;
  }

  async countsForDay(tx: Tx, tenantId: string, chamberDayId: string) {
    const rows = await tx.serial.groupBy({
      by: ['source'],
      where: { tenantId, chamberDayId, status: { in: NON_CANCELLED } },
      _count: { _all: true },
    });
    let booked = 0;
    let walkIns = 0;
    for (const r of rows) {
      if (r.source === 'WALK_IN') walkIns += r._count._all;
      else if (BOOKED_SOURCES.includes(r.source)) booked += r._count._all;
    }
    return { nonCancelled: booked + walkIns, booked, walkIns };
  }

  async hasActiveConsultation(tx: Tx, tenantId: string, chamberDayId: string): Promise<boolean> {
    return (await tx.serial.count({ where: { tenantId, chamberDayId, status: 'IN_CONSULTATION' } })) > 0;
  }

  async settleDay(
    tx: Tx,
    input: { day: ChamberDayFacts; mode: 'CLOSE' | 'CANCEL'; actor: QueueActorRef; correlationId: string },
  ): Promise<SettledSerial[]> {
    const { day } = input;
    const open = await tx.serial.findMany({
      where: { tenantId: day.tenantId, chamberDayId: day.id, status: { notIn: [...TERMINAL_STATUSES] } },
      orderBy: { id: 'asc' },
    });
    if (open.length === 0) return [];
    await lockRows(
      tx,
      'serials',
      open.map((s) => s.id),
      day.tenantId,
    );
    const reason = input.mode === 'CLOSE' ? 'DAY_CLOSED' : 'DAY_CANCELLED';
    const settled: SettledSerial[] = [];
    for (const s of open) {
      const from = s.status as SerialStatus;
      const to: 'NO_SHOW' | 'CANCELLED' =
        input.mode === 'CANCEL'
          ? 'CANCELLED'
          : (day.policy.dayCloseDisposition[from as keyof typeof day.policy.dayCloseDisposition] ??
            'CANCELLED');
      const command: SerialCommand = to === 'NO_SHOW' ? 'no_show' : 'cancel';
      // IN_CONSULTATION is refused before close; on cancel it falls back to CANCELLED (ADR-021: no encounter yet).
      await this.applyTransition(tx, day, s, command, {
        actor: input.actor,
        reason,
        correlationId: input.correlationId,
        requestId: null,
        data: to === 'CANCELLED' ? { cancelReason: reason } : {},
        force: to,
      });
      settled.push({ serialId: s.id, appointmentId: s.appointmentId, fromStatus: from, toStatus: to });
    }
    return settled;
  }

  // ---------------------------------------------------------------- single-serial transitions (QUEUE §5.4)

  /**
   * Applies one transition to an already locked serial: status, timestamps, the queue event, the audit row,
   * the outbox event and the appointment follow-up, all inside the caller's transaction. Shared with
   * `QueueService` (the queue-active lifecycle); not part of the context's public API.
   */
  async applyTransition(
    tx: Tx,
    day: ChamberDayFacts,
    s: SerialRow,
    command: SerialCommand,
    o: {
      actor: QueueActorRef;
      reason: string | null;
      correlationId: string;
      requestId: string | null;
      data?: Record<string, unknown>;
      details?: Record<string, string | number | boolean | null>;
      force?: SerialStatus;
      /** The caller's Idempotency-Key, which is what a retry repeats (the request id changes each attempt). */
      idempotencyKey?: string | null;
    },
  ): Promise<SerialRow> {
    const from = s.status as SerialStatus;
    const to = o.force ?? serialTransition(from, command);
    if (!to) throw new AppError('INVALID_TRANSITION', undefined, { details: { from, command } });
    const now = this.clock.now();
    const stamp = timestampFor[to];
    const updated = await tx.serial.update({
      where: { id: s.id },
      data: {
        status: to,
        ...(stamp ? { [stamp]: now } : {}),
        ...(o.data ?? {}),
        updatedAt: now,
        updatedByUserId: o.actor.userId,
        rowVersion: { increment: 1 },
      },
    });
    const eventType = eventForTransition(command) as Parameters<QueueEventWriter['append']>[1]['eventType'];
    await this.queueEvents.append(tx, {
      tenantId: day.tenantId,
      chamberDayId: day.id,
      serialId: s.id,
      eventType,
      fromStatus: from,
      toStatus: to,
      positionBefore: s.queuePosition,
      positionAfter: updated.queuePosition,
      details: o.details ?? {},
      reason: o.reason,
      actor: o.actor,
      idempotencyKey: o.idempotencyKey ? `${o.idempotencyKey}:${eventType}:${s.id}` : null,
    });
    await this.audit.append(tx, {
      tenantId: day.tenantId,
      actorUserId: o.actor.userId,
      actorType: o.actor.actorType,
      action: `SERIAL_${eventType}`,
      resourceType: 'serial',
      resourceId: s.id,
      outcome: 'SUCCESS',
      requestId: o.requestId,
      correlationId: o.correlationId,
      metadata: { chamberDayId: day.id, from, to, ...(o.reason ? { reason: o.reason } : {}) },
    });
    const outboxName = (
      {
        CONFIRMED: 'SerialConfirmed',
        CHECKED_IN: 'SerialCheckedIn',
        WAITING: 'SerialWaiting',
        CALLED: 'SerialCalled',
        SKIPPED: 'SerialSkipped',
        RECALLED: 'SerialRecalled',
        NO_SHOW: 'SerialNoShow',
        CANCELLED: 'SerialCancelled',
        RESCHEDULED: 'SerialRescheduled',
        COMPLETED: 'SerialCompleted',
      } as const
    )[eventType as 'CONFIRMED'];
    if (outboxName) {
      await this.outbox.emit(tx, {
        tenantId: day.tenantId,
        name: outboxName,
        aggregateType: 'serial',
        aggregateId: s.id,
        payload: {
          serialId: s.id,
          chamberDayId: day.id,
          patientId: s.patientId,
          serialNumber: s.serialNumber,
          from,
          to,
        },
        actorId: o.actor.userId,
        correlationId: o.correlationId,
      });
    }
    if (s.appointmentId && (to === 'NO_SHOW' || to === 'COMPLETED')) {
      await this.appointments.followSerial(
        tx,
        day.tenantId,
        s.appointmentId,
        to === 'NO_SHOW' ? 'no_show' : 'fulfil',
        o.actor,
      );
    }
    return updated;
  }

  /**
   * Locks the chamber day then the serial (ranks 40 → 44), checks `expectedRowVersion` and the day status,
   * runs an optional guard and applies one command. Shared with `QueueService`.
   */
  async transitionSerial(
    actor: SerialActor,
    serialId: string,
    expectedRowVersion: number,
    command: SerialCommand,
    o: {
      reason?: string | null;
      data?: Record<string, unknown>;
      /** Synchronous precondition on the locked rows. */
      guard?: (s: SerialRow, day: ChamberDayFacts) => void;
      /** Precondition that needs its own reads (remote readiness, the chamber's doctor). */
      guardAsync?: (tx: Tx, s: SerialRow, day: ChamberDayFacts) => Promise<void>;
      /** Column updates derived from the day's policy (recall deadlines, recall counts). */
      dataFromDay?: (day: ChamberDayFacts) => Record<string, unknown>;
      /** Runs after the transition, still inside the transaction (queue placement, check-in rows). */
      after?: (tx: Tx, day: ChamberDayFacts, before: SerialRow) => Promise<void>;
      /** The caller's Idempotency-Key; scopes the queue event so a retry cannot write it twice. */
      idempotencyKey?: string | null;
    },
  ): Promise<SerialView> {
    const tenantId = actor.kind === 'staff' ? actor.actor.tenant.tenantId : actor.context.tenantId;
    const before = await this.require(tenantId, serialId);
    if (actor.kind === 'patient' && before.patientId !== actor.context.patientId)
      throw new AppError('FORBIDDEN');
    const { requestId, correlationId } = correlation(actor);
    const row = await withTransaction(
      this.prisma,
      async (tx) => {
        await lockRow(tx, 'chamber_days', before.chamberDayId, tenantId);
        const day = dayFacts(
          await tx.chamberDay.findFirstOrThrow({ where: { tenantId, id: before.chamberDayId } }),
        );
        await lockRow(tx, 'serials', serialId, tenantId);
        const s = await tx.serial.findFirstOrThrow({ where: { tenantId, id: serialId } });
        if (s.rowVersion !== expectedRowVersion) {
          throw new AppError('STALE_VERSION', undefined, {
            details: { currentRowVersion: s.rowVersion, status: s.status },
          });
        }
        if (day.status === 'CLOSED' || day.status === 'CANCELLED')
          throw new AppError('QUEUE_STATE_CONFLICT', undefined, { details: { dayStatus: day.status } });
        o.guard?.(s, day);
        if (o.guardAsync) await o.guardAsync(tx, s, day);
        const updated = await this.applyTransition(tx, day, s, command, {
          actor: actorRef(actor),
          reason: o.reason ?? null,
          correlationId,
          requestId,
          data: { ...(o.data ?? {}), ...(o.dataFromDay?.(day) ?? {}) },
          idempotencyKey: o.idempotencyKey ?? null,
        });
        if (o.after) await o.after(tx, day, s);
        // `after` may move the row (queue placement), so the caller gets the committed state.
        return o.after ? tx.serial.findFirstOrThrow({ where: { tenantId, id: serialId } }) : updated;
      },
      { ...TX_OPTS, context: `serial:${command}` },
    );
    return serialView(row);
  }

  /** ConfirmSerial (staff `serial.manage` or the patient context). */
  confirm(actor: SerialActor, serialId: string, input: { expectedRowVersion: number }): Promise<SerialView> {
    return this.transitionSerial(actor, serialId, input.expectedRowVersion, 'confirm', {});
  }

  /** CancelSerial: staff any non-terminal state; patients only BOOKED/CONFIRMED (QUEUE §1). */
  cancel(
    actor: SerialActor,
    serialId: string,
    input: { expectedRowVersion: number; reason: string },
  ): Promise<SerialView> {
    return this.transitionSerial(actor, serialId, input.expectedRowVersion, 'cancel', {
      reason: input.reason,
      data: { cancelReason: input.reason },
      guard: (s) => {
        if (actor.kind === 'patient' && !PATIENT_CANCELLABLE.has(s.status as SerialStatus))
          throw new AppError('INVALID_TRANSITION', undefined, {
            details: { from: s.status, command: 'cancel' },
          });
      },
    });
  }

  /** MarkNoShow (staff `serial.manage`): any time after the day's local start. */
  markNoShow(
    actor: SerialActor,
    serialId: string,
    input: { expectedRowVersion: number; reason?: string | null },
  ): Promise<SerialView> {
    if (actor.kind !== 'staff') throw new AppError('FORBIDDEN');
    return this.transitionSerial(actor, serialId, input.expectedRowVersion, 'no_show', {
      reason: input.reason ?? null,
      guard: (_s, day) => {
        if (this.clock.now() < localInstant(day.localDate, day.localStartTime))
          throw new AppError('QUEUE_STATE_CONFLICT', undefined, { details: { reason: 'day_not_started' } });
      },
    });
  }

  // ---------------------------------------------------------------- reschedule (QUEUE §3.2)

  /**
   * RescheduleSerial: the old serial becomes RESCHEDULED (terminal) and a new BOOKED serial is issued on the
   * target day with `rescheduled_from_serial_id`; the appointment pair follows. Both days are locked in id
   * order, then the serial. Idempotent through the route's Idempotency-Key.
   */
  async reschedule(
    actor: SerialActor,
    serialId: string,
    input: {
      expectedRowVersion: number;
      targetChamberDayId: string;
      targetSlotId?: string | null;
      reason?: string | null;
    },
    opts: { idempotencyKey?: string | null } = {},
  ): Promise<{ old: SerialView; next: SerialView }> {
    const tenantId = actor.kind === 'staff' ? actor.actor.tenant.tenantId : actor.context.tenantId;
    const before = await this.require(tenantId, serialId);
    if (actor.kind === 'patient') {
      if (before.patientId !== actor.context.patientId) throw new AppError('FORBIDDEN');
      if (actor.context.actingAs === 'GUARDIAN' && !actor.context.authorityScope.has('BOOK_APPOINTMENTS'))
        throw new AppError('FORBIDDEN');
    }
    if (!before.appointmentId)
      throw new AppError('INVALID_TRANSITION', undefined, {
        details: { reason: 'walk_in_not_reschedulable' },
      });
    const { requestId, correlationId } = correlation(actor);
    const ref = actorRef(actor);
    const result = await withTransaction(
      this.prisma,
      async (tx) => {
        const dayIds = [before.chamberDayId, input.targetChamberDayId].sort();
        await lockRows(tx, 'chamber_days', dayIds, tenantId);
        const source = dayFacts(
          await tx.chamberDay.findFirstOrThrow({ where: { tenantId, id: before.chamberDayId } }),
        );
        const targetRow = await tx.chamberDay.findFirst({
          where: { tenantId, id: input.targetChamberDayId },
        });
        if (!targetRow) throw new AppError('RESOURCE_NOT_FOUND');
        const target = dayFacts(targetRow);
        if (target.id === source.id)
          throw new AppError('VALIDATION_FAILED', undefined, {
            fieldErrors: [{ path: 'targetChamberDayId', code: 'same_day', message: 'validation.same_day' }],
          });
        // Lock order: chamber_days (40) → appointments (42) → serials (44).
        await lockRow(tx, 'appointments', before.appointmentId!, tenantId);
        const oldAppointment = await tx.appointment.findFirstOrThrow({
          where: { tenantId, id: before.appointmentId! },
        });
        await lockRow(tx, 'serials', serialId, tenantId);
        const s = await tx.serial.findFirstOrThrow({ where: { tenantId, id: serialId } });
        if (s.rowVersion !== input.expectedRowVersion)
          throw new AppError('STALE_VERSION', undefined, {
            details: { currentRowVersion: s.rowVersion, status: s.status },
          });
        if (!serialTransition(s.status as SerialStatus, 'reschedule'))
          throw new AppError('INVALID_TRANSITION', undefined, {
            details: { from: s.status, command: 'reschedule' },
          });
        const rebooked = await this.appointments.rebook(tx, {
          from: oldAppointment,
          target,
          targetSlotId: input.targetSlotId ?? null,
          staff: actor.kind === 'staff',
          actor: ref,
          userId: ref.userId!,
          onBehalf:
            actor.kind === 'staff' ? 'STAFF' : actor.context.actingAs === 'GUARDIAN' ? 'GUARDIAN' : 'SELF',
          rescheduledFromSerialId: s.id,
          correlationId,
          idempotencyKey: opts.idempotencyKey ?? null,
        });
        const old = await this.applyTransition(tx, source, s, 'reschedule', {
          actor: ref,
          reason: input.reason ?? null,
          correlationId,
          requestId,
          data: { rescheduledToSerialId: rebooked.serialId },
          details: { targetChamberDayId: target.id, newSerialId: rebooked.serialId },
        });
        const next = await tx.serial.findFirstOrThrow({ where: { tenantId, id: rebooked.serialId } });
        return { old: serialView(old), next: serialView(next) };
      },
      { ...TX_OPTS, context: 'serial:reschedule' },
    );
    return result;
  }

  // ---------------------------------------------------------------- no-show job (QUEUE §3.2, §5.6)

  /**
   * ApplyNoShowPolicy: for every open-ish chamber day of today and yesterday (clinic local time) with
   * `autoNoShowEnabled`, BOOKED/CONFIRMED serials whose cut-off (slot start, else the day's local start,
   * plus `noShowAfterMinutes`) has passed become NO_SHOW by the SYSTEM actor. Each day runs in its own
   * transaction under the day lock; a second run finds nothing to change (idempotent by construction).
   */
  async applyNoShowPolicy(now: Date = this.clock.now()): Promise<{ daysScanned: number; marked: number }> {
    const today = dhakaDate(now);
    const yesterday = dhakaDate(new Date(now.getTime() - 86_400_000));
    const days = await this.prisma.chamberDay.findMany({
      where: {
        status: { in: ['SCHEDULED', 'OPEN', 'PAUSED'] },
        localDate: { in: [new Date(`${yesterday}T00:00:00.000Z`), new Date(`${today}T00:00:00.000Z`)] },
      },
      select: { id: true, tenantId: true },
      take: 1000,
    });
    let marked = 0;
    for (const d of days) {
      marked += await withTransaction(
        this.prisma,
        async (tx) => {
          await lockRow(tx, 'chamber_days', d.id, d.tenantId);
          const day = dayFacts(
            await tx.chamberDay.findFirstOrThrow({ where: { tenantId: d.tenantId, id: d.id } }),
          );
          if (!day.policy.autoNoShowEnabled) return 0;
          const dayStart = localInstant(day.localDate, day.localStartTime);
          const candidates = await tx.serial.findMany({
            where: { tenantId: d.tenantId, chamberDayId: d.id, status: { in: ['BOOKED', 'CONFIRMED'] } },
            orderBy: { id: 'asc' },
          });
          if (candidates.length === 0) return 0;
          const slotStarts = new Map<string, Date>();
          const appointmentIds = candidates
            .map((c) => c.appointmentId)
            .filter((a): a is string => a !== null);
          if (appointmentIds.length) {
            const appts = await tx.appointment.findMany({
              where: { tenantId: d.tenantId, id: { in: appointmentIds }, slotId: { not: null } },
              select: { id: true, slotId: true },
            });
            const slotIds = appts.map((a) => a.slotId!).filter(Boolean);
            const slots = slotIds.length
              ? await tx.appointmentSlot.findMany({
                  where: { tenantId: d.tenantId, id: { in: slotIds } },
                  select: { id: true, startsAt: true },
                })
              : [];
            const startOf = new Map(slots.map((s) => [s.id, s.startsAt]));
            for (const a of appts)
              if (a.slotId && startOf.has(a.slotId)) slotStarts.set(a.id, startOf.get(a.slotId)!);
          }
          const due = candidates.filter((c) => {
            const start = (c.appointmentId && slotStarts.get(c.appointmentId)) || dayStart;
            return now.getTime() > start.getTime() + day.policy.noShowAfterMinutes * 60_000;
          });
          if (due.length === 0) return 0;
          await lockRows(
            tx,
            'serials',
            due.map((s) => s.id),
            d.tenantId,
          );
          for (const s of due) {
            await this.applyTransition(tx, day, s, 'no_show', {
              actor: { userId: null, actorType: 'SYSTEM' },
              reason: 'NO_SHOW_POLICY',
              correlationId: newId(),
              requestId: null,
              details: { noShowAfterMinutes: day.policy.noShowAfterMinutes },
            });
          }
          return due.length;
        },
        { ...TX_OPTS, context: 'no_show_job' },
      );
    }
    return { daysScanned: days.length, marked };
  }

  // ---------------------------------------------------------------- reads

  async require(tenantId: string, serialId: string, tx?: Tx): Promise<SerialRow> {
    const s = await (tx ?? this.prisma).serial.findFirst({ where: { tenantId, id: serialId } });
    if (!s) throw new AppError('RESOURCE_NOT_FOUND');
    return s;
  }

  async get(actor: SerialActor, serialId: string): Promise<SerialView> {
    const tenantId = actor.kind === 'staff' ? actor.actor.tenant.tenantId : actor.context.tenantId;
    const s = await this.require(tenantId, serialId);
    if (actor.kind === 'patient' && s.patientId !== actor.context.patientId) throw new AppError('FORBIDDEN');
    return serialView(s);
  }
}
