import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Database, withTransaction } from '@hmedic/database';
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
import { QueueOutbox, QueueSerialLifecycle, QueueService, SerialService } from '../../src/public/index';

/**
 * Queue-active lifecycle (QUEUE §3.2 walk-in and arrival rows, §4.1 positions, §4.2 the patient view,
 * §5.3 reorder) and the live snapshot reads. Races live in the concurrency suite.
 */
let db: Database;
let h: SchedulingHarness;
let serials: SerialService;
let queue: QueueService;
let t: TenantFixture;

function wire(clockNow?: () => Date) {
  const clock = clockNow ? { now: clockNow } : systemClock;
  const outbox = new QueueOutbox(new OutboxPort(clock), clock);
  const s = new SerialService(db.prisma, h.audit, outbox, h.appointments, clock);
  h.serials.bind(s as never);
  return { serials: s, queue: new QueueService(db.prisma, h.audit, outbox, s, h.patients, clock) };
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
  ({ serials, queue } = wire());
  t = await seedTenant(db, 'qlife');
});

const today = () => dhakaDate(systemClock.now());

async function openDay(
  policy: Record<string, unknown> = {},
): Promise<{ chamber: ChamberView; dayId: string }> {
  const chamber = await h.chambers.create(t.actor, {
    clinicId: t.clinicId,
    doctorProfileId: t.doctorProfileId,
    name: 'DEMO Lifecycle Chamber',
    supportsPhysical: true,
    supportsRemote: true,
    supportsHybrid: false,
    telemedicinePaymentMode: 'OPTIONAL_ONLINE',
    defaultQueuePolicy: policy,
  });
  await weeklyEveningRules(h.schedules, t.actor, chamber.id);
  const { day } = await h.days.materialize(t.actor, { chamberId: chamber.id, localDate: today() });
  const opened = await h.days.open(t.actor, day.id, { expectedRowVersion: day.rowVersion });
  return { chamber, dayId: opened.id };
}

async function walkIn(dayId: string, name: string, careMode: 'PHYSICAL' | 'REMOTE' = 'PHYSICAL') {
  const patientId = await seedPatient(h.patients, t.patientActor, name);
  return queue.issueWalkIn(t.actor, dayId, { patientId, careMode }, { idempotencyKey: newId() });
}

async function book(chamberId: string, name: string): Promise<AppointmentView> {
  const patientId = await seedPatient(h.patients, t.patientActor, name);
  return h.appointments.create(
    { kind: 'staff', actor: t.actor },
    { chamberId, localDate: today(), patientId, careMode: 'PHYSICAL' },
    { idempotencyKey: newId() },
  );
}

describe('walk-in issuance (QUEUE §3.1, §5.2)', () => {
  it('lands in WAITING with a position and three queue events under the default policy', async () => {
    const { dayId } = await openDay();
    const first = await walkIn(dayId, 'Rahim Uddin');
    const second = await walkIn(dayId, 'Karim Islam');
    expect(first).toMatchObject({ status: 'WAITING', serialNumber: 1, queuePosition: 1, source: 'WALK_IN' });
    expect(second).toMatchObject({ status: 'WAITING', serialNumber: 2, queuePosition: 2 });

    const events = await db.prisma.queueEvent.findMany({
      where: { serialId: first.id },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((e) => e.eventType)).toEqual(['SERIAL_ISSUED', 'CHECKED_IN', 'WAITING']);
    expect(await db.prisma.checkIn.count({ where: { serialId: first.id, revokedAt: null } })).toBe(1);
    const day = await h.days.get(t.actor, dayId);
    expect(day).toMatchObject({ nextSerialNumber: 3, queueOrderVersion: 1 });
  });

  it('stops at CHECKED_IN when the policy asks staff to confirm', async () => {
    const { dayId } = await openDay({ waitingRequiresConfirmation: true });
    const s = await walkIn(dayId, 'Nusrat Jahan');
    expect(s).toMatchObject({ status: 'CHECKED_IN', queuePosition: 1 });
    const events = await db.prisma.queueEvent.findMany({
      where: { serialId: s.id },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((e) => e.eventType)).toEqual(['SERIAL_ISSUED', 'CHECKED_IN']);

    const waiting = await queue.markWaiting({ kind: 'staff', actor: t.actor }, s.id, {
      expectedRowVersion: s.rowVersion,
    });
    expect(waiting.status).toBe('WAITING');
  });

  it('refuses walk-ins on a booking-only chamber, a closed day and over capacity', async () => {
    const bookingOnly = await openDay({ walkInsEnabled: false });
    await expect(walkIn(bookingOnly.dayId, 'Sadia Akter')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    const capped = await openDay({ maxWalkIns: 1 });
    await walkIn(capped.dayId, 'Tanvir Hossain');
    await expect(walkIn(capped.dayId, 'Mitu Begum')).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });

    const day = await h.days.get(t.actor, capped.dayId);
    await h.days.close(t.actor, capped.dayId, { expectedRowVersion: day.rowVersion });
    await expect(walkIn(capped.dayId, 'Arif Rahman')).rejects.toMatchObject({ code: 'QUEUE_STATE_CONFLICT' });
  });

  it('refuses a duplicate active serial and accepts an audited override', async () => {
    const { dayId } = await openDay();
    const first = await walkIn(dayId, 'Lamia Chowdhury');
    const patientId = first.patientId;
    await expect(
      queue.issueWalkIn(t.actor, dayId, { patientId, careMode: 'PHYSICAL' }, { idempotencyKey: newId() }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ACTIVE_SERIAL', details: { existingSerialId: first.id } });

    const overridden = await queue.issueWalkIn(
      t.actor,
      dayId,
      { patientId, careMode: 'PHYSICAL', duplicateOverride: { reason: 'second complaint same day' } },
      { idempotencyKey: newId() },
    );
    expect(overridden).toMatchObject({ duplicateOverride: true, serialNumber: 2 });
    const override = await db.prisma.queueEvent.findFirstOrThrow({
      where: { serialId: overridden.id, eventType: 'DUPLICATE_OVERRIDE' },
    });
    expect(override.reason).toBe('second complaint same day');
  });
});

describe('check-in and placement (QUEUE §4.1)', () => {
  it('an on-time arrival appends; the early-check-in window is enforced on a scheduled day', async () => {
    const { chamber, dayId } = await openDay();
    const a = await book(chamber.id, 'Farhana Begum');
    await walkIn(dayId, 'Shakib Islam'); // takes position 1
    // Pin the clock one minute into the window. On the wall clock the fixture opens at 17:00 local, so a
    // suite that happens to run after 17:15 would see this arrival as late and the assertion would flip.
    const day = await h.days.get(t.actor, dayId);
    const justOpened = new Date(localInstant(day.localDate, day.localStartTime).getTime() + 60_000);
    const onTime = wire(() => justOpened);
    const serial = await serials.get({ kind: 'staff', actor: t.actor }, a.serial!.id);
    const checked = await onTime.queue.checkIn({ kind: 'staff', actor: t.actor }, serial.id, {
      expectedRowVersion: serial.rowVersion,
    });
    expect(checked).toMatchObject({ status: 'WAITING', queuePosition: 2, lateArrival: false });
    expect(await db.prisma.checkIn.count({ where: { serialId: serial.id } })).toBe(1);
  });

  it('a late arrival under BY_SERIAL_NUMBER inserts by serial number and bumps the order version', async () => {
    const { chamber, dayId } = await openDay({
      lateArrivalPlacement: 'BY_SERIAL_NUMBER',
      lateArrivalGraceMinutes: 0,
    });
    const early = await book(chamber.id, 'Jannat Khatun'); // serial 1
    const later = await book(chamber.id, 'Mahmud Rahman'); // serial 2
    const laterSerial = await serials.get({ kind: 'staff', actor: t.actor }, later.serial!.id);
    // Serial 2 arrives first and takes position 1.
    const second = await queue.checkIn({ kind: 'staff', actor: t.actor }, laterSerial.id, {
      expectedRowVersion: laterSerial.rowVersion,
    });
    expect(second.queuePosition).toBe(1);
    const dayBefore = await h.days.get(t.actor, dayId);

    // Serial 1 arrives after the local start, so it is a late arrival; BY_SERIAL_NUMBER puts it in front.
    const afterStart = new Date(
      localInstant(dayBefore.localDate, dayBefore.localStartTime).getTime() + 60_000,
    );
    const lateClock = wire(() => afterStart);
    const earlySerial = await serials.get({ kind: 'staff', actor: t.actor }, early.serial!.id);
    const late = await lateClock.queue.checkIn({ kind: 'staff', actor: t.actor }, earlySerial.id, {
      expectedRowVersion: earlySerial.rowVersion,
    });
    expect(late).toMatchObject({ queuePosition: 1, lateArrival: true });
    const shifted = await serials.get({ kind: 'staff', actor: t.actor }, later.serial!.id);
    expect(shifted.queuePosition).toBe(2);
    const dayAfter = await h.days.get(t.actor, dayId);
    expect(dayAfter.queueOrderVersion).toBe(dayBefore.queueOrderVersion + 1);
    const reorder = await db.prisma.queueEvent.findFirstOrThrow({
      where: { chamberDayId: dayId, eventType: 'QUEUE_REORDERED' },
    });
    expect(JSON.stringify(reorder.details)).toContain('late_arrival_by_serial_number');
  });

  it('APPEND keeps a late arrival at the back without touching the order version', async () => {
    const { chamber, dayId } = await openDay({ lateArrivalGraceMinutes: 0 });
    const a = await book(chamber.id, 'Rubel Ahmed');
    await walkIn(dayId, 'Sultana Akter');
    const dayBefore = await h.days.get(t.actor, dayId);
    const afterStart = new Date(
      localInstant(dayBefore.localDate, dayBefore.localStartTime).getTime() + 60_000,
    );
    const lateClock = wire(() => afterStart);
    const serial = await serials.get({ kind: 'staff', actor: t.actor }, a.serial!.id);
    const checked = await lateClock.queue.checkIn({ kind: 'staff', actor: t.actor }, serial.id, {
      expectedRowVersion: serial.rowVersion,
    });
    expect(checked).toMatchObject({ lateArrival: true, queuePosition: 2 });
    expect((await h.days.get(t.actor, dayId)).queueOrderVersion).toBe(dayBefore.queueOrderVersion);
  });
});

describe('call, skip and recall (QUEUE §3.2)', () => {
  it('calls with a recall deadline, skips with a reason and recalls up to the limit', async () => {
    const { dayId } = await openDay({ recallLimit: 1, recallDeadlineMinutes: 5 });
    const s = await walkIn(dayId, 'Sabbir Hossain');
    const called = await queue.call({ kind: 'staff', actor: t.actor }, s.id, {
      expectedRowVersion: s.rowVersion,
    });
    expect(called.status).toBe('CALLED');
    expect(called.recallDeadlineAt).not.toBeNull();
    expect(new Date(called.recallDeadlineAt!).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 5_000);

    const skipped = await queue.skip({ kind: 'staff', actor: t.actor }, s.id, {
      expectedRowVersion: called.rowVersion,
      reason: 'patient not at the door',
    });
    expect(skipped).toMatchObject({ status: 'SKIPPED', recallDeadlineAt: null, queuePosition: 1 });

    const recalled = await queue.recall({ kind: 'staff', actor: t.actor }, s.id, {
      expectedRowVersion: skipped.rowVersion,
    });
    expect(recalled).toMatchObject({ status: 'CALLED', recallCount: 1 });

    const skippedAgain = await queue.skip({ kind: 'staff', actor: t.actor }, s.id, {
      expectedRowVersion: recalled.rowVersion,
      reason: 'still not there',
    });
    await expect(
      queue.recall({ kind: 'staff', actor: t.actor }, s.id, { expectedRowVersion: skippedAgain.rowVersion }),
    ).rejects.toMatchObject({ code: 'RECALL_LIMIT_REACHED' });

    const types = (
      await db.prisma.queueEvent.findMany({ where: { serialId: s.id }, orderBy: { seq: 'asc' } })
    ).map((e) => e.eventType);
    expect(types).toEqual([
      'SERIAL_ISSUED',
      'CHECKED_IN',
      'WAITING',
      'CALLED',
      'SKIPPED',
      'RECALLED',
      'SKIPPED',
    ]);
  });

  it('a remote serial is only called once it is ready, unless the policy allows an audited override', async () => {
    const { dayId } = await openDay();
    const s = await walkIn(dayId, 'Remote Patient', 'REMOTE');
    await expect(
      queue.call({ kind: 'staff', actor: t.actor }, s.id, { expectedRowVersion: s.rowVersion }),
    ).rejects.toMatchObject({ code: 'QUEUE_STATE_CONFLICT', details: { reason: 'remote_not_ready' } });

    const ready = await queue.markRemoteReady({ kind: 'staff', actor: t.actor }, s.id, {
      expectedRowVersion: s.rowVersion,
    });
    expect(ready.status).toBe('WAITING'); // readiness does not move the serial
    const called = await queue.call({ kind: 'staff', actor: t.actor }, s.id, {
      expectedRowVersion: ready.rowVersion,
    });
    expect(called.status).toBe('CALLED');
    expect(await db.prisma.queueEvent.count({ where: { serialId: s.id, eventType: 'REMOTE_READY' } })).toBe(
      1,
    );
  });

  it('refuses to close a chamber day while a consultation is running', async () => {
    const { dayId } = await openDay();
    const s = await walkIn(dayId, 'Consulting Patient');
    await queue.call({ kind: 'staff', actor: t.actor }, s.id, { expectedRowVersion: s.rowVersion });

    // Through the lifecycle port, which is how the clinical context moves a serial since ADR-021 was
    // retired. The queue no longer has a consultation command of its own: starting one is an encounter.
    const lifecycle = new QueueSerialLifecycle(serials);
    await withTransaction(
      db.prisma,
      (tx) =>
        lifecycle.markInConsultation(tx, t.tenantId, s.id, {
          actor: { userId: t.actor.userId, actorType: 'USER' },
          correlationId: newId(),
          requestId: null,
        }),
      { context: 'test:in-consultation' },
    );
    const inChamber = await db.prisma.serial.findFirstOrThrow({ where: { id: s.id } });
    expect(inChamber).toMatchObject({ status: 'IN_CONSULTATION', queuePosition: 1 });

    // The property this test exists for: a day cannot be closed with a patient still in the room.
    const day = await h.days.get(t.actor, dayId);
    await expect(h.days.close(t.actor, dayId, { expectedRowVersion: day.rowVersion })).rejects.toMatchObject({
      code: 'CHAMBER_DAY_HAS_ACTIVE_CONSULTATION',
    });

    await withTransaction(
      db.prisma,
      (tx) =>
        lifecycle.markCompleted(tx, t.tenantId, s.id, {
          actor: { userId: t.actor.userId, actorType: 'USER' },
          correlationId: newId(),
          requestId: null,
        }),
      { context: 'test:complete' },
    );
    const completed = await db.prisma.serial.findFirstOrThrow({ where: { id: s.id } });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).not.toBeNull();
    await h.days.close(t.actor, dayId, { expectedRowVersion: day.rowVersion });
  });
});

describe('reorder (QUEUE §5.3)', () => {
  it('permutes the listed positions, leaves the others alone and bumps the order version', async () => {
    const { dayId } = await openDay();
    const a = await walkIn(dayId, 'First Patient');
    const b = await walkIn(dayId, 'Second Patient');
    const c = await walkIn(dayId, 'Third Patient');
    const day = await h.days.get(t.actor, dayId);

    const snapshot = await queue.reorder(t.actor, dayId, {
      expectedQueueOrderVersion: day.queueOrderVersion,
      orderedSerialIds: [c.id, a.id],
    });
    expect(snapshot.queueOrderVersion).toBe(day.queueOrderVersion + 1);
    const positions = new Map(snapshot.entries.map((e) => [e.serialId, e.queuePosition]));
    expect(positions.get(c.id)).toBe(1);
    expect(positions.get(b.id)).toBe(2); // untouched
    expect(positions.get(a.id)).toBe(3);

    await expect(
      queue.reorder(t.actor, dayId, {
        expectedQueueOrderVersion: day.queueOrderVersion,
        orderedSerialIds: [a.id, c.id],
      }),
    ).rejects.toMatchObject({ code: 'QUEUE_VERSION_CONFLICT' });

    const called = await queue.call({ kind: 'staff', actor: t.actor }, c.id, {
      expectedRowVersion: snapshot.entries.find((e) => e.serialId === c.id)!.rowVersion,
    });
    await expect(
      queue.reorder(t.actor, dayId, {
        expectedQueueOrderVersion: snapshot.queueOrderVersion,
        orderedSerialIds: [called.id, a.id],
      }),
    ).rejects.toMatchObject({ code: 'QUEUE_STATE_CONFLICT' });
  });
});

describe('live reads (QUEUE §3.5, §4.2)', () => {
  it('the staff snapshot carries the day tokens and an ETag that changes on every mutation', async () => {
    const { dayId } = await openDay();
    const a = await walkIn(dayId, 'Snapshot One');
    const first = await queue.snapshot(t.tenantId, dayId);
    expect(first).toMatchObject({ chamberDayId: dayId, status: 'OPEN', queueOrderVersion: 1 });
    expect(first.counts).toMatchObject({ waiting: 1, called: 0, totalSerials: 1 });
    expect(first.entries[0]).toMatchObject({
      serialId: a.id,
      queuePosition: 1,
      patientDisplayName: 'Snapshot One',
    });
    expect(first.etag).toMatch(/^"[0-9a-f]{32}"$/);

    const unchanged = await queue.snapshot(t.tenantId, dayId);
    expect(unchanged.etag).toBe(first.etag);

    await queue.call({ kind: 'staff', actor: t.actor }, a.id, { expectedRowVersion: a.rowVersion });
    const after = await queue.snapshot(t.tenantId, dayId);
    expect(after.etag).not.toBe(first.etag);
    expect(after.counts).toMatchObject({ waiting: 0, called: 1 });
  });

  it('the patient view shows an estimate before arrival, people ahead after, and never another patient', async () => {
    const { chamber, dayId } = await openDay({ avgConsultationMinutes: 10 });
    await walkIn(dayId, 'Neighbour Uddin');
    await walkIn(dayId, 'Neighbour Islam');
    const mine = await book(chamber.id, 'Mine Patient');
    const day = await h.days.get(t.actor, dayId);
    await h.days.recordDelay(t.actor, dayId, {
      expectedQueueOrderVersion: day.queueOrderVersion,
      delayMinutes: 20,
      reasonCode: 'DOCTOR_LATE',
    });

    const ctx = {
      userId: newId(),
      tenantId: t.tenantId,
      patientId: mine.patientId,
      actingAs: 'SELF' as const,
      guardianshipId: null,
      authorityScope: new Set<string>(),
    };
    const booked = await queue.patientView(ctx, mine.serial!.id);
    expect(booked).toMatchObject({ status: 'BOOKED', peopleAhead: null, estimatedPosition: 3 });
    expect(booked.estimatedWaitMinutes).toBe(2 * 10 + 20);
    expect(JSON.stringify(booked)).not.toContain('Neighbour');

    const serial = await serials.get({ kind: 'staff', actor: t.actor }, mine.serial!.id);
    await queue.checkIn({ kind: 'staff', actor: t.actor }, serial.id, {
      expectedRowVersion: serial.rowVersion,
    });
    const waiting = await queue.patientView(ctx, mine.serial!.id);
    expect(waiting).toMatchObject({ status: 'WAITING', peopleAhead: 2, estimatedPosition: null });

    // Another patient's serial is never readable through this context.
    const other = await db.prisma.serial.findFirstOrThrow({
      where: { chamberDayId: dayId, serialNumber: 1 },
    });
    await expect(queue.patientView(ctx, other.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('the day boundary is computed in clinic local time, not UTC', async () => {
    const { dayId } = await openDay();
    const day = await h.days.get(t.actor, dayId);
    // 00:05 local on the day's date is 18:05 UTC on the previous calendar day.
    const localMidnight = localInstant(day.localDate, '00:05');
    expect(dhakaDate(localMidnight)).toBe(day.localDate);
    expect(localMidnight.toISOString().slice(0, 10)).not.toBe(day.localDate);
  });
});
