import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Database, type Tx } from '@hmedic/database';
import { newId } from '@hmedic/kernel';
import type { ChamberDayFacts, IssueSerialForAppointmentInput, SettledSerial } from '../../src/public/index';
import { DEFAULT_QUEUE_POLICY } from '../../src/public/index';
import {
  type SchedulingHarness,
  type TenantFixture,
  schedulingServices,
  seedPatient,
  seedTenant,
  weeklyEveningRules,
} from '../../../../tests/support/scheduling';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

/**
 * Chamber, schedule and appointment services on MariaDB 10.6/11.4 (API §3.5, QUEUE §2/§3.3/§5.5, audit
 * C-43…C-45). The queue context is stubbed here so scheduling is exercised on its own; the real serial
 * engine is covered by the queue suite. Synthetic names and reserved-range phones only.
 */
let db: Database;
let h: SchedulingHarness;
let t: TenantFixture;

/** Minimal in-memory SerialPort: records calls, counts issued serials, never touches the database. */
class StubSerials {
  issued: IssueSerialForAppointmentInput[] = [];
  cancelled: string[] = [];
  settled: Array<{ dayId: string; mode: 'CLOSE' | 'CANCEL' }> = [];
  activeConsultation = false;
  counts = { nonCancelled: 0, booked: 0, walkIns: 0 };
  settleResult: SettledSerial[] = [];

  issueForAppointment(_tx: Tx, input: IssueSerialForAppointmentInput) {
    this.issued.push(input);
    this.counts = {
      ...this.counts,
      nonCancelled: this.counts.nonCancelled + 1,
      booked: this.counts.booked + 1,
    };
    return Promise.resolve({ serialId: newId(), serialNumber: this.issued.length });
  }
  cancelForAppointment(_tx: Tx, input: { appointmentId: string }) {
    this.cancelled.push(input.appointmentId);
    this.counts = { ...this.counts, nonCancelled: Math.max(0, this.counts.nonCancelled - 1) };
    return Promise.resolve(newId());
  }
  countsForDay() {
    return Promise.resolve(this.counts);
  }
  hasActiveConsultation() {
    return Promise.resolve(this.activeConsultation);
  }
  settleDay(_tx: Tx, input: { day: ChamberDayFacts; mode: 'CLOSE' | 'CANCEL' }) {
    this.settled.push({ dayId: input.day.id, mode: input.mode });
    return Promise.resolve(this.settleResult);
  }
}

let stub: StubSerials;

beforeAll(() => {
  db = openTestDatabase({ poolMax: 6 });
  h = schedulingServices(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
  stub = new StubSerials();
  h.serials.bind(stub as never);
  t = await seedTenant(db, 'sched');
});

const chamber = (over: Record<string, unknown> = {}) =>
  h.chambers.create(t.actor, {
    clinicId: t.clinicId,
    doctorProfileId: t.doctorProfileId,
    name: 'DEMO Evening Chamber',
    supportsPhysical: true,
    supportsRemote: false,
    supportsHybrid: false,
    ...over,
  });

describe('chambers (API §3.5)', () => {
  it('creates with the documented policy defaults, validates and updates with optimistic concurrency', async () => {
    const c = await chamber();
    expect(c.defaultQueuePolicy).toEqual(DEFAULT_QUEUE_POLICY);
    expect(c.chamberPaymentMode).toBe('PAY_AT_CHAMBER');
    expect(c.doctorDisplayName).toBe('Dr. sched');

    await expect(chamber({ supportsPhysical: false })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(chamber({ clinicId: newId() })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      chamber({ defaultQueuePolicy: { advanceBookingEnabled: false, walkInsEnabled: false } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const updated = await h.chambers.update(t.actor, c.id, {
      expectedRowVersion: c.rowVersion,
      defaultQueuePolicy: { walkInsEnabled: false, maxBookedSerials: 20 },
    });
    expect(updated.defaultQueuePolicy.walkInsEnabled).toBe(false);
    expect(updated.defaultQueuePolicy.maxBookedSerials).toBe(20);
    expect(updated.defaultQueuePolicy.recallLimit).toBe(2); // untouched defaults survive
    expect(updated.rowVersion).toBe(c.rowVersion + 1);
    await expect(
      h.chambers.update(t.actor, c.id, { expectedRowVersion: c.rowVersion, name: 'x' }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });

    const audits = await db.prisma.auditLog.findMany({
      where: { tenantId: t.tenantId, resourceType: 'chamber' },
    });
    expect(audits.map((a) => a.action).sort()).toEqual(['CHAMBER_CREATED', 'CHAMBER_UPDATED']);
    const events = await db.prisma.outboxEvent.findMany({
      where: { tenantId: t.tenantId, aggregateType: 'chamber' },
    });
    expect(events.map((e) => e.eventName).sort()).toEqual(['ChamberCreated', 'ChamberUpdated']);
  });

  it('never leaks another tenant and honours the membership chamber scope', async () => {
    const other = await seedTenant(db, 'other');
    const c = await chamber();
    await expect(h.chambers.get(other.actor, c.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    // Same tenant, but the membership is scoped to a different chamber.
    const scoped = {
      ...t.actor,
      tenant: { ...t.actor.tenant, chamberIds: [newId()] },
    };
    await expect(h.chambers.get(scoped, c.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await h.chambers.list(scoped, {})).toEqual([]);
    expect((await h.chambers.list(t.actor, {})).map((x) => x.id)).toEqual([c.id]);
  });
});

describe('schedule rules (DATABASE §3.5)', () => {
  it('refuses overlapping weekly rules, keeps exceptions unique and ends rules without deleting them', async () => {
    const c = await chamber();
    const weekly = await h.schedules.create(t.actor, c.id, {
      ruleType: 'WEEKLY',
      weekday: 6,
      localStartTime: '17:00',
      localEndTime: '21:00',
      effectiveFrom: '2026-01-01',
    });
    await expect(
      h.schedules.create(t.actor, c.id, {
        ruleType: 'WEEKLY',
        weekday: 6,
        localStartTime: '20:00',
        localEndTime: '22:00',
        effectiveFrom: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // A non-overlapping window on the same weekday is fine.
    await h.schedules.create(t.actor, c.id, {
      ruleType: 'WEEKLY',
      weekday: 6,
      localStartTime: '09:00',
      localEndTime: '12:00',
      effectiveFrom: '2026-01-01',
    });
    await expect(
      h.schedules.create(t.actor, c.id, {
        ruleType: 'WEEKLY',
        localStartTime: '09:00',
        localEndTime: '12:00',
        effectiveFrom: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      h.schedules.create(t.actor, c.id, {
        ruleType: 'EXCEPTION_CLOSED',
        exceptionDate: '2026-03-26',
        localStartTime: '17:00',
        localEndTime: '16:00',
        effectiveFrom: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const holiday = await h.schedules.create(t.actor, c.id, {
      ruleType: 'EXCEPTION_CLOSED',
      exceptionDate: '2026-03-26',
      localStartTime: '17:00',
      localEndTime: '21:00',
      effectiveFrom: '2026-01-01',
    });
    expect(holiday.exceptionDate).toBe('2026-03-26');
    await expect(
      h.schedules.create(t.actor, c.id, {
        ruleType: 'EXCEPTION_CLOSED',
        exceptionDate: '2026-03-26',
        localStartTime: '17:00',
        localEndTime: '21:00',
        effectiveFrom: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const ended = await h.schedules.end(t.actor, weekly.id, {
      expectedRowVersion: weekly.rowVersion,
      effectiveTo: '2026-06-30',
    });
    expect(ended.effectiveTo).toBe('2026-06-30');
    expect(await db.prisma.doctorScheduleRule.count({ where: { tenantId: t.tenantId } })).toBe(3);
    await expect(
      h.schedules.end(t.actor, weekly.id, {
        expectedRowVersion: weekly.rowVersion,
        effectiveTo: '2026-07-31',
      }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });
});

describe('chamber day materialization (QUEUE §5.6)', () => {
  it('is idempotent, snapshots the policy, generates slots and refuses days without a schedule', async () => {
    const c = await chamber({ defaultQueuePolicy: { slotMinutes: 60, slotCapacity: 2, capacity: 8 } });
    await weeklyEveningRules(h.schedules, t.actor, c.id);
    await h.schedules.create(t.actor, c.id, {
      ruleType: 'EXCEPTION_CLOSED',
      exceptionDate: '2026-03-26',
      localStartTime: '17:00',
      localEndTime: '21:00',
      effectiveFrom: '2020-01-01',
    });

    const first = await h.days.materialize(t.actor, { chamberId: c.id, localDate: '2026-09-19' });
    expect(first.created).toBe(true);
    expect(first.day).toMatchObject({
      localDate: '2026-09-19',
      timezone: 'Asia/Dhaka',
      localStartTime: '17:00',
      localEndTime: '21:00',
      status: 'SCHEDULED',
      nextSerialNumber: 1,
      queueOrderVersion: 1,
    });
    expect(first.day.queuePolicy.slotMinutes).toBe(60);
    const slots = await db.prisma.appointmentSlot.findMany({
      where: { chamberDayId: first.day.id },
      orderBy: { startsAt: 'asc' },
    });
    expect(slots.map((s) => s.localLabel)).toEqual([
      '17:00–18:00',
      '18:00–19:00',
      '19:00–20:00',
      '20:00–21:00',
    ]);
    expect(slots[0]!.startsAt.toISOString()).toBe('2026-09-19T11:00:00.000Z'); // 17:00 Dhaka = 11:00 UTC

    const again = await h.days.materialize(t.actor, { chamberId: c.id, localDate: '2026-09-19' });
    expect(again.created).toBe(false);
    expect(again.day.id).toBe(first.day.id);
    expect(await db.prisma.appointmentSlot.count({ where: { chamberDayId: first.day.id } })).toBe(4);

    await expect(
      h.days.materialize(t.actor, { chamberId: c.id, localDate: '2026-03-26' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('materializes exactly once when several requests race', async () => {
    const c = await chamber();
    await weeklyEveningRules(h.schedules, t.actor, c.id);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        h.days.materialize(t.actor, { chamberId: c.id, localDate: '2026-09-21' }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBe(6);
    const ids = new Set(ok.map((r) => (r as PromiseFulfilledResult<{ day: { id: string } }>).value.day.id));
    expect(ids.size).toBe(1);
    expect(await db.prisma.chamberDay.count({ where: { tenantId: t.tenantId } })).toBe(1);
    expect(
      await db.prisma.auditLog.count({ where: { tenantId: t.tenantId, action: 'CHAMBER_DAY_MATERIALIZED' } }),
    ).toBe(1);
  });
});

describe('chamber day transitions (QUEUE §3.3, §5.5)', () => {
  async function openDay(over: Record<string, unknown> = {}) {
    const c = await chamber(over);
    await weeklyEveningRules(h.schedules, t.actor, c.id);
    const { day } = await h.days.materialize(t.actor, { chamberId: c.id, localDate: '2026-09-19' });
    const opened = await h.days.open(t.actor, day.id, { expectedRowVersion: day.rowVersion });
    return { chamberId: c.id, day: opened };
  }

  it('open → pause → close writes one queue event per step with an intact hash chain', async () => {
    const { day } = await openDay();
    const paused = await h.days.pause(t.actor, day.id, { expectedRowVersion: day.rowVersion });
    const closed = await h.days.close(t.actor, day.id, { expectedRowVersion: paused.rowVersion });
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).not.toBeNull();
    expect(stub.settled).toEqual([{ dayId: day.id, mode: 'CLOSE' }]);

    const events = await db.prisma.queueEvent.findMany({
      where: { chamberDayId: day.id },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((e) => e.eventType)).toEqual(['DAY_OPENED', 'DAY_PAUSED', 'DAY_CLOSED']);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events[0]!.prevRowHash).toBeNull();
    expect(events[1]!.prevRowHash).toBe(events[0]!.rowHash);
    expect(events[2]!.prevRowHash).toBe(events[1]!.rowHash);
    const checkpoint = await db.prisma.integrityChainCheckpoint.findFirst({
      where: { chainKey: `queue:chamber_day:${day.id}` },
    });
    expect(checkpoint).toMatchObject({ lastSeq: 3n, lastRowHash: events[2]!.rowHash });
  });

  it('rejects illegal transitions, stale versions and closing with a live consultation', async () => {
    const { day } = await openDay();
    await expect(h.days.open(t.actor, day.id, { expectedRowVersion: day.rowVersion })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    await expect(h.days.pause(t.actor, day.id, { expectedRowVersion: 99 })).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    stub.activeConsultation = true;
    await expect(h.days.close(t.actor, day.id, { expectedRowVersion: day.rowVersion })).rejects.toMatchObject(
      {
        code: 'CHAMBER_DAY_HAS_ACTIVE_CONSULTATION',
      },
    );
    // The refused close rolled back: no DAY_CLOSED event, day still OPEN.
    const events = await db.prisma.queueEvent.findMany({ where: { chamberDayId: day.id } });
    expect(events.map((e) => e.eventType)).toEqual(['DAY_OPENED']);
    expect((await h.days.get(t.actor, day.id)).status).toBe('OPEN');
  });

  it('cancel settles the serials and records DAY_CANCELLED', async () => {
    const { day } = await openDay();
    const cancelled = await h.days.cancel(t.actor, day.id, {
      expectedRowVersion: day.rowVersion,
      reason: 'doctor ill',
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(stub.settled).toEqual([{ dayId: day.id, mode: 'CANCEL' }]);
    const event = await db.prisma.queueEvent.findFirstOrThrow({
      where: { chamberDayId: day.id, eventType: 'DAY_CANCELLED' },
    });
    expect(event.toStatus).toBe('CANCELLED');
  });

  it('delay and policy changes use expectedQueueOrderVersion and bump it', async () => {
    const { day } = await openDay();
    const delayed = await h.days.recordDelay(t.actor, day.id, {
      expectedQueueOrderVersion: day.queueOrderVersion,
      delayMinutes: 25,
      reasonCode: 'DOCTOR_LATE',
    });
    expect(delayed.expectedDelayMinutes).toBe(25);
    expect(delayed.queueOrderVersion).toBe(day.queueOrderVersion + 1);
    await expect(
      h.days.recordDelay(t.actor, day.id, {
        expectedQueueOrderVersion: day.queueOrderVersion,
        delayMinutes: 5,
        reasonCode: 'OVERRUN',
      }),
    ).rejects.toMatchObject({ code: 'QUEUE_VERSION_CONFLICT' });

    const policed = await h.days.updatePolicy(t.actor, day.id, {
      expectedQueueOrderVersion: delayed.queueOrderVersion,
      policy: { recallLimit: 4 },
    });
    expect(policed.queuePolicy.recallLimit).toBe(4);
    expect(policed.queuePolicy.noShowAfterMinutes).toBe(DEFAULT_QUEUE_POLICY.noShowAfterMinutes);
    expect(policed.queueOrderVersion).toBe(delayed.queueOrderVersion + 1);
    await expect(
      h.days.updatePolicy(t.actor, day.id, {
        expectedQueueOrderVersion: policed.queueOrderVersion,
        policy: { advanceBookingEnabled: false, walkInsEnabled: false },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const types = (
      await db.prisma.queueEvent.findMany({ where: { chamberDayId: day.id }, orderBy: { seq: 'asc' } })
    ).map((e) => e.eventType);
    expect(types).toEqual(['DAY_OPENED', 'DELAY_RECORDED', 'POLICY_CHANGED']);
  });
});

describe('booking policy (C-44, C-45)', () => {
  async function bookable(policy: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
    const c = await chamber({ defaultQueuePolicy: policy, ...over });
    await weeklyEveningRules(h.schedules, t.actor, c.id);
    const patientId = await seedPatient(h.patients, t.patientActor, 'Nusrat Jahan');
    return { chamberId: c.id, patientId };
  }
  const future = () => {
    const d = new Date(Date.now() + 3 * 86_400_000);
    return d.toISOString().slice(0, 10);
  };

  it('books, issues the serial through the queue port and audits the actor', async () => {
    const { chamberId, patientId } = await bookable();
    const a = await h.appointments.create(
      { kind: 'staff', actor: t.actor },
      { chamberId, localDate: future(), patientId, careMode: 'PHYSICAL', reason: 'fever' },
      { idempotencyKey: 'book-1' },
    );
    expect(a).toMatchObject({ status: 'BOOKED', source: 'ADVANCE_BOOKING', bookedOnBehalf: 'STAFF' });
    expect(a.paymentRequirement).toBe('NONE');
    expect(a.paymentStatus).toBe('NOT_REQUIRED');
    expect(stub.issued).toHaveLength(1);
    expect(stub.issued[0]).toMatchObject({ patientId, source: 'ADVANCE_BOOKING' });

    const audit = await db.prisma.auditLog.findFirstOrThrow({
      where: { tenantId: t.tenantId, action: 'APPOINTMENT_BOOKED' },
    });
    expect(audit.actorUserId).toBe(t.userId);
    expect(JSON.stringify(audit.metadata)).not.toContain('Nusrat');
    const event = await db.prisma.outboxEvent.findFirstOrThrow({ where: { eventName: 'AppointmentBooked' } });
    expect(JSON.stringify(event.payload)).not.toContain('Nusrat');
  });

  it('refuses a walk-in-only chamber, a past date, beyond the window and over capacity', async () => {
    const walkInOnly = await bookable({ advanceBookingEnabled: false });
    await expect(
      h.appointments.create(
        { kind: 'staff', actor: t.actor },
        {
          chamberId: walkInOnly.chamberId,
          localDate: future(),
          patientId: walkInOnly.patientId,
          careMode: 'PHYSICAL',
        },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const normal = await bookable({ maxBookedSerials: 1 });
    const day = future();
    await h.appointments.create(
      { kind: 'staff', actor: t.actor },
      { chamberId: normal.chamberId, localDate: day, patientId: normal.patientId, careMode: 'PHYSICAL' },
    );
    const second = await seedPatient(h.patients, t.patientActor, 'Sadia Akter');
    await expect(
      h.appointments.create(
        { kind: 'staff', actor: t.actor },
        { chamberId: normal.chamberId, localDate: day, patientId: second, careMode: 'PHYSICAL' },
      ),
    ).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });

    await expect(
      h.appointments.create(
        { kind: 'staff', actor: t.actor },
        { chamberId: normal.chamberId, localDate: '2020-01-01', patientId: second, careMode: 'PHYSICAL' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('a prepaid chamber is FEATURE_DISABLED while payments are absent; optional online is informational', async () => {
    const prepaid = await bookable({}, { chamberPaymentMode: 'PREPAID_REQUIRED' });
    await expect(
      h.appointments.create(
        { kind: 'staff', actor: t.actor },
        {
          chamberId: prepaid.chamberId,
          localDate: future(),
          patientId: prepaid.patientId,
          careMode: 'PHYSICAL',
        },
      ),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED', details: { reason: 'PAYMENTS_NOT_AVAILABLE' } });
    expect(await db.prisma.appointment.count({ where: { tenantId: t.tenantId } })).toBe(0);

    const optional = await bookable({}, { chamberPaymentMode: 'OPTIONAL_ONLINE' });
    const a = await h.appointments.create(
      { kind: 'staff', actor: t.actor },
      {
        chamberId: optional.chamberId,
        localDate: future(),
        patientId: optional.patientId,
        careMode: 'PHYSICAL',
      },
    );
    expect(a).toMatchObject({ paymentRequirement: 'OPTIONAL', paymentStatus: 'PENDING', status: 'BOOKED' });
  });

  it('refuses an unsupported care mode and an unknown patient', async () => {
    const { chamberId, patientId } = await bookable();
    await expect(
      h.appointments.create(
        { kind: 'staff', actor: t.actor },
        { chamberId, localDate: future(), patientId, careMode: 'REMOTE' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      h.appointments.create(
        { kind: 'staff', actor: t.actor },
        { chamberId, localDate: future(), patientId: newId(), careMode: 'PHYSICAL' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('books into a slot, refuses a full slot and releases the seat on cancel', async () => {
    const { chamberId, patientId } = await bookable({ slotMinutes: 120, slotCapacity: 1 });
    const day = future();
    const { day: materialized } = await h.days.materialize(t.actor, { chamberId, localDate: day });
    const slots = await db.prisma.appointmentSlot.findMany({
      where: { chamberDayId: materialized.id },
      orderBy: { startsAt: 'asc' },
    });
    expect(slots).toHaveLength(2);
    await expect(
      h.appointments.create(
        { kind: 'staff', actor: t.actor },
        { chamberId, localDate: day, patientId, careMode: 'PHYSICAL' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const a = await h.appointments.create(
      { kind: 'staff', actor: t.actor },
      { chamberId, localDate: day, patientId, careMode: 'PHYSICAL', slotId: slots[0]!.id },
    );
    expect(a.slotLabel).toBe(slots[0]!.localLabel);
    expect((await db.prisma.appointmentSlot.findFirstOrThrow({ where: { id: slots[0]!.id } })).status).toBe(
      'FULL',
    );

    const other = await seedPatient(h.patients, t.patientActor, 'Mitu Begum');
    await expect(
      h.appointments.create(
        { kind: 'staff', actor: t.actor },
        { chamberId, localDate: day, patientId: other, careMode: 'PHYSICAL', slotId: slots[0]!.id },
      ),
    ).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });

    const cancelled = await h.appointments.cancel({ kind: 'staff', actor: t.actor }, a.id, {
      expectedRowVersion: a.rowVersion,
      reason: 'PATIENT_REQUEST',
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(stub.cancelled).toEqual([a.id]);
    const slot = await db.prisma.appointmentSlot.findFirstOrThrow({ where: { id: slots[0]!.id } });
    expect({ booked: slot.bookedCount, status: slot.status }).toEqual({ booked: 0, status: 'OPEN' });
  });

  it('lists by day and paginates', async () => {
    const { chamberId, patientId } = await bookable();
    const day = future();
    const first = await h.appointments.create(
      { kind: 'staff', actor: t.actor },
      { chamberId, localDate: day, patientId, careMode: 'PHYSICAL' },
    );
    const p2 = await seedPatient(h.patients, t.patientActor, 'Lamia Chowdhury');
    await h.appointments.create(
      { kind: 'staff', actor: t.actor },
      { chamberId, localDate: day, patientId: p2, careMode: 'PHYSICAL' },
    );
    const page = await h.appointments.list(t.actor, { chamberDayId: first.chamberDayId, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    const rest = await h.appointments.list(t.actor, {
      chamberDayId: first.chamberDayId,
      cursor: page.nextCursor!,
    });
    expect(rest.items).toHaveLength(1);
    expect(rest.hasMore).toBe(false);
    expect(await h.appointments.list(t.actor, { patientId, status: 'BOOKED' })).toMatchObject({
      hasMore: false,
    });
  });
});
