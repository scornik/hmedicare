import { AppError, type Clock, type FieldError, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, isUniqueViolation, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { dhakaDate } from '@hmedic/localization';
import type { ChamberDayFacts, QueueActorRef, SchedulingActor, SerialPort } from '../application/ports';
import {
  type QueuePolicy,
  type QueuePolicyPatch,
  policyProblems,
  resolveQueuePolicy,
} from '../domain/queue-policy';
import { localDateRange, resolveDayWindow, slotsForWindow } from '../domain/schedule';
import { type ChamberService, assertChamberScope } from './chamber-service';
import type { SchedulingEvents } from './events';
import { QueueEventWriter } from './queue-events';
import type { ScheduleService } from './schedule-service';

export type ChamberDayStatus = 'SCHEDULED' | 'OPEN' | 'PAUSED' | 'CLOSED' | 'CANCELLED';

export interface ChamberDayView {
  id: string;
  chamberId: string;
  doctorProfileId: string;
  localDate: string;
  timezone: string;
  localStartTime: string;
  localEndTime: string;
  status: ChamberDayStatus;
  queuePolicy: QueuePolicy;
  nextSerialNumber: number;
  queueOrderVersion: number;
  expectedDelayMinutes: number | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface SlotView {
  id: string;
  startsAt: string;
  endsAt: string;
  localLabel: string;
  capacity: number;
  bookedCount: number;
  status: 'OPEN' | 'FULL' | 'CLOSED';
}

export interface AvailabilityView {
  day: ChamberDayView;
  counts: { nonCancelled: number; booked: number; walkIns: number };
  /** Remaining advance bookings (null = unlimited). */
  remainingBookings: number | null;
  slots: SlotView[];
}

type DayRow = Awaited<ReturnType<PrismaClient['chamberDay']['findFirstOrThrow']>>;

const CLINIC_TZ = 'Asia/Dhaka';
const dateValue = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dateText = (d: Date) => d.toISOString().slice(0, 10);
const timeValue = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const timeText = (d: Date) => d.toISOString().slice(11, 16);
const validation = (fieldErrors: FieldError[]) =>
  new AppError('VALIDATION_FAILED', undefined, { fieldErrors });

export function dayFacts(d: DayRow): ChamberDayFacts {
  return {
    id: d.id,
    tenantId: d.tenantId,
    chamberId: d.chamberId,
    doctorProfileId: d.doctorProfileId,
    localDate: dateText(d.localDate),
    localStartTime: timeText(d.localStartTime),
    localEndTime: timeText(d.localEndTime),
    status: d.status,
    policy: resolveQueuePolicy(d.queuePolicy),
    nextSerialNumber: d.nextSerialNumber,
    queueOrderVersion: d.queueOrderVersion,
    expectedDelayMinutes: d.expectedDelayMinutes,
  };
}

export function dayView(d: DayRow): ChamberDayView {
  return {
    id: d.id,
    chamberId: d.chamberId,
    doctorProfileId: d.doctorProfileId,
    localDate: dateText(d.localDate),
    timezone: d.timezone,
    localStartTime: timeText(d.localStartTime),
    localEndTime: timeText(d.localEndTime),
    status: d.status as ChamberDayStatus,
    queuePolicy: resolveQueuePolicy(d.queuePolicy),
    nextSerialNumber: d.nextSerialNumber,
    queueOrderVersion: d.queueOrderVersion,
    expectedDelayMinutes: d.expectedDelayMinutes,
    closedAt: d.closedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    rowVersion: d.rowVersion,
  };
}

const userActor = (actor: SchedulingActor): QueueActorRef => ({ userId: actor.userId, actorType: 'USER' });

/** Audit-safe detail values (ids, codes, counts). */
type TransitionDetails = Record<string, string | number | boolean | null | string[]>;

/**
 * Chamber days (DATABASE §3.5, QUEUE §3.3, §5.5): one row per chamber per Dhaka local date, materialized
 * from the schedule rules on demand (idempotent under concurrency through `uq_chamber_days_date`) or by
 * staff. Holds the policy snapshot, the allocation counter and the queue order version. Administrative
 * transitions lock the day row (rank 40) and write a queue event, an audit row and an outbox event in the
 * same transaction; close and cancel settle the serials through the queue context's SerialPort.
 */
export class ChamberDayService {
  private readonly queueEvents: QueueEventWriter;
  /** Materialization details captured by `ensure`, consumed by `recordMaterialized` in the same request. */
  private readonly pendingMaterialization = new Map<string, { ruleId: string | null; slots: number }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly events: SchedulingEvents,
    private readonly chambers: ChamberService,
    private readonly schedules: ScheduleService,
    private readonly serials: SerialPort<Tx>,
    private readonly clock: Clock = systemClock,
  ) {
    this.queueEvents = new QueueEventWriter(clock);
  }

  // ---------------------------------------------------------------- reads

  async require(tenantId: string, dayId: string, tx?: Tx): Promise<DayRow> {
    const d = await (tx ?? this.prisma).chamberDay.findFirst({ where: { tenantId, id: dayId } });
    if (!d) throw new AppError('RESOURCE_NOT_FOUND');
    return d;
  }

  async get(actor: SchedulingActor, dayId: string): Promise<ChamberDayView> {
    const d = await this.require(actor.tenant.tenantId, dayId);
    assertChamberScope(actor, await this.chambers.require(d.tenantId, d.chamberId));
    return dayView(d);
  }

  /** Day facts for a patient context (tenant-scoped only). */
  async getPublic(tenantId: string, dayId: string): Promise<ChamberDayView> {
    return dayView(await this.require(tenantId, dayId));
  }

  async list(
    actor: SchedulingActor,
    filter: { chamberId?: string; doctorProfileId?: string; from: string; to: string },
  ): Promise<ChamberDayView[]> {
    const tenantId = actor.tenant.tenantId;
    const days = localDateRange(filter.from, filter.to, 62);
    if (days.length === 0 || filter.to < filter.from)
      throw validation([{ path: 'to', code: 'invalid_range', message: 'validation.invalid_range' }]);
    const rows = await this.prisma.chamberDay.findMany({
      where: {
        tenantId,
        localDate: { gte: dateValue(filter.from), lte: dateValue(days[days.length - 1]!) },
        ...(filter.chamberId ? { chamberId: filter.chamberId } : {}),
        ...(filter.doctorProfileId ? { doctorProfileId: filter.doctorProfileId } : {}),
        ...(actor.tenant.chamberIds.length ? { chamberId: { in: [...actor.tenant.chamberIds] } } : {}),
      },
      orderBy: [{ localDate: 'asc' }, { localStartTime: 'asc' }],
      take: 500,
    });
    return rows.map(dayView);
  }

  async availability(tenantId: string, dayId: string): Promise<AvailabilityView> {
    const d = await this.require(tenantId, dayId);
    const facts = dayFacts(d);
    const counts = await withTransaction(
      this.prisma,
      (tx) => this.serials.countsForDay(tx, tenantId, dayId),
      {
        isolation: 'ReadCommitted',
      },
    );
    const slots = await this.prisma.appointmentSlot.findMany({
      where: { tenantId, chamberDayId: dayId },
      orderBy: { startsAt: 'asc' },
    });
    const ceiling =
      facts.policy.maxBookedSerials ?? (facts.policy.capacity === null ? null : facts.policy.capacity);
    const remaining =
      ceiling === null
        ? null
        : Math.max(
            0,
            Math.min(
              ceiling - counts.booked,
              facts.policy.capacity === null
                ? Number.MAX_SAFE_INTEGER
                : facts.policy.capacity - counts.nonCancelled,
            ),
          );
    return {
      day: dayView(d),
      counts,
      remainingBookings: remaining,
      slots: slots.map((s) => ({
        id: s.id,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        localLabel: s.localLabel,
        capacity: s.capacity,
        bookedCount: s.bookedCount,
        status: s.status as SlotView['status'],
      })),
    };
  }

  // ---------------------------------------------------------------- materialization

  /**
   * Finds or creates the chamber day for a local date inside `tx`. A concurrent creator wins through the
   * unique key and the loser re-reads (Stage 5 prompt §3.2: idempotent under concurrency).
   *
   * Writes no audit or outbox row: those append to hash chains (lock rank 80), and the caller still has to
   * lock the day itself (rank 40). The caller locks the returned row, then calls `recordMaterialized`.
   */
  async ensure(
    tx: Tx,
    tenantId: string,
    chamberId: string,
    localDate: string,
    actorUserId: string | null,
  ): Promise<{ row: DayRow; created: boolean }> {
    const existing = await tx.chamberDay.findFirst({
      where: { tenantId, chamberId, localDate: dateValue(localDate) },
    });
    if (existing) return { row: existing, created: false };
    const chamber = await this.chambers.require(tenantId, chamberId, tx);
    if (chamber.status !== 'ACTIVE')
      throw validation([
        { path: 'chamberId', code: 'chamber_inactive', message: 'validation.chamber_inactive' },
      ]);
    const window = resolveDayWindow(await this.schedules.rulesFor(tenantId, chamberId, tx), localDate);
    if (!window)
      throw validation([{ path: 'localDate', code: 'no_schedule', message: 'validation.no_schedule' }]);
    const policy = resolveQueuePolicy(chamber.defaultQueuePolicy);
    if (window.capacity !== null) policy.capacity = window.capacity;
    const now = this.clock.now();
    const id = newId();
    try {
      const row = await tx.chamberDay.create({
        data: {
          id,
          tenantId,
          chamberId,
          doctorProfileId: chamber.doctorProfileId,
          localDate: dateValue(localDate),
          timezone: CLINIC_TZ,
          localStartTime: timeValue(window.localStartTime),
          localEndTime: timeValue(window.localEndTime),
          status: 'SCHEDULED',
          queuePolicy: policy as never,
          createdAt: now,
          updatedAt: now,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        },
      });
      const slots = slotsForWindow(window, policy.slotMinutes, policy.slotCapacity);
      if (slots.length) {
        await tx.appointmentSlot.createMany({
          data: slots.map((s) => ({
            id: newId(),
            tenantId,
            chamberDayId: id,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            localLabel: s.localLabel,
            capacity: s.capacity,
            bookedCount: 0,
            status: 'OPEN',
            createdAt: now,
            updatedAt: now,
          })),
        });
      }
      this.pendingMaterialization.set(id, { ruleId: window.ruleId, slots: slots.length });
      return { row, created: true };
    } catch (error) {
      if (!isUniqueViolation(error, 'uq_chamber_days_date')) throw error;
      // Statement-level failure inside the transaction: the row now exists, read it and carry on.
      const row = await tx.chamberDay.findFirstOrThrow({
        where: { tenantId, chamberId, localDate: dateValue(localDate) },
      });
      return { row, created: false };
    }
  }

  /**
   * Audit and outbox rows for a day just created by `ensure`. Called by the caller once it holds the day
   * lock, so the chain checkpoint (rank 80) is still the last lock of the transaction.
   */
  async recordMaterialized(tx: Tx, row: DayRow, actorUserId: string | null): Promise<void> {
    const extra = this.pendingMaterialization.get(row.id) ?? { ruleId: null, slots: 0 };
    this.pendingMaterialization.delete(row.id);
    await this.audit.append(tx, {
      tenantId: row.tenantId,
      actorUserId,
      actorType: actorUserId ? 'USER' : 'SYSTEM',
      action: 'CHAMBER_DAY_MATERIALIZED',
      resourceType: 'chamber_day',
      resourceId: row.id,
      outcome: 'SUCCESS',
      requestId: null,
      correlationId: null,
      metadata: { chamberId: row.chamberId, localDate: dateText(row.localDate), ...extra },
    });
    await this.events.emit(tx, {
      tenantId: row.tenantId,
      name: 'ChamberDayMaterialized',
      aggregateType: 'chamber_day',
      aggregateId: row.id,
      payload: { chamberDayId: row.id, chamberId: row.chamberId, localDate: dateText(row.localDate) },
      actorId: actorUserId,
    });
  }

  /** `POST /chamber-days` (MaterializeChamberDay): idempotent; the existing day is returned as-is. */
  async materialize(
    actor: SchedulingActor,
    input: { chamberId: string; localDate: string },
  ): Promise<{ day: ChamberDayView; created: boolean }> {
    const tenantId = actor.tenant.tenantId;
    assertChamberScope(actor, await this.chambers.require(tenantId, input.chamberId));
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.localDate))
      throw validation([{ path: 'localDate', code: 'invalid_date', message: 'validation.invalid_date' }]);
    const { row, created } = await withTransaction(this.prisma, async (tx) => {
      const ensured = await this.ensure(tx, tenantId, input.chamberId, input.localDate, actor.userId);
      await lockRow(tx, 'chamber_days', ensured.row.id, tenantId);
      if (ensured.created) await this.recordMaterialized(tx, ensured.row, actor.userId);
      return ensured;
    });
    return { day: dayView(row), created };
  }

  // ---------------------------------------------------------------- administrative transitions

  private async transition(
    actor: SchedulingActor,
    dayId: string,
    expectedRowVersion: number,
    allowedFrom: readonly ChamberDayStatus[],
    to: ChamberDayStatus,
    eventType: 'DAY_OPENED' | 'DAY_PAUSED' | 'DAY_CLOSED' | 'DAY_CANCELLED',
    eventName: 'ChamberDayOpened' | 'ChamberDayPaused' | 'ChamberDayClosed' | 'ChamberDayCancelled',
    action: string,
    inTx?: (tx: Tx, day: ChamberDayFacts) => Promise<TransitionDetails>,
  ): Promise<ChamberDayView> {
    const tenantId = actor.tenant.tenantId;
    const before = await this.require(tenantId, dayId);
    assertChamberScope(actor, await this.chambers.require(tenantId, before.chamberId));
    const now = this.clock.now();
    const row = await withTransaction(
      this.prisma,
      async (tx) => {
        await lockRow(tx, 'chamber_days', dayId, tenantId);
        const d = await tx.chamberDay.findFirstOrThrow({ where: { tenantId, id: dayId } });
        if (d.rowVersion !== expectedRowVersion)
          throw new AppError('STALE_VERSION', undefined, {
            details: { currentRowVersion: d.rowVersion, status: d.status },
          });
        if (!allowedFrom.includes(d.status as ChamberDayStatus))
          throw new AppError('INVALID_TRANSITION', undefined, { details: { from: d.status, to } });
        const facts = dayFacts(d);
        const extra = inTx ? await this.withinLock(tx, facts, inTx) : {};
        const updated = await tx.chamberDay.update({
          where: { id: dayId },
          data: {
            status: to,
            ...(to === 'CLOSED' ? { closedAt: now, closedByUserId: actor.userId } : {}),
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.queueEvents.append(tx, {
          tenantId,
          chamberDayId: dayId,
          eventType,
          fromStatus: d.status,
          toStatus: to,
          details: extra,
          actor: userActor(actor),
          idempotencyKey: actor.requestId ? `${actor.requestId}:${eventType}` : null,
        });
        await this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action,
          resourceType: 'chamber_day',
          resourceId: dayId,
          outcome: 'SUCCESS',
          requestId: actor.requestId ?? null,
          correlationId: actor.correlationId ?? null,
          metadata: { from: d.status, to, ...extra },
        });
        await this.events.emit(tx, {
          tenantId,
          name: eventName,
          aggregateType: 'chamber_day',
          aggregateId: dayId,
          payload: { chamberDayId: dayId, chamberId: d.chamberId, localDate: facts.localDate },
          actorId: actor.userId,
          correlationId: actor.correlationId ?? null,
        });
        return updated;
      },
      {
        isolation: 'ReadCommitted',
        timeoutMs: 5_000,
        maxWaitMs: 2_000,
        exhaustedCode: 'QUEUE_BUSY',
        context: 'chamber_day',
      },
    );
    return dayView(row);
  }

  private withinLock(
    tx: Tx,
    day: ChamberDayFacts,
    fn: (tx: Tx, day: ChamberDayFacts) => Promise<TransitionDetails>,
  ) {
    return fn(tx, day);
  }

  open(actor: SchedulingActor, dayId: string, input: { expectedRowVersion: number }) {
    return this.transition(
      actor,
      dayId,
      input.expectedRowVersion,
      ['SCHEDULED', 'PAUSED'],
      'OPEN',
      'DAY_OPENED',
      'ChamberDayOpened',
      'CHAMBER_DAY_OPENED',
    );
  }

  pause(actor: SchedulingActor, dayId: string, input: { expectedRowVersion: number }) {
    return this.transition(
      actor,
      dayId,
      input.expectedRowVersion,
      ['OPEN'],
      'PAUSED',
      'DAY_PAUSED',
      'ChamberDayPaused',
      'CHAMBER_DAY_PAUSED',
    );
  }

  /** CancelChamberDay (C-43, QUEUE §3.3): cancels every non-terminal serial and its appointment (DAY_CANCELLED). */
  cancel(actor: SchedulingActor, dayId: string, input: { expectedRowVersion: number; reason?: string }) {
    return this.transition(
      actor,
      dayId,
      input.expectedRowVersion,
      ['SCHEDULED', 'OPEN', 'PAUSED'],
      'CANCELLED',
      'DAY_CANCELLED',
      'ChamberDayCancelled',
      'CHAMBER_DAY_CANCELLED',
      async (tx, day) => {
        const settled = await this.serials.settleDay(tx, {
          day,
          mode: 'CANCEL',
          actor: userActor(actor),
          correlationId: actor.correlationId ?? actor.requestId ?? newId(),
        });
        await this.settleAppointments(tx, actor, day, settled, 'DAY_CANCELLED');
        return { settled: settled.length, reason: input.reason ?? null };
      },
    );
  }

  /** CloseChamberDay (`chamber_day.close`): refused while a consultation is running; settles the rest. */
  close(actor: SchedulingActor, dayId: string, input: { expectedRowVersion: number }) {
    return this.transition(
      actor,
      dayId,
      input.expectedRowVersion,
      ['OPEN', 'PAUSED'],
      'CLOSED',
      'DAY_CLOSED',
      'ChamberDayClosed',
      'CHAMBER_DAY_CLOSED',
      async (tx, day) => {
        if (await this.serials.hasActiveConsultation(tx, day.tenantId, day.id))
          throw new AppError('CHAMBER_DAY_HAS_ACTIVE_CONSULTATION');
        const settled = await this.serials.settleDay(tx, {
          day,
          mode: 'CLOSE',
          actor: userActor(actor),
          correlationId: actor.correlationId ?? actor.requestId ?? newId(),
        });
        await this.settleAppointments(tx, actor, day, settled, 'DAY_CLOSED');
        return {
          settled: settled.length,
          noShow: settled.filter((s) => s.toStatus === 'NO_SHOW').length,
          cancelled: settled.filter((s) => s.toStatus === 'CANCELLED').length,
        };
      },
    );
  }

  /** Appointment rows follow their serial's disposition (NO_SHOW / CANCELLED) with the day-level reason. */
  private async settleAppointments(
    tx: Tx,
    actor: SchedulingActor,
    day: ChamberDayFacts,
    settled: readonly { appointmentId: string | null; toStatus: 'NO_SHOW' | 'CANCELLED' }[],
    cancelReason: 'DAY_CANCELLED' | 'DAY_CLOSED',
  ): Promise<void> {
    const now = this.clock.now();
    for (const s of settled) {
      if (!s.appointmentId) continue;
      const a = await tx.appointment.findFirst({ where: { tenantId: day.tenantId, id: s.appointmentId } });
      if (!a || a.status !== 'BOOKED') continue;
      await tx.appointment.update({
        where: { id: a.id },
        data: {
          status: s.toStatus,
          cancelReason: s.toStatus === 'CANCELLED' ? cancelReason : null,
          updatedAt: now,
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.events.emit(tx, {
        tenantId: day.tenantId,
        name: s.toStatus === 'CANCELLED' ? 'AppointmentCancelled' : 'AppointmentNoShow',
        aggregateType: 'appointment',
        aggregateId: a.id,
        payload: { appointmentId: a.id, chamberDayId: day.id, patientId: a.patientId, reason: cancelReason },
        actorId: actor.userId,
        correlationId: actor.correlationId ?? null,
      });
    }
  }

  /** RecordChamberDelay (QUEUE §5.5): `expectedQueueOrderVersion`; bumps the order version, never timestamps. */
  async recordDelay(
    actor: SchedulingActor,
    dayId: string,
    input: { expectedQueueOrderVersion: number; delayMinutes: number; reasonCode: string },
  ): Promise<ChamberDayView> {
    if (!Number.isInteger(input.delayMinutes) || input.delayMinutes < 0 || input.delayMinutes > 720)
      throw validation([{ path: 'delayMinutes', code: 'out_of_range', message: 'validation.out_of_range' }]);
    return this.orderVersionChange(
      actor,
      dayId,
      input.expectedQueueOrderVersion,
      'DELAY_RECORDED',
      'ChamberDelayRecorded',
      'CHAMBER_DELAY_RECORDED',
      { delayMinutes: input.delayMinutes, reasonCode: input.reasonCode },
      { expectedDelayMinutes: input.delayMinutes },
    );
  }

  /** UpdateChamberDayPolicy (`PUT /chamber-days/{id}/queue-policy`): POLICY_CHANGED, both versions bump. */
  async updatePolicy(
    actor: SchedulingActor,
    dayId: string,
    input: { expectedQueueOrderVersion: number; policy: QueuePolicyPatch },
  ): Promise<ChamberDayView> {
    const current = await this.require(actor.tenant.tenantId, dayId);
    const merged = resolveQueuePolicy({ ...resolveQueuePolicy(current.queuePolicy), ...input.policy });
    const problems = policyProblems(merged);
    if (problems.length)
      throw validation(
        problems.map((p) => ({
          path: `policy.${p.path}`,
          code: p.code,
          message: `validation.policy.${p.code}`,
        })),
      );
    return this.orderVersionChange(
      actor,
      dayId,
      input.expectedQueueOrderVersion,
      'POLICY_CHANGED',
      'ChamberDayPolicyChanged',
      'CHAMBER_DAY_POLICY_CHANGED',
      { changed: Object.keys(input.policy) },
      { queuePolicy: merged as never, rowVersion: { increment: 1 } },
    );
  }

  private async orderVersionChange(
    actor: SchedulingActor,
    dayId: string,
    expectedQueueOrderVersion: number,
    eventType: 'DELAY_RECORDED' | 'POLICY_CHANGED',
    eventName: 'ChamberDelayRecorded' | 'ChamberDayPolicyChanged',
    action: string,
    details: TransitionDetails,
    data: Record<string, unknown>,
  ): Promise<ChamberDayView> {
    const tenantId = actor.tenant.tenantId;
    const before = await this.require(tenantId, dayId);
    assertChamberScope(actor, await this.chambers.require(tenantId, before.chamberId));
    const now = this.clock.now();
    const row = await withTransaction(
      this.prisma,
      async (tx) => {
        await lockRow(tx, 'chamber_days', dayId, tenantId);
        const d = await tx.chamberDay.findFirstOrThrow({ where: { tenantId, id: dayId } });
        if (d.queueOrderVersion !== expectedQueueOrderVersion)
          throw new AppError('QUEUE_VERSION_CONFLICT', undefined, {
            details: { currentQueueOrderVersion: d.queueOrderVersion },
          });
        if (d.status === 'CLOSED' || d.status === 'CANCELLED')
          throw new AppError('INVALID_TRANSITION', undefined, { details: { from: d.status } });
        const updated = await tx.chamberDay.update({
          where: { id: dayId },
          data: {
            ...data,
            queueOrderVersion: { increment: 1 },
            updatedAt: now,
            updatedByUserId: actor.userId,
          },
        });
        await this.queueEvents.append(tx, {
          tenantId,
          chamberDayId: dayId,
          eventType,
          details,
          actor: userActor(actor),
          idempotencyKey: actor.requestId ? `${actor.requestId}:${eventType}` : null,
        });
        await this.audit.append(tx, {
          tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action,
          resourceType: 'chamber_day',
          resourceId: dayId,
          outcome: 'SUCCESS',
          requestId: actor.requestId ?? null,
          correlationId: actor.correlationId ?? null,
          metadata: details,
        });
        await this.events.emit(tx, {
          tenantId,
          name: eventName,
          aggregateType: 'chamber_day',
          aggregateId: dayId,
          payload: {
            chamberDayId: dayId,
            chamberId: d.chamberId,
            queueOrderVersion: updated.queueOrderVersion,
            ...(eventType === 'DELAY_RECORDED' ? { delayMinutes: Number(details.delayMinutes) } : {}),
          },
          actorId: actor.userId,
          correlationId: actor.correlationId ?? null,
        });
        return updated;
      },
      {
        isolation: 'ReadCommitted',
        timeoutMs: 5_000,
        maxWaitMs: 2_000,
        exhaustedCode: 'QUEUE_BUSY',
        context: 'chamber_day',
      },
    );
    return dayView(row);
  }

  /** Today's local date in the clinic time zone (for list defaults and jobs). */
  today(): string {
    return dhakaDate(this.clock.now());
  }
}
