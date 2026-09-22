import { AppError, type Clock, type FieldError, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { dhakaDate } from '@hmedic/localization';
import type { PatientContextActor, PatientReadPort } from '@hmedic/patient';
import type {
  BookingActor,
  ChamberDayFacts,
  PaymentsAvailabilityPort,
  QueueActorRef,
  SchedulingActor,
  SerialPort,
} from '../application/ports';
import {
  type AppointmentStatus,
  type CancelReason,
  appointmentTransition,
} from '../domain/appointment-transitions';
import {
  BOOKABLE_DAY_STATUSES,
  type BookingRefusal,
  type CareMode,
  bookingCutoffPassed,
  bookingDateRefusal,
  capacityRefusal,
  careModeSupported,
  isRefusal,
  paymentTermsFor,
} from '../domain/booking-rules';
import { localInstant } from '../domain/schedule';
import { type ChamberDayService, dayFacts } from './chamber-day-service';
import { type ChamberService, assertChamberScope, bookingFacts } from './chamber-service';
import type { SchedulingEvents } from './events';

export interface AppointmentView {
  id: string;
  patientId: string;
  doctorProfileId: string;
  chamberId: string;
  chamberDayId: string;
  localDate: string;
  slotId: string | null;
  slotLabel: string | null;
  source: string;
  careMode: CareMode;
  status: AppointmentStatus;
  paymentRequirement: string;
  paymentStatus: string;
  reason: string | null;
  cancelReason: string | null;
  rescheduledFromAppointmentId: string | null;
  bookedByUserId: string;
  bookedOnBehalf: 'SELF' | 'GUARDIAN' | 'STAFF' | null;
  serial: { id: string; serialNumber: number; status: string } | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface CreateAppointmentInput {
  chamberId: string;
  localDate: string;
  patientId: string;
  careMode: CareMode;
  slotId?: string | null;
  reason?: string | null;
  source?: 'ADVANCE_BOOKING' | 'FOLLOW_UP';
}

export interface AppointmentListFilter {
  chamberDayId?: string;
  patientId?: string;
  status?: AppointmentStatus;
  cursor?: string;
  limit?: number;
}

export interface AppointmentPage {
  items: AppointmentView[];
  nextCursor: string | null;
  hasMore: boolean;
}

type AppointmentRow = Awaited<ReturnType<PrismaClient['appointment']['findFirstOrThrow']>>;
type OnBehalf = 'SELF' | 'GUARDIAN' | 'STAFF';

/** Who books: tenant, acting user, on-behalf marker and the queue actor reference. */
interface Booker {
  tenantId: string;
  userId: string;
  onBehalf: OnBehalf;
  queueActor: QueueActorRef;
  staff: boolean;
  requestId: string | null;
  correlationId: string;
}

const validation = (fieldErrors: FieldError[]) =>
  new AppError('VALIDATION_FAILED', undefined, { fieldErrors });
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const dateText = (d: Date) => d.toISOString().slice(0, 10);
const DEFAULT_LIMIT = 50;
const TX_OPTS = {
  isolation: 'ReadCommitted' as const,
  timeoutMs: 5_000,
  maxWaitMs: 2_000,
  exhaustedCode: 'QUEUE_BUSY' as const,
  context: 'booking',
};

function refusalError(r: BookingRefusal, path: string): AppError {
  if (r.code === 'FEATURE_DISABLED')
    return new AppError('FEATURE_DISABLED', undefined, { details: { reason: r.reason } });
  if (r.code === 'CAPACITY_EXCEEDED')
    return new AppError('CAPACITY_EXCEEDED', undefined, { details: { reason: r.reason } });
  return validation([{ path, code: r.reason, message: `validation.${r.reason}` }]);
}

function resolveBooker(actor: BookingActor, patientId: string): Booker {
  if (actor.kind === 'staff') {
    return {
      tenantId: actor.actor.tenant.tenantId,
      userId: actor.actor.userId,
      onBehalf: 'STAFF',
      queueActor: { userId: actor.actor.userId, actorType: 'USER' },
      staff: true,
      requestId: actor.actor.requestId ?? null,
      correlationId: actor.actor.correlationId ?? actor.actor.requestId ?? newId(),
    };
  }
  const ctx = actor.context;
  if (ctx.patientId !== patientId) throw new AppError('FORBIDDEN');
  if (ctx.actingAs === 'GUARDIAN' && !ctx.authorityScope.has('BOOK_APPOINTMENTS'))
    throw new AppError('FORBIDDEN');
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    onBehalf: ctx.actingAs === 'GUARDIAN' ? 'GUARDIAN' : 'SELF',
    queueActor: {
      userId: ctx.userId,
      actorType: 'PATIENT_CONTEXT',
      actingAs: ctx.actingAs === 'GUARDIAN' ? 'GUARDIAN' : 'SELF',
      onBehalfOfPatientId: ctx.patientId,
    },
    staff: false,
    requestId: ctx.requestId ?? null,
    correlationId: ctx.correlationId ?? ctx.requestId ?? newId(),
  };
}

/**
 * Appointments (API §3.5, DATABASE §3.5, QUEUE §3.1/§5.2, audit C-44/C-45): the booking intent for a
 * patient on a chamber day. `create` materializes the day on demand, locks it, applies the booking policy
 * and capacity, inserts the appointment and issues the BOOKED serial through the queue context — all in one
 * READ COMMITTED transaction with the audit row, the outbox event and (when provided) the idempotency
 * completion. No `PENDING_PAYMENT` row is ever written while payments are absent (C-45).
 */
export class AppointmentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly events: SchedulingEvents,
    private readonly chambers: ChamberService,
    private readonly days: ChamberDayService,
    private readonly serials: SerialPort<Tx>,
    private readonly patients: PatientReadPort,
    private readonly payments: PaymentsAvailabilityPort,
    private readonly clock: Clock = systemClock,
  ) {}

  // ---------------------------------------------------------------- views

  private async views(
    tenantId: string,
    rows: AppointmentRow[],
    db: Tx | PrismaClient = this.prisma,
  ): Promise<AppointmentView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const serials = await db.serial.findMany({
      where: { tenantId, appointmentId: { in: ids } },
      select: { id: true, appointmentId: true, serialNumber: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    const serialOf = new Map<string, { id: string; serialNumber: number; status: string }>();
    for (const s of serials)
      if (s.appointmentId && !serialOf.has(s.appointmentId)) serialOf.set(s.appointmentId, s);
    const dayIds = [...new Set(rows.map((r) => r.chamberDayId))];
    const days = new Map(
      (
        await db.chamberDay.findMany({
          where: { tenantId, id: { in: dayIds } },
          select: { id: true, localDate: true },
        })
      ).map((d) => [d.id, dateText(d.localDate)]),
    );
    const slotIds = rows.map((r) => r.slotId).filter((s): s is string => s !== null);
    const slots = new Map(
      slotIds.length
        ? (
            await db.appointmentSlot.findMany({
              where: { tenantId, id: { in: slotIds } },
              select: { id: true, localLabel: true },
            })
          ).map((s) => [s.id, s.localLabel])
        : [],
    );
    return rows.map((a) => ({
      id: a.id,
      patientId: a.patientId,
      doctorProfileId: a.doctorProfileId,
      chamberId: a.chamberId,
      chamberDayId: a.chamberDayId,
      localDate: days.get(a.chamberDayId) ?? '',
      slotId: a.slotId,
      slotLabel: a.slotId ? (slots.get(a.slotId) ?? null) : null,
      source: a.source,
      careMode: a.careMode as CareMode,
      status: a.status as AppointmentStatus,
      paymentRequirement: a.paymentRequirement,
      paymentStatus: a.paymentStatus,
      reason: a.reason,
      cancelReason: a.cancelReason,
      rescheduledFromAppointmentId: a.rescheduledFromAppointmentId,
      bookedByUserId: a.bookedByUserId,
      bookedOnBehalf: a.bookedOnBehalf as AppointmentView['bookedOnBehalf'],
      serial: serialOf.get(a.id) ?? null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      rowVersion: a.rowVersion,
    }));
  }

  async require(tenantId: string, id: string, tx?: Tx): Promise<AppointmentRow> {
    const a = await (tx ?? this.prisma).appointment.findFirst({ where: { tenantId, id, deletedAt: null } });
    if (!a) throw new AppError('RESOURCE_NOT_FOUND');
    return a;
  }

  // ---------------------------------------------------------------- booking core (under the day lock)

  /**
   * Books one appointment + serial on an already locked chamber day (rank 40 held by the caller). Shared by
   * `create` and `rebook` (reschedule). Returns the appointment row and the issued serial.
   */
  private async bookOnDay(
    tx: Tx,
    day: ChamberDayFacts,
    b: {
      who: Booker;
      chamber: { id: string; doctorProfileId: string };
      patientId: string;
      careMode: CareMode;
      source: 'ADVANCE_BOOKING' | 'FOLLOW_UP' | 'RESCHEDULE';
      slotId: string | null;
      reason: string | null;
      terms: { requirement: string; status: string };
      rescheduledFromAppointmentId: string | null;
      rescheduledFromSerialId: string | null;
      idempotencyKey: string | null;
      today: string;
      now: Date;
    },
  ) {
    const { who, now } = b;
    if (!BOOKABLE_DAY_STATUSES.has(day.status))
      throw refusalError({ code: 'VALIDATION_FAILED', reason: 'day_not_bookable' }, 'localDate');
    if (!day.policy.advanceBookingEnabled)
      throw refusalError({ code: 'VALIDATION_FAILED', reason: 'booking_disabled' }, 'chamberId');
    const dateRefusal = bookingDateRefusal(day.policy, b.today, day.localDate);
    if (dateRefusal && !(who.staff && dateRefusal.reason === 'outside_booking_window'))
      throw refusalError(dateRefusal, 'localDate');
    if (bookingCutoffPassed(day.policy, now, localInstant(day.localDate, day.localStartTime), who.staff))
      throw refusalError({ code: 'VALIDATION_FAILED', reason: 'booking_cutoff_passed' }, 'localDate');
    const counts = await this.serials.countsForDay(tx, day.tenantId, day.id);
    const cap = capacityRefusal(day.policy, counts, 'booked');
    if (cap) throw refusalError(cap, 'localDate');

    let slotId: string | null = null;
    if (day.policy.slotMinutes !== null) {
      if (!b.slotId)
        throw validation([{ path: 'slotId', code: 'slot_required', message: 'validation.slot_required' }]);
      const slot = await tx.appointmentSlot.findFirst({
        where: { tenantId: day.tenantId, id: b.slotId, chamberDayId: day.id },
      });
      if (!slot)
        throw validation([{ path: 'slotId', code: 'unknown_slot', message: 'validation.unknown_slot' }]);
      if (slot.status !== 'OPEN' || slot.bookedCount >= slot.capacity)
        throw refusalError({ code: 'CAPACITY_EXCEEDED', reason: 'slot_full' }, 'slotId');
      // The day lock serializes bookings, so the slot counter needs no lock of its own (rank 34 < 40).
      await tx.appointmentSlot.update({
        where: { id: slot.id },
        data: {
          bookedCount: slot.bookedCount + 1,
          status: slot.bookedCount + 1 >= slot.capacity ? 'FULL' : 'OPEN',
          updatedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      slotId = slot.id;
    }

    const id = newId();
    const a = await tx.appointment.create({
      data: {
        id,
        tenantId: day.tenantId,
        patientId: b.patientId,
        doctorProfileId: b.chamber.doctorProfileId,
        chamberId: b.chamber.id,
        chamberDayId: day.id,
        slotId,
        source: b.source,
        careMode: b.careMode,
        status: 'BOOKED',
        paymentRequirement: b.terms.requirement,
        paymentStatus: b.terms.status,
        reason: b.reason,
        rescheduledFromAppointmentId: b.rescheduledFromAppointmentId,
        bookedByUserId: who.userId,
        bookedOnBehalf: who.onBehalf,
        createdAt: now,
        updatedAt: now,
        createdByUserId: who.userId,
        updatedByUserId: who.userId,
      },
    });
    const serial = await this.serials.issueForAppointment(tx, {
      day,
      appointmentId: id,
      patientId: b.patientId,
      careMode: b.careMode,
      source: b.source,
      rescheduledFromSerialId: b.rescheduledFromSerialId,
      actor: who.queueActor,
      correlationId: who.correlationId,
      idempotencyKey: b.idempotencyKey,
    });
    await this.audit.append(tx, {
      tenantId: day.tenantId,
      actorUserId: who.userId,
      actorType: who.queueActor.actorType,
      action: b.source === 'RESCHEDULE' ? 'APPOINTMENT_RESCHEDULED' : 'APPOINTMENT_BOOKED',
      resourceType: 'appointment',
      resourceId: id,
      outcome: 'SUCCESS',
      requestId: who.requestId,
      correlationId: who.correlationId,
      actingAs: who.onBehalf === 'STAFF' ? null : who.onBehalf,
      onBehalfOfPatientId: who.onBehalf === 'STAFF' ? null : b.patientId,
      metadata: {
        chamberDayId: day.id,
        chamberId: b.chamber.id,
        serialId: serial.serialId,
        serialNumber: serial.serialNumber,
        careMode: b.careMode,
        source: b.source,
        onBehalf: who.onBehalf,
        ...(b.rescheduledFromAppointmentId ? { rescheduledFrom: b.rescheduledFromAppointmentId } : {}),
      },
    });
    await this.events.emit(tx, {
      tenantId: day.tenantId,
      name: b.source === 'RESCHEDULE' ? 'AppointmentRescheduled' : 'AppointmentBooked',
      aggregateType: 'appointment',
      aggregateId: id,
      payload: {
        appointmentId: id,
        patientId: b.patientId,
        chamberId: b.chamber.id,
        chamberDayId: day.id,
        localDate: day.localDate,
        serialId: serial.serialId,
        serialNumber: serial.serialNumber,
        careMode: b.careMode,
        rescheduledFromAppointmentId: b.rescheduledFromAppointmentId,
      },
      actorId: who.userId,
      correlationId: who.correlationId,
      idempotencyKey: b.idempotencyKey ? `${b.idempotencyKey}:appointment` : null,
    });
    return { appointment: a, serial };
  }

  // ---------------------------------------------------------------- create

  async create(
    actor: BookingActor,
    input: CreateAppointmentInput,
    opts: {
      idempotencyKey?: string | null;
      onCommit?: (tx: Tx, view: AppointmentView) => Promise<void>;
    } = {},
  ): Promise<AppointmentView> {
    if (!DATE_RE.test(input.localDate))
      throw validation([{ path: 'localDate', code: 'invalid_date', message: 'validation.invalid_date' }]);
    const who = resolveBooker(actor, input.patientId);
    const tenantId = who.tenantId;
    const chamber = await this.chambers.require(tenantId, input.chamberId);
    if (actor.kind === 'staff') assertChamberScope(actor.actor, chamber);
    if (chamber.status !== 'ACTIVE')
      throw validation([
        { path: 'chamberId', code: 'chamber_inactive', message: 'validation.chamber_inactive' },
      ]);
    if (!careModeSupported(bookingFacts(chamber), input.careMode))
      throw validation([
        { path: 'careMode', code: 'care_mode_unsupported', message: 'validation.care_mode_unsupported' },
      ]);
    const patient = await this.patients.resolveActive(tenantId, input.patientId);
    if (!patient || patient.status !== 'ACTIVE')
      throw validation([
        { path: 'patientId', code: 'unknown_patient', message: 'validation.unknown_patient' },
      ]);
    const terms = paymentTermsFor(bookingFacts(chamber), input.careMode, this.payments.paymentsAvailable());
    if (isRefusal(terms)) throw refusalError(terms, 'careMode');
    const now = this.clock.now();
    const today = dhakaDate(now);

    return withTransaction(
      this.prisma,
      async (tx) => {
        const ensured = await this.days.ensure(tx, tenantId, chamber.id, input.localDate, who.userId);
        await lockRow(tx, 'chamber_days', ensured.row.id, tenantId);
        if (ensured.created) await this.days.recordMaterialized(tx, ensured.row, who.userId);
        const day = dayFacts(
          await tx.chamberDay.findFirstOrThrow({ where: { tenantId, id: ensured.row.id } }),
        );
        const { appointment } = await this.bookOnDay(tx, day, {
          who,
          chamber,
          patientId: patient.id,
          careMode: input.careMode,
          source: input.source ?? 'ADVANCE_BOOKING',
          slotId: input.slotId ?? null,
          reason: input.reason?.trim() || null,
          terms,
          rescheduledFromAppointmentId: null,
          rescheduledFromSerialId: null,
          idempotencyKey: opts.idempotencyKey ?? null,
          today,
          now,
        });
        const [view] = await this.views(tenantId, [appointment], tx);
        if (opts.onCommit) await opts.onCommit(tx, view!);
        return view!;
      },
      TX_OPTS,
    );
  }

  /**
   * Reschedule support for the queue context (RescheduleSerial, QUEUE §3.2): books the replacement on the
   * target day (both days already locked by the caller in id order) and marks the old appointment
   * RESCHEDULED. Returns the new appointment and serial ids.
   */
  async rebook(
    tx: Tx,
    input: {
      from: AppointmentRow;
      target: ChamberDayFacts;
      targetSlotId: string | null;
      staff: boolean;
      actor: QueueActorRef;
      userId: string;
      onBehalf: OnBehalf;
      rescheduledFromSerialId: string;
      correlationId: string;
      idempotencyKey: string | null;
    },
  ): Promise<{ appointmentId: string; serialId: string; serialNumber: number }> {
    const { from, target } = input;
    const to = appointmentTransition(from.status as AppointmentStatus, 'reschedule');
    if (!to)
      throw new AppError('INVALID_TRANSITION', undefined, {
        details: { from: from.status, command: 'reschedule' },
      });
    const chamber = await this.chambers.require(target.tenantId, target.chamberId, tx);
    if (chamber.doctorProfileId !== from.doctorProfileId)
      throw validation([
        { path: 'targetChamberDayId', code: 'different_doctor', message: 'validation.different_doctor' },
      ]);
    if (!careModeSupported(bookingFacts(chamber), from.careMode as CareMode))
      throw validation([
        {
          path: 'targetChamberDayId',
          code: 'care_mode_unsupported',
          message: 'validation.care_mode_unsupported',
        },
      ]);
    const terms = paymentTermsFor(
      bookingFacts(chamber),
      from.careMode as CareMode,
      this.payments.paymentsAvailable(),
    );
    if (isRefusal(terms)) throw refusalError(terms, 'careMode');
    const now = this.clock.now();
    const who: Booker = {
      tenantId: target.tenantId,
      userId: input.userId,
      onBehalf: input.onBehalf,
      queueActor: input.actor,
      staff: input.staff,
      requestId: null,
      correlationId: input.correlationId,
    };
    // The caller (RescheduleSerial) already holds both chamber-day locks and this appointment row lock,
    // taken in rank order 40 → 42 → 44 before this call (QUEUE-CONCURRENCY §1).
    const { appointment, serial } = await this.bookOnDay(tx, target, {
      who,
      chamber,
      patientId: from.patientId,
      careMode: from.careMode as CareMode,
      source: 'RESCHEDULE',
      slotId: input.targetSlotId,
      reason: from.reason,
      terms,
      rescheduledFromAppointmentId: from.id,
      rescheduledFromSerialId: input.rescheduledFromSerialId,
      idempotencyKey: input.idempotencyKey,
      today: dhakaDate(now),
      now,
    });
    await this.releaseSlot(tx, target.tenantId, from.slotId, now);
    await tx.appointment.update({
      where: { id: from.id },
      data: { status: to, updatedAt: now, updatedByUserId: input.userId, rowVersion: { increment: 1 } },
    });
    return { appointmentId: appointment.id, serialId: serial.serialId, serialNumber: serial.serialNumber };
  }

  private async releaseSlot(tx: Tx, tenantId: string, slotId: string | null, now: Date): Promise<void> {
    if (!slotId) return;
    const slot = await tx.appointmentSlot.findFirst({ where: { tenantId, id: slotId } });
    if (!slot || slot.bookedCount <= 0) return;
    await tx.appointmentSlot.update({
      where: { id: slot.id },
      data: {
        bookedCount: slot.bookedCount - 1,
        status: slot.status === 'FULL' ? 'OPEN' : slot.status,
        updatedAt: now,
        rowVersion: { increment: 1 },
      },
    });
  }

  // ---------------------------------------------------------------- cancel

  async cancel(
    actor: BookingActor,
    appointmentId: string,
    input: { expectedRowVersion: number; reason: string },
    opts: { onCommit?: (tx: Tx, view: AppointmentView) => Promise<void> } = {},
  ): Promise<AppointmentView> {
    const tenantId = actor.kind === 'staff' ? actor.actor.tenant.tenantId : actor.context.tenantId;
    const before = await this.require(tenantId, appointmentId);
    const who = resolveBooker(actor, before.patientId);
    if (actor.kind === 'staff')
      assertChamberScope(actor.actor, await this.chambers.require(tenantId, before.chamberId));
    const now = this.clock.now();
    return withTransaction(
      this.prisma,
      async (tx) => {
        await lockRow(tx, 'chamber_days', before.chamberDayId, tenantId);
        const dayRow = await tx.chamberDay.findFirstOrThrow({ where: { tenantId, id: before.chamberDayId } });
        await lockRow(tx, 'appointments', appointmentId, tenantId);
        const a = await tx.appointment.findFirstOrThrow({ where: { tenantId, id: appointmentId } });
        if (a.rowVersion !== input.expectedRowVersion)
          throw new AppError('STALE_VERSION', undefined, {
            details: { currentRowVersion: a.rowVersion, status: a.status },
          });
        const to = appointmentTransition(a.status as AppointmentStatus, 'cancel');
        if (!to)
          throw new AppError('INVALID_TRANSITION', undefined, {
            details: { from: a.status, command: 'cancel' },
          });
        const serialId = await this.serials.cancelForAppointment(tx, {
          day: dayFacts(dayRow),
          appointmentId,
          reason: input.reason,
          actor: who.queueActor,
          correlationId: who.correlationId,
        });
        await this.releaseSlot(tx, tenantId, a.slotId, now);
        const updated = await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            status: to,
            cancelReason: input.reason,
            updatedAt: now,
            updatedByUserId: who.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.audit.append(tx, {
          tenantId,
          actorUserId: who.userId,
          actorType: who.queueActor.actorType,
          action: 'APPOINTMENT_CANCELLED',
          resourceType: 'appointment',
          resourceId: appointmentId,
          outcome: 'SUCCESS',
          requestId: who.requestId,
          correlationId: who.correlationId,
          actingAs: who.onBehalf === 'STAFF' ? null : who.onBehalf,
          onBehalfOfPatientId: who.onBehalf === 'STAFF' ? null : a.patientId,
          metadata: { chamberDayId: a.chamberDayId, serialId, reason: input.reason },
        });
        await this.events.emit(tx, {
          tenantId,
          name: 'AppointmentCancelled',
          aggregateType: 'appointment',
          aggregateId: appointmentId,
          payload: {
            appointmentId,
            patientId: a.patientId,
            chamberDayId: a.chamberDayId,
            serialId,
            reason: input.reason,
          },
          actorId: who.userId,
          correlationId: who.correlationId,
        });
        const [view] = await this.views(tenantId, [updated], tx);
        if (opts.onCommit) await opts.onCommit(tx, view!);
        return view!;
      },
      TX_OPTS,
    );
  }

  /**
   * Cancels an appointment because its serial was cancelled (queue context, inside its transaction): the
   * status, the cancel reason and the slot all follow, so the pair never diverges and a cancelled serial
   * does not leave its slot consumed.
   *
   * This is deliberately driven from `SerialService.cancel` rather than from the shared transition, because
   * `cancelForAppointment` already drives the same pair from the appointment end and would otherwise cancel
   * the appointment twice.
   */
  async cancelFollowingSerial(
    tx: Tx,
    tenantId: string,
    appointmentId: string,
    input: { serialId: string; reason: CancelReason; actor: QueueActorRef; correlationId: string },
  ): Promise<void> {
    const a = await tx.appointment.findFirst({ where: { tenantId, id: appointmentId } });
    if (!a) return;
    const to = appointmentTransition(a.status as AppointmentStatus, 'cancel');
    if (!to) return;
    const now = this.clock.now();
    await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status: to,
        cancelReason: input.reason,
        updatedAt: now,
        updatedByUserId: input.actor.userId,
        rowVersion: { increment: 1 },
      },
    });
    await this.releaseSlot(tx, tenantId, a.slotId, now);
    await this.audit.append(tx, {
      tenantId,
      actorUserId: input.actor.userId,
      actorType: input.actor.actorType,
      actingAs: input.actor.actingAs ?? null,
      onBehalfOfPatientId: input.actor.onBehalfOfPatientId ?? null,
      action: 'APPOINTMENT_CANCELLED',
      resourceType: 'appointment',
      resourceId: appointmentId,
      outcome: 'SUCCESS',
      correlationId: input.correlationId,
      metadata: {
        chamberDayId: a.chamberDayId,
        serialId: input.serialId,
        reason: input.reason,
        followedSerial: true,
      },
    });
    await this.events.emit(tx, {
      tenantId,
      name: 'AppointmentCancelled',
      aggregateType: 'appointment',
      aggregateId: appointmentId,
      payload: {
        appointmentId,
        patientId: a.patientId,
        chamberDayId: a.chamberDayId,
        serialId: input.serialId,
        reason: input.reason,
      },
      actorId: input.actor.userId,
      correlationId: input.correlationId,
    });
  }

  /**
   * Marks an appointment NO_SHOW or FULFILLED to follow its serial (queue context, inside its transaction).
   * Silently ignores appointments that are no longer BOOKED.
   */
  async followSerial(
    tx: Tx,
    tenantId: string,
    appointmentId: string,
    command: 'no_show' | 'fulfil',
    actor: QueueActorRef,
  ): Promise<void> {
    const a = await tx.appointment.findFirst({ where: { tenantId, id: appointmentId } });
    if (!a) return;
    const to = appointmentTransition(a.status as AppointmentStatus, command);
    if (!to) return;
    const now = this.clock.now();
    await tx.appointment.update({
      where: { id: appointmentId },
      data: { status: to, updatedAt: now, updatedByUserId: actor.userId, rowVersion: { increment: 1 } },
    });
    if (command === 'no_show') {
      await this.events.emit(tx, {
        tenantId,
        name: 'AppointmentNoShow',
        aggregateType: 'appointment',
        aggregateId: appointmentId,
        payload: { appointmentId, patientId: a.patientId, chamberDayId: a.chamberDayId },
        actorId: actor.userId,
      });
    }
  }

  // ---------------------------------------------------------------- reads

  async get(actor: SchedulingActor, appointmentId: string): Promise<AppointmentView> {
    const a = await this.require(actor.tenant.tenantId, appointmentId);
    assertChamberScope(actor, await this.chambers.require(a.tenantId, a.chamberId));
    return (await this.views(a.tenantId, [a]))[0]!;
  }

  async getForContext(ctx: PatientContextActor, appointmentId: string): Promise<AppointmentView> {
    const a = await this.require(ctx.tenantId, appointmentId);
    if (a.patientId !== ctx.patientId) throw new AppError('FORBIDDEN');
    return (await this.views(ctx.tenantId, [a]))[0]!;
  }

  async list(actor: SchedulingActor, filter: AppointmentListFilter): Promise<AppointmentPage> {
    return this.page(actor.tenant.tenantId, {
      ...filter,
      chamberIds: actor.tenant.chamberIds.length ? [...actor.tenant.chamberIds] : undefined,
    });
  }

  /** `GET /me/appointments` (C-43): the context patient's own appointments, newest first. */
  async listMine(
    ctx: PatientContextActor,
    filter: { cursor?: string; limit?: number },
  ): Promise<AppointmentPage> {
    return this.page(ctx.tenantId, { ...filter, patientId: ctx.patientId });
  }

  private async page(
    tenantId: string,
    f: AppointmentListFilter & { chamberIds?: string[] },
  ): Promise<AppointmentPage> {
    const limit = Math.min(Math.max(f.limit ?? DEFAULT_LIMIT, 1), 100);
    const rows = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(f.chamberDayId ? { chamberDayId: f.chamberDayId } : {}),
        ...(f.patientId ? { patientId: f.patientId } : {}),
        ...(f.status ? { status: f.status } : {}),
        ...(f.chamberIds ? { chamberId: { in: f.chamberIds } } : {}),
        ...(f.cursor ? { id: { lt: f.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    return {
      items: await this.views(tenantId, items),
      nextCursor: rows.length > limit ? items[items.length - 1]!.id : null,
      hasMore: rows.length > limit,
    };
  }
}
