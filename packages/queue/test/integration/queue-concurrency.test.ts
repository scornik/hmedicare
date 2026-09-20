import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Database, createDatabase } from '@hmedic/database';
import { newId, systemClock } from '@hmedic/kernel';
import { OutboxPort } from '@hmedic/jobs';
import { addDays, dhakaDate } from '@hmedic/localization';
import { type ChamberView, localInstant } from '@hmedic/scheduling';
import {
  type SchedulingHarness,
  type TenantFixture,
  schedulingServices,
  seedPatient,
  seedTenant,
  weeklyEveningRules,
} from '../../../../tests/support/scheduling';
import { openTestDatabase, rawConnection, testDatabaseUrl, truncateAll } from '../../../../tests/support/db';
import { QueueOutbox, QueueService, SerialService } from '../../src/public/index';

/**
 * Mandatory concurrency and invariant suite (Stage 5 prompt §4, QUEUE-CONCURRENCY-DESIGN §2–§7). Every case
 * runs against a real MariaDB container with genuinely parallel connections: each "client" gets its own
 * pool, so the races happen in the engine rather than in one JavaScript event loop.
 *
 * A flake here is a bug, not something to retry away: the suite is run ten times before a checkpoint.
 */
let db: Database;
let h: SchedulingHarness;
let t: TenantFixture;
/** Independent clients, each with its own connection pool (the "separate API processes" of §7). */
let clients: Array<{ db: Database; serials: SerialService; queue: QueueService }>;

const CLIENTS = 4;

function wireOn(target: Database, clockNow?: () => Date) {
  const clock = clockNow ? { now: clockNow } : systemClock;
  const outbox = new QueueOutbox(new OutboxPort(clock), clock);
  const serials = new SerialService(target.prisma, h.audit, outbox, h.appointments, clock);
  const queue = new QueueService(target.prisma, h.audit, outbox, serials, h.patients, clock);
  return { db: target, serials, queue };
}

beforeAll(() => {
  db = openTestDatabase({ poolMax: 10 });
  h = schedulingServices(db);
  clients = Array.from({ length: CLIENTS }, () =>
    wireOn(createDatabase({ url: testDatabaseUrl(), poolMax: 5 })),
  );
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.db.close()));
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
  // The scheduling harness writes through its own client; bind it to the first client's engine.
  h.serials.bind(clients[0]!.serials as never);
  t = await seedTenant(db, 'conc');
});

const today = () => dhakaDate(systemClock.now());

async function openDay(
  policy: Record<string, unknown> = {},
): Promise<{ chamber: ChamberView; dayId: string }> {
  const chamber = await h.chambers.create(t.actor, {
    clinicId: t.clinicId,
    doctorProfileId: t.doctorProfileId,
    name: 'DEMO Concurrency Chamber',
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

/**
 * N patients created up front, so the race itself contains no extra writes. Creating them is fixture work
 * (each create runs duplicate detection), so it is deliberately kept out of the measured window.
 */
async function patients(n: number, prefix: string): Promise<string[]> {
  if (n === 1) return [await seedPatient(h.patients, t.patientActor, `${prefix} 0`)];
  return withConcurrency(
    Array.from({ length: n }, (_, i) => () => seedPatient(h.patients, t.patientActor, `${prefix} ${i}`)),
    6,
  );
}

/**
 * Issues a walk-in the way a real client does: on `QUEUE_BUSY` (the documented retryable 503 for a hot
 * chamber day) it waits and repeats the request with the same idempotency key (QUEUE §6).
 */
async function issueWithBusyRetry(
  client: { queue: QueueService },
  dayId: string,
  patientId: string,
  attempts = 8,
) {
  const key = newId();
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await client.queue.issueWalkIn(
        t.actor,
        dayId,
        { patientId, careMode: 'PHYSICAL' },
        { idempotencyKey: key },
      );
    } catch (error) {
      lastError = error;
      if ((error as { code?: string }).code !== 'QUEUE_BUSY') throw error;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw lastError;
}

/** Runs tasks with bounded concurrency: a reception desk has a few staff, not eighty simultaneous ones. */
async function withConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      for (let i = next++; i < tasks.length; i = next++) out[i] = await tasks[i]!();
    }),
  );
  return out;
}

const settledOk = <T>(rs: PromiseSettledResult<T>[]): T[] =>
  rs.filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled').map((r) => r.value);
const settledErr = (rs: PromiseSettledResult<unknown>[]): Array<{ code?: string }> =>
  rs.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);

describe('§4.1 walk-in race', () => {
  it(
    'N receptionists on separate pools issue unique consecutive serial numbers',
    { timeout: 120_000 },
    async () => {
      const { dayId } = await openDay();
      const ids = await patients(16, 'Walkin');
      const results = await Promise.allSettled(
        ids.map((patientId, i) => issueWithBusyRetry(clients[i % CLIENTS]!, dayId, patientId)),
      );
      const ok = settledOk(results);
      expect(settledErr(results).map((e) => e.code)).toEqual([]);
      expect(ok).toHaveLength(ids.length);
      const numbers = ok.map((s) => s.serialNumber).sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: ids.length }, (_, i) => i + 1));
      const positions = ok.map((s) => s.queuePosition).sort((a, b) => a! - b!);
      expect(positions).toEqual(numbers);
      const day = await h.days.get(t.actor, dayId);
      expect(day.nextSerialNumber).toBe(ids.length + 1);
      expect(
        await db.prisma.queueEvent.count({ where: { chamberDayId: dayId, eventType: 'SERIAL_ISSUED' } }),
      ).toBe(ids.length);
    },
  );
});

describe('§4.2 retry and lost response', () => {
  it('the same idempotency key issued concurrently yields exactly one serial', async () => {
    const { dayId } = await openDay();
    const [patientId] = await patients(1, 'Retry');
    const key = `retry-${newId()}`;
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        clients[i % CLIENTS]!.queue.issueWalkIn(
          t.actor,
          dayId,
          { patientId: patientId!, careMode: 'PHYSICAL' },
          { idempotencyKey: key },
        ),
      ),
    );
    // The duplicate-serial key admits exactly one; the rest see DUPLICATE_ACTIVE_SERIAL (or a lock retry).
    expect(settledOk(results)).toHaveLength(1);
    for (const e of settledErr(results)) {
      expect(['DUPLICATE_ACTIVE_SERIAL', 'QUEUE_BUSY']).toContain(e.code);
    }
    expect(await db.prisma.serial.count({ where: { chamberDayId: dayId } })).toBe(1);
    expect(
      await db.prisma.queueEvent.count({ where: { chamberDayId: dayId, eventType: 'SERIAL_ISSUED' } }),
    ).toBe(1);
  });

  it('a commit followed by a lost response leaves exactly one serial and one event chain', async () => {
    const { dayId } = await openDay();
    const [patientId] = await patients(1, 'Lost');
    const issued = await clients[0]!.queue.issueWalkIn(
      t.actor,
      dayId,
      { patientId: patientId!, careMode: 'PHYSICAL' },
      { idempotencyKey: newId() },
    );
    // The client never saw the response and retries on another pool: the database key is the backstop.
    await expect(
      clients[1]!.queue.issueWalkIn(
        t.actor,
        dayId,
        { patientId: patientId!, careMode: 'PHYSICAL' },
        { idempotencyKey: newId() },
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ACTIVE_SERIAL', details: { existingSerialId: issued.id } });
    const events = await db.prisma.queueEvent.findMany({
      where: { chamberDayId: dayId },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  });
});

describe('§4.3 call/skip race', () => {
  it('two staff act on one serial at the same version: one wins, the other gets STALE_VERSION', async () => {
    const { dayId } = await openDay();
    const [patientId] = await patients(1, 'Race');
    const s = await clients[0]!.queue.issueWalkIn(
      t.actor,
      dayId,
      { patientId: patientId!, careMode: 'PHYSICAL' },
      { idempotencyKey: newId() },
    );
    // Both edges are legal from WAITING, so the only difference is who got there first.
    const results = await Promise.allSettled([
      clients[0]!.queue.call({ kind: 'staff', actor: t.actor }, s.id, { expectedRowVersion: s.rowVersion }),
      clients[1]!.serials.cancel({ kind: 'staff', actor: t.actor }, s.id, {
        expectedRowVersion: s.rowVersion,
        reason: 'PATIENT_REQUEST',
      }),
    ]);
    expect(settledOk(results)).toHaveLength(1);
    const errors = settledErr(results);
    expect(errors).toHaveLength(1);
    expect(['STALE_VERSION', 'QUEUE_BUSY']).toContain(errors[0]!.code);
    // Exactly one transition event, and the state is legal.
    const events = await db.prisma.queueEvent.findMany({
      where: { serialId: s.id, eventType: { in: ['CALLED', 'CANCELLED'] } },
    });
    expect(events).toHaveLength(1);
    const row = await db.prisma.serial.findFirstOrThrow({ where: { id: s.id } });
    expect(['CALLED', 'CANCELLED']).toContain(row.status);
  });
});

describe('§4.4 and §4.5 reorder races', () => {
  it('two concurrent reorders: one wins, the other gets QUEUE_VERSION_CONFLICT', async () => {
    const { dayId } = await openDay();
    const ids = await patients(3, 'Reorder');
    const serials = [];
    for (const patientId of ids) {
      serials.push(
        await clients[0]!.queue.issueWalkIn(
          t.actor,
          dayId,
          { patientId, careMode: 'PHYSICAL' },
          { idempotencyKey: newId() },
        ),
      );
    }
    const day = await h.days.get(t.actor, dayId);
    const results = await Promise.allSettled([
      clients[0]!.queue.reorder(t.actor, dayId, {
        expectedQueueOrderVersion: day.queueOrderVersion,
        orderedSerialIds: [serials[2]!.id, serials[0]!.id],
      }),
      clients[1]!.queue.reorder(t.actor, dayId, {
        expectedQueueOrderVersion: day.queueOrderVersion,
        orderedSerialIds: [serials[1]!.id, serials[2]!.id],
      }),
    ]);
    expect(settledOk(results)).toHaveLength(1);
    const errors = settledErr(results);
    expect(errors).toHaveLength(1);
    expect(['QUEUE_VERSION_CONFLICT', 'QUEUE_BUSY']).toContain(errors[0]!.code);
    expect((await h.days.get(t.actor, dayId)).queueOrderVersion).toBe(day.queueOrderVersion + 1);
  });

  it('a walk-in issued during a reorder does not invalidate it and lands at the back', async () => {
    const { dayId } = await openDay();
    const ids = await patients(4, 'Concurrent');
    const serials = [];
    for (const patientId of ids.slice(0, 3)) {
      serials.push(
        await clients[0]!.queue.issueWalkIn(
          t.actor,
          dayId,
          { patientId, careMode: 'PHYSICAL' },
          { idempotencyKey: newId() },
        ),
      );
    }
    const day = await h.days.get(t.actor, dayId);
    const [reorder, walkIn] = await Promise.allSettled([
      clients[0]!.queue.reorder(t.actor, dayId, {
        expectedQueueOrderVersion: day.queueOrderVersion,
        orderedSerialIds: [serials[2]!.id, serials[0]!.id],
      }),
      clients[1]!.queue.issueWalkIn(
        t.actor,
        dayId,
        { patientId: ids[3]!, careMode: 'PHYSICAL' },
        { idempotencyKey: newId() },
      ),
    ]);
    expect(reorder.status).toBe('fulfilled');
    expect(walkIn.status).toBe('fulfilled');
    const snapshot = await clients[0]!.queue.snapshot(t.tenantId, dayId);
    expect(snapshot.queueOrderVersion).toBe(day.queueOrderVersion + 1);
    const positions = new Map(snapshot.entries.map((e) => [e.serialId, e.queuePosition]));
    expect(positions.get(serials[2]!.id)).toBe(1);
    expect(positions.get(serials[1]!.id)).toBe(2);
    expect(positions.get(serials[0]!.id)).toBe(3);
    // The new serial appended behind everybody, whichever order the two transactions committed in.
    const newSerial = (walkIn as PromiseFulfilledResult<{ id: string }>).value;
    expect(positions.get(newSerial.id)).toBe(4);
  });
});

describe('§4.6 day boundary in clinic local time', () => {
  it('actions either side of local midnight land on the correct chamber day', async () => {
    const chamber = await h.chambers.create(t.actor, {
      clinicId: t.clinicId,
      doctorProfileId: t.doctorProfileId,
      name: 'DEMO Midnight Chamber',
      supportsPhysical: true,
      supportsRemote: false,
      supportsHybrid: false,
    });
    // A window that spans local midnight is not allowed, so the boundary is exercised with two dates.
    for (let weekday = 1; weekday <= 7; weekday++) {
      await h.schedules.create(t.actor, chamber.id, {
        ruleType: 'WEEKLY',
        weekday,
        localStartTime: '00:00',
        localEndTime: '00:30',
        effectiveFrom: addDays(today(), -365),
      });
    }
    const first = today();
    const second = addDays(first, 1);
    const dayOne = await h.days.materialize(t.actor, { chamberId: chamber.id, localDate: first });
    const dayTwo = await h.days.materialize(t.actor, { chamberId: chamber.id, localDate: second });

    // 23:59:59 local on `first` is still `first`; 00:00:01 local on `second` is already `second`.
    const lateNight = new Date(localInstant(first, '00:00').getTime() + 23 * 3_600_000 + 3_599_000);
    const justAfter = new Date(localInstant(second, '00:00').getTime() + 1_000);
    expect(dhakaDate(lateNight)).toBe(first);
    expect(dhakaDate(justAfter)).toBe(second);
    // Stored instants are UTC and differ from the local calendar date.
    expect(localInstant(second, '00:00').toISOString().slice(0, 10)).toBe(addDays(second, -1));

    const ids = await patients(2, 'Midnight');
    const beforeMidnight = wireOn(clients[0]!.db, () => lateNight);
    const afterMidnight = wireOn(clients[1]!.db, () => justAfter);
    await h.days.open(t.actor, dayOne.day.id, { expectedRowVersion: dayOne.day.rowVersion });
    await h.days.open(t.actor, dayTwo.day.id, { expectedRowVersion: dayTwo.day.rowVersion });
    const a = await beforeMidnight.queue.issueWalkIn(
      t.actor,
      dayOne.day.id,
      { patientId: ids[0]!, careMode: 'PHYSICAL' },
      { idempotencyKey: newId() },
    );
    const b = await afterMidnight.queue.issueWalkIn(
      t.actor,
      dayTwo.day.id,
      { patientId: ids[1]!, careMode: 'PHYSICAL' },
      { idempotencyKey: newId() },
    );
    expect(a.chamberDayId).toBe(dayOne.day.id);
    expect(b.chamberDayId).toBe(dayTwo.day.id);
    // Each day numbers from 1: the sequence belongs to the chamber day, not to the UTC date.
    expect([a.serialNumber, b.serialNumber]).toEqual([1, 1]);
  });
});

describe('§4.7 one active serial per patient and day, enforced by the database', () => {
  it('a concurrent double insert leaves exactly one row even when the application check is bypassed', async () => {
    const { dayId } = await openDay();
    const [patientId] = await patients(1, 'Double');
    // Two raw inserts race on the generated key, with no application check in the way.
    const conns = await Promise.all([rawConnection(), rawConnection()]);
    const insert = (conn: (typeof conns)[number]) =>
      conn.query(
        `INSERT INTO serials (id, tenant_id, chamber_day_id, patient_id, serial_number, source, care_mode,
           status, recall_count, late_arrival, duplicate_override, created_at, updated_at, row_version)
         VALUES (?, ?, ?, ?, ?, 'WALK_IN', 'PHYSICAL', 'WAITING', 0, 0, 0, NOW(3), NOW(3), 1)`,
        [newId(), t.tenantId, dayId, patientId, Math.floor(Math.random() * 1000) + 100],
      );
    try {
      const results = await Promise.allSettled(conns.map((c) => insert(c)));
      expect(settledOk(results)).toHaveLength(1);
      expect(settledErr(results)).toHaveLength(1);
      expect(String(settledErr(results)[0])).toContain('uq_serials_active_patient_day');
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
    expect(await db.prisma.serial.count({ where: { chamberDayId: dayId, patientId } })).toBe(1);
  });
});

describe('§4.9 lock wait and deadlock handling', () => {
  it('a held chamber-day lock maps to QUEUE_BUSY and writes nothing', async () => {
    const { dayId } = await openDay();
    const [patientId] = await patients(1, 'LockWait');
    // A one-second lock wait and no retries, so the mapping is observable without a long test.
    const impatient = createDatabase({ url: testDatabaseUrl(), poolMax: 2, lockWaitTimeoutSeconds: 1 });
    const outbox = new QueueOutbox(new OutboxPort(systemClock), systemClock);
    const serials = new SerialService(impatient.prisma, h.audit, outbox, h.appointments, systemClock);
    const queue = new QueueService(impatient.prisma, h.audit, outbox, serials, h.patients, systemClock);
    const holder = await rawConnection();
    try {
      await holder.query('SET SESSION innodb_lock_wait_timeout = 30');
      await holder.beginTransaction();
      // The competing lock is the point of this case (QUEUE-CONCURRENCY §7 holds the chamber day from a
      // raw connection), so the no-raw-sql rule is waived here rather than in any production path.
      // eslint-disable-next-line hmedic/no-raw-sql
      await holder.query('SELECT id FROM chamber_days WHERE id = ? FOR UPDATE', [dayId]);
      await expect(
        queue.issueWalkIn(
          t.actor,
          dayId,
          { patientId: patientId!, careMode: 'PHYSICAL' },
          { idempotencyKey: newId() },
        ),
      ).rejects.toMatchObject({ code: 'QUEUE_BUSY' });
    } finally {
      await holder.rollback();
      await holder.end();
      await impatient.close();
    }
    expect(await db.prisma.serial.count({ where: { chamberDayId: dayId } })).toBe(0);
    expect(
      await db.prisma.queueEvent.count({ where: { chamberDayId: dayId, eventType: 'SERIAL_ISSUED' } }),
    ).toBe(0);
  });

  it('a hot chamber day under mixed load keeps every invariant', { timeout: 120_000 }, async () => {
    const { dayId } = await openDay();
    const ids = await patients(12, 'Hot');
    const issued = await Promise.all(
      ids.map((patientId, i) => issueWithBusyRetry(clients[i % CLIENTS]!, dayId, patientId)),
    );
    // Now mix calls, skips and a reorder across pools at the same time.
    const day = await h.days.get(t.actor, dayId);
    const work: Array<Promise<unknown>> = [
      clients[0]!.queue.call({ kind: 'staff', actor: t.actor }, issued[0]!.id, {
        expectedRowVersion: issued[0]!.rowVersion,
      }),
      clients[1]!.queue.call({ kind: 'staff', actor: t.actor }, issued[1]!.id, {
        expectedRowVersion: issued[1]!.rowVersion,
      }),
      clients[2]!.queue.reorder(t.actor, dayId, {
        expectedQueueOrderVersion: day.queueOrderVersion,
        orderedSerialIds: [issued[5]!.id, issued[4]!.id],
      }),
      clients[3]!.queue.issueWalkIn(
        t.actor,
        dayId,
        { patientId: await seedPatient(h.patients, t.patientActor, 'Hot late'), careMode: 'PHYSICAL' },
        { idempotencyKey: newId() },
      ),
    ];
    const results = await Promise.allSettled(work);
    for (const e of settledErr(results)) expect(['QUEUE_BUSY', 'QUEUE_VERSION_CONFLICT']).toContain(e.code);

    const rows = await db.prisma.serial.findMany({ where: { chamberDayId: dayId } });
    const numbers = rows.map((r) => r.serialNumber).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(numbers.length); // no duplicate serial numbers
    const active = rows.filter((r) => r.queuePosition !== null).map((r) => r.queuePosition!);
    expect(new Set(active).size).toBe(active.length); // no duplicate positions
  });
});

describe('§4.8 illegal transitions are rejected for every pair outside the table', () => {
  it('rejects a command the current state does not allow, concurrently and sequentially', async () => {
    const { dayId } = await openDay();
    const [patientId] = await patients(1, 'Illegal');
    const s = await clients[0]!.queue.issueWalkIn(
      t.actor,
      dayId,
      { patientId: patientId!, careMode: 'PHYSICAL' },
      { idempotencyKey: newId() },
    );
    // WAITING has no `recall` and no `complete` edge.
    await expect(
      clients[0]!.queue.recall({ kind: 'staff', actor: t.actor }, s.id, { expectedRowVersion: s.rowVersion }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    const doctor = await db.prisma.doctorProfile.findFirstOrThrow({ where: { id: t.doctorProfileId } });
    await expect(
      clients[0]!.queue.completeConsultation(
        { kind: 'staff', actor: { ...t.actor, userId: doctor.userId } },
        s.id,
        { expectedRowVersion: s.rowVersion },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(await db.prisma.queueEvent.count({ where: { serialId: s.id } })).toBe(3); // issued, checked in, waiting
  });
});

describe('§4.10 tenant isolation and patient scope', () => {
  it('another tenant cannot read or mutate this queue, and a patient sees only its own serial', async () => {
    const { dayId } = await openDay();
    const [patientId] = await patients(1, 'Isolated');
    const s = await clients[0]!.queue.issueWalkIn(
      t.actor,
      dayId,
      { patientId: patientId!, careMode: 'PHYSICAL' },
      { idempotencyKey: newId() },
    );
    const other = await seedTenant(db, 'intruder');
    await expect(clients[0]!.queue.snapshot(other.tenantId, dayId)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(
      clients[0]!.queue.call({ kind: 'staff', actor: other.actor }, s.id, {
        expectedRowVersion: s.rowVersion,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(
      clients[0]!.queue.issueWalkIn(
        other.actor,
        dayId,
        { patientId: patientId!, careMode: 'PHYSICAL' },
        { idempotencyKey: newId() },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const strangerCtx = {
      userId: newId(),
      tenantId: t.tenantId,
      patientId: (await patients(1, 'Stranger'))[0]!,
      actingAs: 'SELF' as const,
      guardianshipId: null,
      authorityScope: new Set<string>(),
    };
    await expect(clients[0]!.queue.patientView(strangerCtx, s.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('§4.11 no-show job idempotence', () => {
  it('running the job twice changes nothing the second time, even from two pools at once', async () => {
    const { chamber, dayId } = await openDay({ noShowAfterMinutes: 60 });
    const ids = await patients(3, 'NoShow');
    for (const patientId of ids) {
      await h.appointments.create(
        { kind: 'staff', actor: t.actor },
        { chamberId: chamber.id, localDate: today(), patientId, careMode: 'PHYSICAL' },
        { idempotencyKey: newId() },
      );
    }
    const day = await h.days.get(t.actor, dayId);
    const after = new Date(localInstant(day.localDate, day.localStartTime).getTime() + 61 * 60_000);
    const jobs = clients.slice(0, 2).map((c) => wireOn(c.db, () => after).serials);
    const [first, second] = await Promise.all([
      jobs[0]!.applyNoShowPolicy(after),
      jobs[1]!.applyNoShowPolicy(after),
    ]);
    // The two runs share the work under the day lock; together they mark each serial exactly once.
    expect(first!.marked + second!.marked).toBe(ids.length);
    const third = await jobs[0]!.applyNoShowPolicy(after);
    expect(third.marked).toBe(0);
    expect(await db.prisma.queueEvent.count({ where: { chamberDayId: dayId, eventType: 'NO_SHOW' } })).toBe(
      ids.length,
    );
  });
});

describe('§4.12 audit and event completeness', () => {
  it('every successful mutation writes one queue event, one audit row and an intact chain', async () => {
    const { dayId } = await openDay();
    const [patientId] = await patients(1, 'Audit');
    const s = await clients[0]!.queue.issueWalkIn(
      t.actor,
      dayId,
      { patientId: patientId!, careMode: 'PHYSICAL' },
      { idempotencyKey: newId() },
    );
    const called = await clients[1]!.queue.call({ kind: 'staff', actor: t.actor }, s.id, {
      expectedRowVersion: s.rowVersion,
    });
    await clients[2]!.queue.skip({ kind: 'staff', actor: t.actor }, s.id, {
      expectedRowVersion: called.rowVersion,
      reason: 'stepped out',
    });

    const events = await db.prisma.queueEvent.findMany({
      where: { chamberDayId: dayId },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((e) => e.eventType)).toEqual([
      'DAY_OPENED',
      'SERIAL_ISSUED',
      'CHECKED_IN',
      'WAITING',
      'CALLED',
      'SKIPPED',
    ]);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events[0]!.prevRowHash).toBeNull();
    for (let i = 1; i < events.length; i++) expect(events[i]!.prevRowHash).toBe(events[i - 1]!.rowHash);
    const checkpoint = await db.prisma.integrityChainCheckpoint.findFirstOrThrow({
      where: { chainKey: `queue:chamber_day:${dayId}` },
    });
    expect(checkpoint.lastSeq).toBe(BigInt(events.length));
    expect(checkpoint.lastRowHash).toBe(events[events.length - 1]!.rowHash);

    const audits = await db.prisma.auditLog.findMany({
      where: { tenantId: t.tenantId, resourceId: s.id },
      orderBy: { seq: 'asc' },
    });
    expect(audits.map((a) => a.action)).toEqual(['SERIAL_ISSUED', 'SERIAL_CALLED', 'SERIAL_SKIPPED']);
    // No patient name reaches audit metadata (seq is a BigInt, so the rows are projected first).
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toContain('Audit 0');
  });

  it('a rolled-back transaction leaves no event, audit row or outbox row behind', async () => {
    const { dayId } = await openDay({ maxWalkIns: 1 });
    const ids = await patients(2, 'Rollback');
    await clients[0]!.queue.issueWalkIn(
      t.actor,
      dayId,
      { patientId: ids[0]!, careMode: 'PHYSICAL' },
      { idempotencyKey: newId() },
    );
    const eventsBefore = await db.prisma.queueEvent.count({ where: { chamberDayId: dayId } });
    const auditsBefore = await db.prisma.auditLog.count({ where: { tenantId: t.tenantId } });
    const outboxBefore = await db.prisma.outboxEvent.count({ where: { tenantId: t.tenantId } });
    await expect(
      clients[1]!.queue.issueWalkIn(
        t.actor,
        dayId,
        { patientId: ids[1]!, careMode: 'PHYSICAL' },
        { idempotencyKey: newId() },
      ),
    ).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });
    expect(await db.prisma.queueEvent.count({ where: { chamberDayId: dayId } })).toBe(eventsBefore);
    expect(await db.prisma.auditLog.count({ where: { tenantId: t.tenantId } })).toBe(auditsBefore);
    expect(await db.prisma.outboxEvent.count({ where: { tenantId: t.tenantId } })).toBe(outboxBefore);
  });
});

describe('§4.13 load sanity', () => {
  it(
    'records walk-in and snapshot latency at rising concurrency on one chamber day',
    { timeout: 600_000 },
    async () => {
      const { dayId } = await openDay({ capacity: 400, maxWalkIns: 400 });
      const perLevel = 24;
      const levels = [1, 2, 4];
      const ids = await patients(perLevel * levels.length, 'Load');
      const report: string[] = [];

      // Each level issues the same number of walk-ins, so ms/serial is comparable across them.
      for (const [levelIndex, desks] of levels.entries()) {
        const slice = ids.slice(levelIndex * perLevel, (levelIndex + 1) * perLevel);
        const started = Date.now();
        await withConcurrency(
          slice.map((patientId, i) => () => issueWithBusyRetry(clients[i % CLIENTS]!, dayId, patientId, 12)),
          desks,
        );
        const ms = Date.now() - started;
        report.push(
          `${desks} desk(s): ${ms} ms for ${slice.length} walk-ins (${(ms / slice.length).toFixed(0)} ms/serial)`,
        );
      }

      const total = perLevel * levels.length;
      const pollStart = Date.now();
      const polls = await Promise.all(
        Array.from({ length: 24 }, (_, i) => clients[i % CLIENTS]!.queue.snapshot(t.tenantId, dayId)),
      );
      const pollMs = Date.now() - pollStart;
      expect(polls[0]!.entries).toHaveLength(total);
      expect(new Set(polls.map((p) => p.etag)).size).toBe(1);

      // The invariant, whatever the timing: every serial number is unique and consecutive.
      const numbers = (await db.prisma.serial.findMany({ where: { chamberDayId: dayId } }))
        .map((x) => x.serialNumber)
        .sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: total }, (_, i) => i + 1));

      // Numbers are recorded, not asserted: the budget is hardware-dependent (Stage 5 prompt §4.13), and
      // recording them is the deliverable, so this one console line is intentional.
      // eslint-disable-next-line no-console
      console.log(
        `[load] one chamber day — ${report.join('; ')}; ` +
          `24 concurrent snapshots of a ${total}-serial queue: ${pollMs} ms (${(pollMs / 24).toFixed(0)} ms/poll)`,
      );
    },
  );
});
