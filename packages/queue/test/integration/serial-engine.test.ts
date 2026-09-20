import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@hmedic/database';
import { newId, systemClock } from '@hmedic/kernel';
import { OutboxPort } from '@hmedic/jobs';
import { dhakaDate } from '@hmedic/localization';
import { type AppointmentView, type ChamberView, localInstant } from '@hmedic/scheduling';
import {
  type SchedulingHarness,
  type TenantFixture,
  schedulingServices,
  seedPatient,
  seedTenant,
  weeklyEveningRules,
} from '../../../../tests/support/scheduling';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { QueueOutbox, SERIAL_TRANSITIONS, SerialService, serialTransition } from '../../src/public/index';

/**
 * Serial engine against the real scheduling context (QUEUE §3 transition table, §5.2 allocation, §5.4
 * single-serial transitions, §3.3 day close). Concurrency races live in the dedicated concurrency suite.
 */
let db: Database;
let h: SchedulingHarness;
let serials: SerialService;
let t: TenantFixture;

function wire(clockNow?: () => Date) {
  const clock = clockNow ? { now: clockNow } : systemClock;
  const s = new SerialService(
    db.prisma,
    h.audit,
    new QueueOutbox(new OutboxPort(clock), clock),
    h.appointments,
    clock,
  );
  h.serials.bind(s as never);
  return s;
}

beforeAll(() => {
  db = openTestDatabase({ poolMax: 8 });
  h = schedulingServices(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
  serials = wire();
  t = await seedTenant(db, 'queue');
});

const today = () => dhakaDate(systemClock.now());

async function openChamberDay(
  policy: Record<string, unknown> = {},
): Promise<{ chamber: ChamberView; dayId: string }> {
  const chamber = await h.chambers.create(t.actor, {
    clinicId: t.clinicId,
    doctorProfileId: t.doctorProfileId,
    name: 'DEMO Queue Chamber',
    supportsPhysical: true,
    supportsRemote: false,
    supportsHybrid: false,
    defaultQueuePolicy: policy,
  });
  await weeklyEveningRules(h.schedules, t.actor, chamber.id);
  const { day } = await h.days.materialize(t.actor, { chamberId: chamber.id, localDate: today() });
  const opened = await h.days.open(t.actor, day.id, { expectedRowVersion: day.rowVersion });
  return { chamber, dayId: opened.id };
}

async function book(chamberId: string, name: string, localDate = today()): Promise<AppointmentView> {
  const patientId = await seedPatient(h.patients, t.patientActor, name);
  return h.appointments.create(
    { kind: 'staff', actor: t.actor },
    { chamberId, localDate, patientId, careMode: 'PHYSICAL' },
    { idempotencyKey: newId() },
  );
}

describe('serial allocation (QUEUE §5.2)', () => {
  it('numbers serials sequentially per day, advances the counter and emits SERIAL_ISSUED', async () => {
    const { chamber, dayId } = await openChamberDay();
    const a1 = await book(chamber.id, 'Rahim Uddin');
    const a2 = await book(chamber.id, 'Karim Islam');
    expect(a1.serial).toMatchObject({ serialNumber: 1, status: 'BOOKED' });
    expect(a2.serial).toMatchObject({ serialNumber: 2, status: 'BOOKED' });

    const day = await h.days.get(t.actor, dayId);
    expect(day.nextSerialNumber).toBe(3);
    expect(day.queueOrderVersion).toBe(1); // issuance never bumps the order version

    const events = await db.prisma.queueEvent.findMany({
      where: { chamberDayId: dayId },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((e) => e.eventType)).toEqual(['DAY_OPENED', 'SERIAL_ISSUED', 'SERIAL_ISSUED']);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events[2]!.prevRowHash).toBe(events[1]!.rowHash);
    expect(JSON.stringify(events)).not.toContain('Rahim');

    const outbox = await db.prisma.outboxEvent.findMany({ where: { eventName: 'SerialIssued' } });
    expect(outbox).toHaveLength(2);
    expect(JSON.stringify(outbox)).not.toContain('Rahim');
  });

  it('refuses a second active serial for the same patient and day', async () => {
    const { chamber } = await openChamberDay();
    const a = await book(chamber.id, 'Nusrat Jahan');
    await expect(
      h.appointments.create(
        { kind: 'staff', actor: t.actor },
        { chamberId: chamber.id, localDate: today(), patientId: a.patientId, careMode: 'PHYSICAL' },
        { idempotencyKey: newId() },
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ACTIVE_SERIAL' });
    expect(await db.prisma.serial.count({ where: { tenantId: t.tenantId } })).toBe(1);
    // The rolled-back attempt left no appointment and no event behind.
    expect(await db.prisma.appointment.count({ where: { tenantId: t.tenantId } })).toBe(1);
    expect(await db.prisma.queueEvent.count({ where: { eventType: 'SERIAL_ISSUED' } })).toBe(1);

    // Cancelling frees the key: the patient can be booked again on the same day.
    await h.appointments.cancel({ kind: 'staff', actor: t.actor }, a.id, {
      expectedRowVersion: a.rowVersion,
      reason: 'PATIENT_REQUEST',
    });
    const again = await h.appointments.create(
      { kind: 'staff', actor: t.actor },
      { chamberId: chamber.id, localDate: today(), patientId: a.patientId, careMode: 'PHYSICAL' },
      { idempotencyKey: newId() },
    );
    expect(again.serial?.serialNumber).toBe(2);
  });
});

describe('single-serial transitions (QUEUE §5.4)', () => {
  it('confirms, rejects a stale version and an illegal edge, and audits every step', async () => {
    const { chamber, dayId } = await openChamberDay();
    const a = await book(chamber.id, 'Sadia Akter');
    const serialId = a.serial!.id;
    const before = await serials.get({ kind: 'staff', actor: t.actor }, serialId);

    const confirmed = await serials.confirm({ kind: 'staff', actor: t.actor }, serialId, {
      expectedRowVersion: before.rowVersion,
    });
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.confirmedAt).not.toBeNull();
    expect(confirmed.rowVersion).toBe(before.rowVersion + 1);

    await expect(
      serials.confirm({ kind: 'staff', actor: t.actor }, serialId, { expectedRowVersion: before.rowVersion }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    await expect(
      serials.confirm({ kind: 'staff', actor: t.actor }, serialId, {
        expectedRowVersion: confirmed.rowVersion,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    const cancelled = await serials.cancel({ kind: 'staff', actor: t.actor }, serialId, {
      expectedRowVersion: confirmed.rowVersion,
      reason: 'PATIENT_REQUEST',
    });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'PATIENT_REQUEST' });

    const types = (
      await db.prisma.queueEvent.findMany({ where: { chamberDayId: dayId }, orderBy: { seq: 'asc' } })
    ).map((e) => e.eventType);
    expect(types).toEqual(['DAY_OPENED', 'SERIAL_ISSUED', 'CONFIRMED', 'CANCELLED']);
    const actions = (
      await db.prisma.auditLog.findMany({
        where: { tenantId: t.tenantId, resourceType: 'serial' },
        orderBy: { seq: 'asc' },
      })
    ).map((x) => x.action);
    expect(actions).toEqual(['SERIAL_ISSUED', 'SERIAL_CONFIRMED', 'SERIAL_CANCELLED']);
  });

  it('a manual no-show is refused before the day starts and marks the appointment afterwards', async () => {
    const { chamber, dayId } = await openChamberDay();
    const a = await book(chamber.id, 'Tanvir Hossain');
    const day = await h.days.get(t.actor, dayId);
    const serialId = a.serial!.id;
    const current = await serials.get({ kind: 'staff', actor: t.actor }, serialId);

    const beforeStart = new Date(localInstant(day.localDate, day.localStartTime).getTime() - 60_000);
    const early = wire(() => beforeStart);
    await expect(
      early.markNoShow({ kind: 'staff', actor: t.actor }, serialId, {
        expectedRowVersion: current.rowVersion,
      }),
    ).rejects.toMatchObject({ code: 'QUEUE_STATE_CONFLICT' });

    const afterStart = new Date(localInstant(day.localDate, day.localStartTime).getTime() + 60_000);
    const late = wire(() => afterStart);
    const marked = await late.markNoShow({ kind: 'staff', actor: t.actor }, serialId, {
      expectedRowVersion: current.rowVersion,
      reason: 'did not arrive',
    });
    expect(marked.status).toBe('NO_SHOW');
    expect((await h.appointments.get(t.actor, a.id)).status).toBe('NO_SHOW');
    expect(await db.prisma.outboxEvent.count({ where: { eventName: 'AppointmentNoShow' } })).toBe(1);
  });

  it('the transition table is the only source of legal edges', async () => {
    // Every (from, command) pair is either in the table or rejected; terminal states have no edges.
    expect(serialTransition('BOOKED', 'confirm')).toBe('CONFIRMED');
    expect(serialTransition('CONFIRMED', 'confirm')).toBeNull();
    expect(serialTransition('COMPLETED', 'cancel')).toBeNull();
    for (const terminal of ['NO_SHOW', 'CANCELLED', 'RESCHEDULED', 'COMPLETED'] as const) {
      expect(Object.keys(SERIAL_TRANSITIONS[terminal])).toEqual([]);
    }
  });
});

describe('reschedule (QUEUE §3.2)', () => {
  it('terminates the old serial, issues a linked serial on the target day and moves the appointment', async () => {
    const { chamber } = await openChamberDay();
    const tomorrow = dhakaDate(new Date(systemClock.now().getTime() + 86_400_000));
    const a = await book(chamber.id, 'Farhana Begum');
    const { day: target } = await h.days.materialize(t.actor, { chamberId: chamber.id, localDate: tomorrow });
    const current = await serials.get({ kind: 'staff', actor: t.actor }, a.serial!.id);

    const { old, next } = await serials.reschedule(
      { kind: 'staff', actor: t.actor },
      a.serial!.id,
      { expectedRowVersion: current.rowVersion, targetChamberDayId: target.id, reason: 'patient travelling' },
      { idempotencyKey: newId() },
    );
    expect(old).toMatchObject({ status: 'RESCHEDULED', rescheduledToSerialId: next.id });
    expect(next).toMatchObject({
      status: 'BOOKED',
      chamberDayId: target.id,
      rescheduledFromSerialId: old.id,
      serialNumber: 1,
    });

    const oldAppointment = await h.appointments.get(t.actor, a.id);
    expect(oldAppointment.status).toBe('RESCHEDULED');
    const moved = await h.appointments.get(t.actor, next.appointmentId!);
    expect(moved).toMatchObject({
      status: 'BOOKED',
      source: 'RESCHEDULE',
      rescheduledFromAppointmentId: a.id,
    });
    expect(await db.prisma.outboxEvent.count({ where: { eventName: 'AppointmentRescheduled' } })).toBe(1);

    // Each day has its own hash chain.
    const targetEvents = await db.prisma.queueEvent.findMany({
      where: { chamberDayId: target.id },
      orderBy: { seq: 'asc' },
    });
    expect(targetEvents.map((e) => e.eventType)).toEqual(['SERIAL_ISSUED']);
    expect(targetEvents[0]!.seq).toBe(1);
    const sourceTypes = (
      await db.prisma.queueEvent.findMany({
        where: { chamberDayId: a.chamberDayId },
        orderBy: { seq: 'asc' },
      })
    ).map((e) => e.eventType);
    expect(sourceTypes).toEqual(['DAY_OPENED', 'SERIAL_ISSUED', 'RESCHEDULED']);
  });

  it('refuses rescheduling onto the same day and a stale version', async () => {
    const { chamber } = await openChamberDay();
    const a = await book(chamber.id, 'Rubel Ahmed');
    const current = await serials.get({ kind: 'staff', actor: t.actor }, a.serial!.id);
    await expect(
      serials.reschedule({ kind: 'staff', actor: t.actor }, a.serial!.id, {
        expectedRowVersion: current.rowVersion,
        targetChamberDayId: a.chamberDayId,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      serials.reschedule({ kind: 'staff', actor: t.actor }, a.serial!.id, {
        expectedRowVersion: 99,
        targetChamberDayId: newId(),
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});

describe('no-show job (QUEUE §3.2, §5.6)', () => {
  it('marks only serials past the cut-off in clinic local time and is idempotent', async () => {
    const { chamber, dayId } = await openChamberDay({ noShowAfterMinutes: 120 });
    const a1 = await book(chamber.id, 'Mahmud Rahman');
    const a2 = await book(chamber.id, 'Jannat Khatun');
    const day = await h.days.get(t.actor, dayId);
    const dayStart = localInstant(day.localDate, day.localStartTime);

    // 119 minutes after the local start: nothing is due yet.
    const early = wire(() => new Date(dayStart.getTime() + 119 * 60_000));
    expect(await early.applyNoShowPolicy(new Date(dayStart.getTime() + 119 * 60_000))).toMatchObject({
      marked: 0,
    });

    const after = new Date(dayStart.getTime() + 121 * 60_000);
    const job = wire(() => after);
    const first = await job.applyNoShowPolicy(after);
    expect(first.marked).toBe(2);
    const second = await job.applyNoShowPolicy(after);
    expect(second.marked).toBe(0);

    for (const a of [a1, a2]) {
      expect((await h.appointments.get(t.actor, a.id)).status).toBe('NO_SHOW');
    }
    const noShowEvents = await db.prisma.queueEvent.findMany({
      where: { chamberDayId: dayId, eventType: 'NO_SHOW' },
    });
    expect(noShowEvents).toHaveLength(2);
    expect(noShowEvents.every((e) => e.actorType === 'SYSTEM' && e.actorUserId === null)).toBe(true);
    expect(await db.prisma.outboxEvent.count({ where: { eventName: 'SerialNoShow' } })).toBe(2);
  });

  it('respects autoNoShowEnabled=false', async () => {
    const { chamber, dayId } = await openChamberDay({ autoNoShowEnabled: false });
    await book(chamber.id, 'Arif Chowdhury');
    const day = await h.days.get(t.actor, dayId);
    const after = new Date(localInstant(day.localDate, day.localStartTime).getTime() + 200 * 60_000);
    const job = wire(() => after);
    expect(await job.applyNoShowPolicy(after)).toMatchObject({ marked: 0 });
  });
});

describe('day close and cancel settlement (QUEUE §3.3)', () => {
  it('close applies the policy disposition to every non-terminal serial', async () => {
    const { chamber, dayId } = await openChamberDay();
    const a1 = await book(chamber.id, 'Shakib Islam');
    const a2 = await book(chamber.id, 'Mitu Akter');
    const s2 = await serials.get({ kind: 'staff', actor: t.actor }, a2.serial!.id);
    await serials.confirm({ kind: 'staff', actor: t.actor }, a2.serial!.id, {
      expectedRowVersion: s2.rowVersion,
    });

    const day = await h.days.get(t.actor, dayId);
    const closed = await h.days.close(t.actor, dayId, { expectedRowVersion: day.rowVersion });
    expect(closed.status).toBe('CLOSED');

    // BOOKED and CONFIRMED both settle to NO_SHOW under the documented default disposition.
    const rows = await db.prisma.serial.findMany({
      where: { chamberDayId: dayId },
      orderBy: { serialNumber: 'asc' },
    });
    expect(rows.map((r) => r.status)).toEqual(['NO_SHOW', 'NO_SHOW']);
    for (const a of [a1, a2]) expect((await h.appointments.get(t.actor, a.id)).status).toBe('NO_SHOW');

    const types = (
      await db.prisma.queueEvent.findMany({ where: { chamberDayId: dayId }, orderBy: { seq: 'asc' } })
    ).map((e) => e.eventType);
    expect(types).toEqual([
      'DAY_OPENED',
      'SERIAL_ISSUED',
      'SERIAL_ISSUED',
      'CONFIRMED',
      'NO_SHOW',
      'NO_SHOW',
      'DAY_CLOSED',
    ]);
  });

  it('cancel settles every serial as CANCELLED with the day reason', async () => {
    const { chamber, dayId } = await openChamberDay();
    const a = await book(chamber.id, 'Lamia Hossain');
    const day = await h.days.get(t.actor, dayId);
    await h.days.cancel(t.actor, dayId, { expectedRowVersion: day.rowVersion, reason: 'doctor unavailable' });

    const serial = await db.prisma.serial.findFirstOrThrow({ where: { chamberDayId: dayId } });
    expect(serial).toMatchObject({ status: 'CANCELLED', cancelReason: 'DAY_CANCELLED' });
    const appointment = await h.appointments.get(t.actor, a.id);
    expect(appointment).toMatchObject({ status: 'CANCELLED', cancelReason: 'DAY_CANCELLED' });
    const lastEvent = await db.prisma.queueEvent.findFirstOrThrow({
      where: { chamberDayId: dayId },
      orderBy: { seq: 'desc' },
    });
    expect(lastEvent.eventType).toBe('DAY_CANCELLED');
  });
});
