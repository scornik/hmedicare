import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher, PolicyEngine } from '@hmedic/identity-access';
import { dhakaDate } from '@hmedic/localization';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

// CHAM-*/SCHED-*/APPT-* over HTTP: permissions, idempotency, versions and the patient context.
const PASSWORD = 'correct horse battery';
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let seq = 0;
const idem = () => `sched-key-${Date.now()}-${++seq}`;
const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 });
let phoneSeq = 700;
const nextPhone = () => `+88017000${String(phoneSeq++).padStart(5, '0')}`;

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

async function tenant(label: string) {
  const now = new Date();
  const id = newId();
  await api.runtime.prisma.tenant.create({
    data: {
      id,
      name: `DEMO ${label}`,
      slug: `demo-${label}-${id.slice(-6)}`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  const doctorUserId = newId();
  const doctorProfileId = newId();
  const email = `dr.${doctorUserId.slice(-8)}@example.invalid`;
  await api.runtime.prisma.user.create({
    data: {
      id: doctorUserId,
      email,
      emailNormalized: email,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await api.runtime.prisma.doctorProfile.create({
    data: {
      id: doctorProfileId,
      tenantId: id,
      userId: doctorUserId,
      displayName: `Dr. ${label}`,
      specialties: [],
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  return { tenantId: id, doctorProfileId };
}

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
  return { userId: r.body.data.user.id as string, authorization: `Bearer ${r.body.data.accessToken}` };
}

const today = () => dhakaDate(new Date());
const inDays = (n: number) => dhakaDate(new Date(Date.now() + n * 86_400_000));

/** Clinic + chamber + a weekly rule for every weekday, returned with the admin headers. */
async function chamberSetup(label: string, policy: Record<string, unknown> = {}) {
  const t = await tenant(label);
  const admin = await staff(t.tenantId, 'clinic_admin');
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
      doctorProfileId: t.doctorProfileId,
      name: `DEMO Chamber ${label}`,
      supportsPhysical: true,
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
        localStartTime: '17:00',
        localEndTime: '21:00',
        effectiveFrom: '2020-01-01',
      })
      .expect(201);
  }
  return { ...t, admin, clinicId: clinic.body.data.id, chamber: chamber.body.data };
}

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

describe('chambers and schedule rules over HTTP', () => {
  it('clinic.manage and chamber.manage are enforced; reads need appointment.read', async () => {
    const s = await chamberSetup('http');
    const billing = await staff(s.tenantId, 'billing_manager'); // appointment.read, no chamber.manage

    await request(server)
      .post('/api/v1/chambers')
      .set(billing.headers)
      .set('idempotency-key', idem())
      .send({
        clinicId: s.clinicId,
        doctorProfileId: s.doctorProfileId,
        name: 'DEMO Nope',
        supportsPhysical: true,
      })
      .expect(403);

    const list = await request(server).get('/api/v1/chambers').set(billing.headers).expect(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([s.chamber.id]);
    expect(list.body.data[0].defaultQueuePolicy.bookingWindowDays).toBe(14);

    const rules = await request(server)
      .get(`/api/v1/chambers/${s.chamber.id}/schedule-rules`)
      .set(s.admin.headers)
      .expect(200);
    expect(rules.body.data).toHaveLength(7);

    const other = await tenant('other');
    const otherAdmin = await staff(other.tenantId, 'clinic_admin');
    await request(server).get(`/api/v1/chambers/${s.chamber.id}`).set(otherAdmin.headers).expect(404);
  });

  it('updates with expectedRowVersion and ends a schedule rule', async () => {
    const s = await chamberSetup('update');
    const updated = await request(server)
      .patch(`/api/v1/chambers/${s.chamber.id}`)
      .set(s.admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: s.chamber.rowVersion, defaultQueuePolicy: { walkInsEnabled: false } })
      .expect(200);
    expect(updated.body.data.defaultQueuePolicy.walkInsEnabled).toBe(false);

    const stale = await request(server)
      .patch(`/api/v1/chambers/${s.chamber.id}`)
      .set(s.admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: s.chamber.rowVersion, name: 'DEMO Renamed' });
    expect(stale.body.code).toBe('STALE_VERSION');

    const rules = await request(server)
      .get(`/api/v1/chambers/${s.chamber.id}/schedule-rules`)
      .set(s.admin.headers)
      .expect(200);
    const rule = rules.body.data[0];
    const ended = await request(server)
      .post(`/api/v1/schedule-rules/${rule.id}/end`)
      .set(s.admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: rule.rowVersion, effectiveTo: '2030-01-01' })
      .expect(200);
    expect(ended.body.data.effectiveTo).toBe('2030-01-01');
  });
});

describe('chamber days over HTTP', () => {
  it('materializes idempotently, lists a range and runs the documented transitions', async () => {
    const s = await chamberSetup('days');
    const key = idem();
    const created = await request(server)
      .post('/api/v1/chamber-days')
      .set(s.admin.headers)
      .set('idempotency-key', key)
      .send({ chamberId: s.chamber.id, localDate: today() })
      .expect(201);
    const day = created.body.data;
    expect(day).toMatchObject({ status: 'SCHEDULED', localStartTime: '17:00', timezone: 'Asia/Dhaka' });

    const replay = await request(server)
      .post('/api/v1/chamber-days')
      .set(s.admin.headers)
      .set('idempotency-key', key)
      .send({ chamberId: s.chamber.id, localDate: today() })
      .expect(201);
    expect(replay.body.data.id).toBe(day.id);
    expect(replay.body.meta.replayed).toBe(true);

    const list = await request(server)
      .get('/api/v1/chamber-days')
      .query({ chamberId: s.chamber.id, from: today(), to: inDays(2) })
      .set(s.admin.headers)
      .expect(200);
    expect(list.body.data).toHaveLength(1);

    const opened = await request(server)
      .post(`/api/v1/chamber-days/${day.id}/open`)
      .set(s.admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: day.rowVersion })
      .expect(200);
    expect(opened.body.data.status).toBe('OPEN');

    const delayed = await request(server)
      .post(`/api/v1/chamber-days/${day.id}/delay`)
      .set(s.admin.headers)
      .set('idempotency-key', idem())
      .send({
        expectedQueueOrderVersion: opened.body.data.queueOrderVersion,
        delayMinutes: 20,
        reasonCode: 'DOCTOR_LATE',
      })
      .expect(200);
    expect(delayed.body.data.expectedDelayMinutes).toBe(20);

    const conflict = await request(server)
      .post(`/api/v1/chamber-days/${day.id}/delay`)
      .set(s.admin.headers)
      .set('idempotency-key', idem())
      .send({
        expectedQueueOrderVersion: opened.body.data.queueOrderVersion,
        delayMinutes: 5,
        reasonCode: 'OVERRUN',
      });
    expect(conflict.body.code).toBe('QUEUE_VERSION_CONFLICT');

    const policy = await request(server)
      .put(`/api/v1/chamber-days/${day.id}/queue-policy`)
      .set(s.admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedQueueOrderVersion: delayed.body.data.queueOrderVersion, policy: { recallLimit: 3 } })
      .expect(200);
    expect(policy.body.data.queuePolicy.recallLimit).toBe(3);

    const closed = await request(server)
      .post(`/api/v1/chamber-days/${day.id}/close`)
      .set(s.admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: policy.body.data.rowVersion })
      .expect(200);
    expect(closed.body.data.status).toBe('CLOSED');
  });

  it('close requires chamber_day.close and open requires schedule.manage', async () => {
    const s = await chamberSetup('perm');
    const nurse = await staff(s.tenantId, 'nurse'); // queue.manage but no schedule.manage
    const created = await request(server)
      .post('/api/v1/chamber-days')
      .set(s.admin.headers)
      .set('idempotency-key', idem())
      .send({ chamberId: s.chamber.id, localDate: today() })
      .expect(201);
    await request(server)
      .post(`/api/v1/chamber-days/${created.body.data.id}/open`)
      .set(nurse.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: created.body.data.rowVersion })
      .expect(403);
    const opened = await request(server)
      .post(`/api/v1/chamber-days/${created.body.data.id}/open`)
      .set(s.admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: created.body.data.rowVersion })
      .expect(200);
    // The nurse may record a delay (queue.manage) but not close the day (chamber_day.close).
    await request(server)
      .post(`/api/v1/chamber-days/${created.body.data.id}/delay`)
      .set(nurse.headers)
      .set('idempotency-key', idem())
      .send({
        expectedQueueOrderVersion: opened.body.data.queueOrderVersion,
        delayMinutes: 10,
        reasonCode: 'OVERRUN',
      })
      .expect(200);
    await request(server)
      .post(`/api/v1/chamber-days/${created.body.data.id}/close`)
      .set(nurse.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: opened.body.data.rowVersion })
      .expect(403);
  });
});

describe('appointments over HTTP', () => {
  it('books with a serial, replays the idempotent request and cancels', async () => {
    const s = await chamberSetup('book');
    const reception = await staff(s.tenantId, 'receptionist');
    const p = await patient(reception.headers, 'Rahima Khatun');
    const key = idem();
    const created = await request(server)
      .post('/api/v1/appointments')
      .set(reception.headers)
      .set('idempotency-key', key)
      .send({ chamberId: s.chamber.id, localDate: inDays(1), patientId: p.id, careMode: 'PHYSICAL' })
      .expect(201);
    expect(created.body.data).toMatchObject({ status: 'BOOKED', bookedOnBehalf: 'STAFF' });
    expect(created.body.data.serial).toMatchObject({ serialNumber: 1, status: 'BOOKED' });

    const replay = await request(server)
      .post('/api/v1/appointments')
      .set(reception.headers)
      .set('idempotency-key', key)
      .send({ chamberId: s.chamber.id, localDate: inDays(1), patientId: p.id, careMode: 'PHYSICAL' })
      .expect(201);
    expect(replay.body.data.id).toBe(created.body.data.id);
    expect(replay.body.meta.replayed).toBe(true);
    expect(await api.runtime.prisma.serial.count({ where: { tenantId: s.tenantId } })).toBe(1);

    const list = await request(server)
      .get('/api/v1/appointments')
      .query({ chamberDayId: created.body.data.chamberDayId })
      .set(reception.headers)
      .expect(200);
    expect(list.body.data.items).toHaveLength(1);

    const availability = await request(server)
      .get(`/api/v1/chamber-days/${created.body.data.chamberDayId}/availability`)
      .set(reception.headers)
      .expect(200);
    expect(availability.body.data.counts).toMatchObject({ booked: 1, walkIns: 0, nonCancelled: 1 });

    const cancelled = await request(server)
      .post(`/api/v1/appointments/${created.body.data.id}/cancel`)
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: created.body.data.rowVersion, reason: 'PATIENT_REQUEST' })
      .expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    const serial = await api.runtime.prisma.serial.findFirstOrThrow({ where: { tenantId: s.tenantId } });
    expect(serial.status).toBe('CANCELLED');
  });

  it('a prepaid chamber answers FEATURE_DISABLED while payments are absent (C-45)', async () => {
    const s = await chamberSetup('prepaid');
    const reception = await staff(s.tenantId, 'receptionist');
    const prepaid = await request(server)
      .patch(`/api/v1/chambers/${s.chamber.id}`)
      .set(s.admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: s.chamber.rowVersion, chamberPaymentMode: 'PREPAID_REQUIRED' })
      .expect(200);
    expect(prepaid.body.data.chamberPaymentMode).toBe('PREPAID_REQUIRED');
    const p = await patient(reception.headers, 'Sadia Begum');
    const refused = await request(server)
      .post('/api/v1/appointments')
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ chamberId: s.chamber.id, localDate: inDays(1), patientId: p.id, careMode: 'PHYSICAL' })
      .expect(409);
    expect(refused.body).toMatchObject({
      code: 'FEATURE_DISABLED',
      details: { reason: 'PAYMENTS_NOT_AVAILABLE' },
    });
    expect(await api.runtime.prisma.appointment.count({ where: { tenantId: s.tenantId } })).toBe(0);
  });

  it('a patient context books and cancels its own appointment and sees only its own list', async () => {
    const s = await chamberSetup('ctx');
    const reception = await staff(s.tenantId, 'receptionist');
    const mine = await patient(reception.headers, 'Own Patient');
    const other = await patient(reception.headers, 'Other Patient');
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

    const otherAppointment = await request(server)
      .post('/api/v1/appointments')
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ chamberId: s.chamber.id, localDate: inDays(1), patientId: other.id, careMode: 'PHYSICAL' })
      .expect(201);

    const booked = await request(server)
      .post('/api/v1/appointments')
      .set(ctx)
      .set('idempotency-key', idem())
      .send({ chamberId: s.chamber.id, localDate: inDays(1), patientId: mine.id, careMode: 'PHYSICAL' })
      .expect(201);
    expect(booked.body.data).toMatchObject({ bookedOnBehalf: 'SELF', status: 'BOOKED' });

    // Booking for somebody else through a patient context is refused.
    await request(server)
      .post('/api/v1/appointments')
      .set(ctx)
      .set('idempotency-key', idem())
      .send({ chamberId: s.chamber.id, localDate: inDays(2), patientId: other.id, careMode: 'PHYSICAL' })
      .expect(403);

    const mineList = await request(server).get('/api/v1/me/appointments').set(ctx).expect(200);
    expect(mineList.body.data.items.map((a: { id: string }) => a.id)).toEqual([booked.body.data.id]);
    await request(server).get(`/api/v1/appointments/${otherAppointment.body.data.id}`).set(ctx).expect(403);

    const cancelled = await request(server)
      .post(`/api/v1/appointments/${booked.body.data.id}/cancel`)
      .set(ctx)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: booked.body.data.rowVersion, reason: 'PATIENT_REQUEST' })
      .expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const audit = await api.runtime.prisma.auditLog.findFirstOrThrow({
      where: { tenantId: s.tenantId, action: 'APPOINTMENT_CANCELLED' },
    });
    expect(audit).toMatchObject({ actingAs: 'SELF', onBehalfOfPatientId: mine.id });
  });
});
