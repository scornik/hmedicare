import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher, PolicyEngine } from '@hmedic/identity-access';
import { dhakaDate } from '@hmedic/localization';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

// SERIAL-*/QUEUE-* over HTTP: the endpoint matrix for the live queue. Routing, permissions, idempotency,
// row and queue-order versions, the documented error codes and the patient context. The queue *rules*
// (placement, deadlines, chain contents) are covered deterministically in `@hmedic/queue`; this suite is
// about what the API exposes.
const PASSWORD = 'correct horse battery';
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let seq = 0;
const idem = () => `queue-key-${Date.now()}-${++seq}`;
const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 });
let phoneSeq = 900;
const nextPhone = () => `+88017009${String(phoneSeq++).padStart(5, '0')}`;

beforeAll(async () => {
  api = await buildApi(loadConfig<ServerConfig>('api', testEnv({ DATABASE_URL: testDatabaseUrl() })));
  server = api.app.getHttpServer();
});
afterAll(async () => {
  await api?.close();
});
beforeEach(async () => {
  await truncateAll();
});

async function staff(tenantId: string, role: string) {
  const now = new Date();
  const id = newId();
  const email = `s.${id.slice(-10)}@example.invalid`;
  await api.runtime.prisma.user.create({
    data: {
      id,
      email,
      emailNormalized: email,
      status: 'ACTIVE',
      passwordHash: await hasher.hash(PASSWORD),
      createdAt: now,
      updatedAt: now,
    },
  });
  await api.runtime.prisma.tenantMembership.create({
    data: {
      id: newId(),
      tenantId,
      userId: id,
      role,
      permissions: { grants: [], denials: [] },
      clinicIds: [],
      chamberIds: [],
      status: 'ACTIVE',
      rolePermissionsVersion: PolicyEngine.version,
      createdAt: now,
      updatedAt: now,
    },
  });
  const r = await request(server)
    .post('/api/v1/auth/password/login')
    .set('idempotency-key', idem())
    .send({ email, password: PASSWORD, client: 'android' })
    .expect(200);
  return {
    userId: id,
    headers: { authorization: `Bearer ${r.body.data.accessToken}`, 'x-tenant-id': tenantId },
  };
}

async function otpLogin(phone: string) {
  const req = await request(server)
    .post('/api/v1/auth/otp/request')
    .set('idempotency-key', idem())
    .send({ phone, locale: 'bn-BD' })
    .expect(202);
  const code = (await request(server).get(`/internal/test/otp/${req.body.data.challengeId}`).expect(200)).body
    .code;
  const r = await request(server)
    .post('/api/v1/auth/otp/verify')
    .set('idempotency-key', idem())
    .send({ phone, code, client: 'android' })
    .expect(200);
  return { authorization: `Bearer ${r.body.data.accessToken}` };
}

const today = () => dhakaDate(new Date());
const inDays = (n: number) => dhakaDate(new Date(Date.now() + n * 86_400_000));

/**
 * A tenant, a chamber and the staff who work it.
 *
 * Two things differ from the scheduling suite's setup, both so the results do not depend on the hour the
 * test happens to run at. The chamber is open 00:00–23:59, because `MarkNoShow` refuses a day that has not
 * started yet and a 17:00 chamber only satisfies that in the evening. And the chamber's doctor is a staff
 * member with a password, because ADR-021 puts the interim consultation transitions on the doctor of the
 * chamber, so the suite needs that user's own token rather than just a profile row.
 */
async function chamberSetup(label: string, policy: Record<string, unknown> = {}) {
  const now = new Date();
  const tenantId = newId();
  await api.runtime.prisma.tenant.create({
    data: {
      id: tenantId,
      name: `DEMO ${label}`,
      slug: `demo-${label}-${tenantId.slice(-6)}`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  const admin = await staff(tenantId, 'clinic_admin');
  const doctor = await staff(tenantId, 'doctor');
  const doctorProfileId = newId();
  await api.runtime.prisma.doctorProfile.create({
    data: {
      id: doctorProfileId,
      tenantId,
      userId: doctor.userId,
      displayName: `Dr. ${label}`,
      specialties: [],
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  const clinic = await request(server)
    .post('/api/v1/clinics')
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({ name: `DEMO Clinic ${label}` })
    .expect(201);
  const chamber = await request(server)
    .post('/api/v1/chambers')
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({
      clinicId: clinic.body.data.id,
      doctorProfileId,
      name: `DEMO Chamber ${label}`,
      supportsPhysical: true,
      supportsRemote: true,
      defaultQueuePolicy: policy,
    })
    .expect(201);
  for (let weekday = 1; weekday <= 7; weekday++) {
    await request(server)
      .post(`/api/v1/chambers/${chamber.body.data.id}/schedule-rules`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({
        ruleType: 'WEEKLY',
        weekday,
        localStartTime: '00:00',
        localEndTime: '23:59',
        effectiveFrom: '2020-01-01',
      })
      .expect(201);
  }
  return {
    tenantId,
    doctorProfileId,
    admin,
    doctor,
    clinicId: clinic.body.data.id,
    chamber: chamber.body.data,
  };
}

type Setup = Awaited<ReturnType<typeof chamberSetup>>;

async function patient(headers: Record<string, string>, legalName: string, phone = nextPhone()) {
  const r = await request(server)
    .post('/api/v1/patients')
    .set(headers)
    .set('idempotency-key', idem())
    .send({
      legalName,
      contacts: [{ type: 'PHONE', value: phone, relationship: 'SELF', isPreferred: true }],
      consents: ['care'],
    })
    .expect(201);
  return { id: r.body.data.id as string, phone };
}

/** Materializes a chamber day and opens it; walk-ins and calls need an OPEN day. */
async function chamberDay(s: Setup, localDate = today(), open = true) {
  const created = await request(server)
    .post('/api/v1/chamber-days')
    .set(s.admin.headers)
    .set('idempotency-key', idem())
    .send({ chamberId: s.chamber.id, localDate })
    .expect(201);
  if (!open) return created.body.data;
  const opened = await request(server)
    .post(`/api/v1/chamber-days/${created.body.data.id}/open`)
    .set(s.admin.headers)
    .set('idempotency-key', idem())
    .send({ expectedRowVersion: created.body.data.rowVersion })
    .expect(200);
  return opened.body.data;
}

async function walkIn(
  headers: Record<string, string>,
  chamberDayId: string,
  patientId: string,
  careMode = 'PHYSICAL',
) {
  const r = await request(server)
    .post(`/api/v1/chamber-days/${chamberDayId}/walk-ins`)
    .set(headers)
    .set('idempotency-key', idem())
    .send({ patientId, careMode })
    .expect(201);
  return r.body.data;
}

/**
 * A staff booking for `localDate`, returning the serial it issued. The appointment carries only enough of
 * the serial to show it (id, number, status), so the full row is read back for its `rowVersion`.
 */
async function book(s: Setup, headers: Record<string, string>, patientId: string, localDate = today()) {
  const r = await request(server)
    .post('/api/v1/appointments')
    .set(headers)
    .set('idempotency-key', idem())
    .send({ chamberId: s.chamber.id, localDate, patientId, careMode: 'PHYSICAL' })
    .expect(201);
  const serial = await request(server)
    .get(`/api/v1/serials/${r.body.data.serial.id}`)
    .set(headers)
    .expect(200);
  return { appointment: r.body.data, serial: serial.body.data };
}

/** Node types every header as `string | string[] | undefined`; an ETag is always single-valued. */
const etagOf = (res: { headers: Record<string, unknown> }) => String(res.headers.etag);

const command = (headers: Record<string, string>, serialId: string, action: string) =>
  request(server).post(`/api/v1/serials/${serialId}/${action}`).set(headers).set('idempotency-key', idem());

describe('the queue board over HTTP', () => {
  it('answers the board with an ETag and a bodyless 304 for an unchanged poll', async () => {
    const s = await chamberSetup('board');
    const reception = await staff(s.tenantId, 'receptionist');
    const day = await chamberDay(s);
    const one = await patient(reception.headers, 'Board One');
    const serial = await walkIn(reception.headers, day.id, one.id);

    const url = `/api/v1/chamber-days/${day.id}/queue`;
    const first = await request(server).get(url).set(s.admin.headers).expect(200);
    expect(first.body.data).toMatchObject({
      chamberDayId: day.id,
      localDate: today(),
      status: 'OPEN',
      counts: { waiting: 1, called: 0, inConsultation: 0, completed: 0, totalSerials: 1 },
    });
    expect(first.body.data.entries).toHaveLength(1);
    expect(first.body.data.entries[0]).toMatchObject({
      serialId: serial.id,
      patientId: one.id,
      status: 'WAITING',
      queuePosition: 1,
      source: 'WALK_IN',
    });
    const etag = etagOf(first);
    // The board carries its own tag so a client that only reads the body can still poll conditionally.
    expect(etag).toBe(first.body.data.etag);
    expect(etag).toMatch(/^"[0-9a-f]+"$/);

    // The whole point of the tag: the 5 s poll of an unchanged board costs a 304 with no body (ADR-013).
    const unchanged = await request(server).get(url).set(s.admin.headers).set('if-none-match', etag);
    expect(unchanged.status).toBe(304);
    expect(unchanged.text).toBeFalsy();
    expect(etagOf(unchanged)).toBe(etag);

    const two = await patient(reception.headers, 'Board Two');
    await walkIn(reception.headers, day.id, two.id);
    const changed = await request(server)
      .get(url)
      .set(s.admin.headers)
      .set('if-none-match', etag)
      .expect(200);
    expect(etagOf(changed)).not.toBe(etag);
    expect(changed.body.data.counts.totalSerials).toBe(2);
  });

  it('the board needs queue.read and never crosses a tenant', async () => {
    const s = await chamberSetup('board-perm');
    const day = await chamberDay(s);
    const url = `/api/v1/chamber-days/${day.id}/queue`;

    const billing = await staff(s.tenantId, 'billing_manager'); // appointment.read, no queue.read
    await request(server).get(url).set(billing.headers).expect(403);

    const other = await chamberSetup('board-other');
    await request(server).get(url).set(other.admin.headers).expect(404);
  });
});

describe('walk-ins over HTTP', () => {
  it('issues under serial.write, replays one key and refuses a second active serial', async () => {
    const s = await chamberSetup('walkin');
    const reception = await staff(s.tenantId, 'receptionist');
    const day = await chamberDay(s);
    const p = await patient(reception.headers, 'Walk In');
    const url = `/api/v1/chamber-days/${day.id}/walk-ins`;
    const key = idem();

    const created = await request(server)
      .post(url)
      .set(reception.headers)
      .set('idempotency-key', key)
      .send({ patientId: p.id, careMode: 'PHYSICAL' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      source: 'WALK_IN',
      status: 'WAITING',
      serialNumber: 1,
      queuePosition: 1,
      appointmentId: null,
    });

    const replay = await request(server)
      .post(url)
      .set(reception.headers)
      .set('idempotency-key', key)
      .send({ patientId: p.id, careMode: 'PHYSICAL' })
      .expect(201);
    expect(replay.body.data.id).toBe(created.body.data.id);
    expect(replay.body.meta.replayed).toBe(true);
    expect(await api.runtime.prisma.serial.count({ where: { tenantId: s.tenantId } })).toBe(1);

    // A fresh key is a genuinely new request, and the same patient already holds a serial on this day.
    const duplicate = await request(server)
      .post(url)
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ patientId: p.id, careMode: 'PHYSICAL' });
    expect(duplicate.body.code).toBe('DUPLICATE_ACTIVE_SERIAL');
    expect(duplicate.body.details.existingSerialId).toBe(created.body.data.id);

    // The doctor runs the queue but does not open serials at the desk.
    await request(server)
      .post(url)
      .set(s.doctor.headers)
      .set('idempotency-key', idem())
      .send({ patientId: p.id, careMode: 'PHYSICAL' })
      .expect(403);
  });

  it('stops at maxWalkIns with CAPACITY_EXCEEDED and on a day that is not open', async () => {
    const s = await chamberSetup('walkin-cap', { maxWalkIns: 1 });
    const reception = await staff(s.tenantId, 'receptionist');
    const day = await chamberDay(s);
    const first = await patient(reception.headers, 'Cap One');
    const second = await patient(reception.headers, 'Cap Two');
    await walkIn(reception.headers, day.id, first.id);

    const over = await request(server)
      .post(`/api/v1/chamber-days/${day.id}/walk-ins`)
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ patientId: second.id, careMode: 'PHYSICAL' });
    expect(over.body.code).toBe('CAPACITY_EXCEEDED');

    const scheduled = await chamberDay(s, inDays(1), false);
    const closed = await request(server)
      .post(`/api/v1/chamber-days/${scheduled.id}/walk-ins`)
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ patientId: second.id, careMode: 'PHYSICAL' });
    expect(closed.body.code).toBe('QUEUE_STATE_CONFLICT');
    expect(closed.body.details.dayStatus).toBe('SCHEDULED');
  });
});

describe('reordering the queue over HTTP', () => {
  it('reassigns the listed positions under queue.manage and refuses a stale order version', async () => {
    const s = await chamberSetup('reorder');
    const reception = await staff(s.tenantId, 'receptionist');
    const day = await chamberDay(s);
    const serials = [];
    for (const name of ['Order One', 'Order Two', 'Order Three']) {
      const p = await patient(reception.headers, name);
      serials.push(await walkIn(reception.headers, day.id, p.id));
    }
    const [a, b, c] = serials;
    const url = `/api/v1/chamber-days/${day.id}/reorder`;
    const before = await request(server)
      .get(`/api/v1/chamber-days/${day.id}/queue`)
      .set(s.admin.headers)
      .expect(200);
    const version = before.body.data.queueOrderVersion;

    const billing = await staff(s.tenantId, 'billing_manager');
    await request(server)
      .post(url)
      .set(billing.headers)
      .set('idempotency-key', idem())
      .send({ expectedQueueOrderVersion: version, orderedSerialIds: [c.id, a.id] })
      .expect(403);

    // Only the two listed serials move: their positions (1 and 3) are handed back out in the given order,
    // and the serial in between keeps its own.
    const reordered = await request(server)
      .post(url)
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ expectedQueueOrderVersion: version, orderedSerialIds: [c.id, a.id] })
      .expect(200);
    const positions = new Map<string, number>(
      reordered.body.data.entries.map((e: { serialId: string; queuePosition: number }) => [
        e.serialId,
        e.queuePosition,
      ]),
    );
    expect([positions.get(c.id), positions.get(b.id), positions.get(a.id)]).toEqual([1, 2, 3]);
    expect(reordered.body.data.queueOrderVersion).toBeGreaterThan(version);

    const stale = await request(server)
      .post(url)
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ expectedQueueOrderVersion: version, orderedSerialIds: [a.id, c.id] });
    expect(stale.body.code).toBe('QUEUE_VERSION_CONFLICT');
    expect(stale.body.details.currentQueueOrderVersion).toBe(reordered.body.data.queueOrderVersion);
  });
});

describe('the serial lifecycle over HTTP', () => {
  it('calls, skips and recalls up to the recall limit', async () => {
    const s = await chamberSetup('lifecycle');
    const reception = await staff(s.tenantId, 'receptionist');
    const day = await chamberDay(s);
    const p = await patient(reception.headers, 'Lifecycle');
    const serial = await walkIn(reception.headers, day.id, p.id);

    // The desk manages the queue but does not call the next patient: `queue.call` is a separate grant.
    await command(reception.headers, serial.id, 'call')
      .send({ expectedRowVersion: serial.rowVersion })
      .expect(403);

    const called = await command(s.admin.headers, serial.id, 'call')
      .send({ expectedRowVersion: serial.rowVersion })
      .expect(200);
    expect(called.body.data).toMatchObject({ status: 'CALLED', recallCount: 0 });
    expect(called.body.data.recallDeadlineAt).not.toBeNull();

    const stale = await command(s.admin.headers, serial.id, 'skip').send({
      expectedRowVersion: serial.rowVersion,
      reason: 'DEMO stepped out',
    });
    expect(stale.body.code).toBe('STALE_VERSION');

    let current = called.body.data;
    for (const attempt of [1, 2]) {
      const skipped = await command(s.admin.headers, serial.id, 'skip')
        .send({ expectedRowVersion: current.rowVersion, reason: 'DEMO stepped out' })
        .expect(200);
      expect(skipped.body.data).toMatchObject({ status: 'SKIPPED', recallDeadlineAt: null });
      const recalled = await command(s.admin.headers, serial.id, 'recall')
        .send({ expectedRowVersion: skipped.body.data.rowVersion })
        .expect(200);
      expect(recalled.body.data).toMatchObject({ status: 'CALLED', recallCount: attempt });
      current = recalled.body.data;
    }

    const skipped = await command(s.admin.headers, serial.id, 'skip')
      .send({ expectedRowVersion: current.rowVersion, reason: 'DEMO stepped out again' })
      .expect(200);
    const exhausted = await command(s.admin.headers, serial.id, 'recall').send({
      expectedRowVersion: skipped.body.data.rowVersion,
    });
    expect(exhausted.body.code).toBe('RECALL_LIMIT_REACHED');
    expect(exhausted.body.details).toMatchObject({ recallCount: 2, recallLimit: 2 });
  });

  it('confirms, checks in and marks waiting when the policy asks for confirmation', async () => {
    const s = await chamberSetup('arrival', { waitingRequiresConfirmation: true });
    const reception = await staff(s.tenantId, 'receptionist');
    const day = await chamberDay(s);
    const p = await patient(reception.headers, 'Arrival');
    const { serial } = await book(s, reception.headers, p.id);
    expect(serial).toMatchObject({ status: 'BOOKED', source: 'ADVANCE_BOOKING', queuePosition: null });

    const confirmed = await command(reception.headers, serial.id, 'confirm')
      .send({ expectedRowVersion: serial.rowVersion })
      .expect(200);
    expect(confirmed.body.data.status).toBe('CONFIRMED');
    expect(confirmed.body.data.confirmedAt).not.toBeNull();

    const arrived = await command(reception.headers, serial.id, 'check-in')
      .send({ expectedRowVersion: confirmed.body.data.rowVersion, method: 'STAFF_DESK' })
      .expect(200);
    // Arrival takes the place in the queue; the confirmation the policy asks for only flips the status.
    expect(arrived.body.data).toMatchObject({ status: 'CHECKED_IN', queuePosition: 1 });
    expect(arrived.body.data.checkedInAt).not.toBeNull();

    const waiting = await command(reception.headers, serial.id, 'mark-waiting')
      .send({ expectedRowVersion: arrived.body.data.rowVersion })
      .expect(200);
    expect(waiting.body.data).toMatchObject({ status: 'WAITING', queuePosition: 1 });

    const row = await request(server).get(`/api/v1/serials/${serial.id}`).set(reception.headers).expect(200);
    expect(row.body.data).toMatchObject({ id: serial.id, status: 'WAITING', chamberDayId: day.id });

    const billing = await staff(s.tenantId, 'billing_manager');
    await request(server).get(`/api/v1/serials/${serial.id}`).set(billing.headers).expect(403);
    const other = await chamberSetup('arrival-other');
    await request(server).get(`/api/v1/serials/${serial.id}`).set(other.admin.headers).expect(404);
  });

  it('will not call a remote patient who has not signalled ready', async () => {
    const s = await chamberSetup('remote');
    const reception = await staff(s.tenantId, 'receptionist');
    const day = await chamberDay(s);
    const p = await patient(reception.headers, 'Remote');
    const serial = await walkIn(reception.headers, day.id, p.id, 'REMOTE');

    const early = await command(s.admin.headers, serial.id, 'call').send({
      expectedRowVersion: serial.rowVersion,
    });
    expect(early.body.code).toBe('QUEUE_STATE_CONFLICT');
    expect(early.body.details.reason).toBe('remote_not_ready');

    const ready = await command(reception.headers, serial.id, 'remote-ready')
      .send({ expectedRowVersion: serial.rowVersion })
      .expect(200);
    // Readiness is a check-in fact, not a transition: the serial is still waiting its turn.
    expect(ready.body.data.status).toBe('WAITING');

    const called = await command(s.admin.headers, serial.id, 'call')
      .send({ expectedRowVersion: ready.body.data.rowVersion })
      .expect(200);
    expect(called.body.data.status).toBe('CALLED');
  });

  it('marks a no-show and cancels under serial.manage', async () => {
    const s = await chamberSetup('terminal');
    const reception = await staff(s.tenantId, 'receptionist');
    await chamberDay(s);
    const absent = await patient(reception.headers, 'Absent');
    const leaving = await patient(reception.headers, 'Leaving');
    const absentSerial = (await book(s, reception.headers, absent.id)).serial;
    const leavingSerial = (await book(s, reception.headers, leaving.id)).serial;

    const noShow = await command(reception.headers, absentSerial.id, 'no-show')
      .send({ expectedRowVersion: absentSerial.rowVersion })
      .expect(200);
    expect(noShow.body.data.status).toBe('NO_SHOW');

    const nurse = await staff(s.tenantId, 'nurse'); // serial.manage, so cancelling is within its remit
    const cancelled = await command(nurse.headers, leavingSerial.id, 'cancel')
      .send({ expectedRowVersion: leavingSerial.rowVersion, reason: 'PATIENT_REQUEST' })
      .expect(200);
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', cancelReason: 'PATIENT_REQUEST' });

    // The appointment follows its serial, so the pair cannot drift apart.
    const appointment = await api.runtime.prisma.appointment.findFirstOrThrow({
      where: { id: leavingSerial.appointmentId },
    });
    expect(appointment).toMatchObject({ status: 'CANCELLED', cancelReason: 'PATIENT_REQUEST' });
  });

  it('reschedules a booked serial onto another day and refuses a walk-in', async () => {
    const s = await chamberSetup('reschedule');
    const reception = await staff(s.tenantId, 'receptionist');
    const day = await chamberDay(s);
    const p = await patient(reception.headers, 'Moving');
    const { serial } = await book(s, reception.headers, p.id);
    const target = await chamberDay(s, inDays(1), false);

    const nurse = await staff(s.tenantId, 'nurse'); // no appointment.write
    await command(nurse.headers, serial.id, 'reschedule')
      .send({ expectedRowVersion: serial.rowVersion, targetChamberDayId: target.id })
      .expect(403);

    const moved = await command(reception.headers, serial.id, 'reschedule')
      .send({
        expectedRowVersion: serial.rowVersion,
        targetChamberDayId: target.id,
        reason: 'DEMO chamber overran',
      })
      .expect(200);
    expect(moved.body.data.old).toMatchObject({ id: serial.id, status: 'RESCHEDULED' });
    expect(moved.body.data.next).toMatchObject({
      status: 'BOOKED',
      chamberDayId: target.id,
      rescheduledFromSerialId: serial.id,
    });
    expect(moved.body.data.old.rescheduledToSerialId).toBe(moved.body.data.next.id);

    const walker = await patient(reception.headers, 'Walker');
    const walkInSerial = await walkIn(reception.headers, day.id, walker.id);
    const refused = await command(reception.headers, walkInSerial.id, 'reschedule').send({
      expectedRowVersion: walkInSerial.rowVersion,
      targetChamberDayId: target.id,
    });
    expect(refused.body.code).toBe('INVALID_TRANSITION');
    expect(refused.body.details.reason).toBe('walk_in_not_reschedulable');
  });
});

describe('a patient context over HTTP', () => {
  it('sees only its own serials and may confirm and cancel them', async () => {
    const s = await chamberSetup('me');
    const reception = await staff(s.tenantId, 'receptionist');
    const day = await chamberDay(s);
    const mine = await patient(reception.headers, 'Own Serial');
    const other = await patient(reception.headers, 'Other Serial');
    await api.runtime.prisma.patientContact.updateMany({
      where: { tenantId: s.tenantId },
      data: { verificationStatus: 'VERIFIED' },
    });
    const user = await otpLogin(mine.phone);
    const ctx = {
      authorization: user.authorization,
      'x-tenant-id': s.tenantId,
      'x-patient-context': mine.id,
    };

    const { serial } = await book(s, reception.headers, mine.id);
    const theirs = await walkIn(reception.headers, day.id, other.id);

    const list = await request(server).get('/api/v1/me/serials').set(ctx).expect(200);
    expect(list.body.data.items.map((i: { serialId: string }) => i.serialId)).toEqual([serial.id]);

    const view = await request(server).get(`/api/v1/me/serials/${serial.id}`).set(ctx).expect(200);
    expect(view.body.data).toMatchObject({
      serialId: serial.id,
      status: 'BOOKED',
      chamberDayId: day.id,
      localDate: today(),
      peopleAhead: null,
    });
    // The patient view carries no trace of anybody else on the day.
    expect(JSON.stringify(view.body)).not.toContain(other.id);
    expect(JSON.stringify(view.body)).not.toContain(theirs.id);

    await request(server).get(`/api/v1/me/serials/${theirs.id}`).set(ctx).expect(403);

    const confirmed = await command(ctx, serial.id, 'confirm')
      .send({ expectedRowVersion: view.body.data.rowVersion })
      .expect(200);
    expect(confirmed.body.data.status).toBe('CONFIRMED');

    const cancelled = await command(ctx, serial.id, 'cancel')
      .send({ expectedRowVersion: confirmed.body.data.rowVersion, reason: 'PATIENT_REQUEST' })
      .expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    // Running the board is staff work; a patient token carries no tenant permission.
    await command(ctx, theirs.id, 'call').send({ expectedRowVersion: theirs.rowVersion }).expect(403);

    const audit = await api.runtime.prisma.auditLog.findFirstOrThrow({
      where: { tenantId: s.tenantId, action: 'SERIAL_CANCELLED' },
    });
    expect(audit).toMatchObject({ actingAs: 'SELF', onBehalfOfPatientId: mine.id });
  });
});
