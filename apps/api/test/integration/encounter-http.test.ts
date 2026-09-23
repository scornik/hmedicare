import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher, PolicyEngine } from '@hmedic/identity-access';
import { dhakaDate } from '@hmedic/localization';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

/**
 * Encounters over HTTP (CLIN-002), and the retirement of ADR-021.
 *
 * The case that matters most here is the covering doctor. ADR-021's interim transitions checked only
 * "is this the chamber's doctor", so a partner covering a sick colleague was refused at the door. That is
 * the reason these routes exist, so it is asserted directly rather than inferred from the unit tests.
 */
const PASSWORD = 'correct horse battery';
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let seq = 0;
const idem = () => `enc-key-${Date.now()}-${++seq}`;
const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 });
let phoneSeq = 500;
const nextPhone = () => `+88017005${String(phoneSeq++).padStart(5, '0')}`;

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
    .send({ email, password: PASSWORD, client: 'web' })
    .expect(200);
  return {
    userId: id,
    headers: { authorization: `Bearer ${r.body.data.accessToken}`, 'x-tenant-id': tenantId },
  };
}

/** A doctor with a profile, which is what assignment is defined in terms of. */
async function doctor(tenantId: string, label: string) {
  const s = await staff(tenantId, 'doctor');
  const now = new Date();
  const profileId = newId();
  await api.runtime.prisma.doctorProfile.create({
    data: {
      id: profileId,
      tenantId,
      userId: s.userId,
      displayName: `Dr. ${label}`,
      specialties: [],
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  return { ...s, profileId };
}

/** A chamber owned by `owner`, open today, with one patient called to be seen. */
async function calledSerial(label: string) {
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
  const owner = await doctor(tenantId, `${label}-owner`);

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
      doctorProfileId: owner.profileId,
      name: `DEMO Chamber ${label}`,
      supportsPhysical: true,
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
  const created = await request(server)
    .post('/api/v1/chamber-days')
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({ chamberId: chamber.body.data.id, localDate: dhakaDate(new Date()) })
    .expect(201);
  const opened = await request(server)
    .post(`/api/v1/chamber-days/${created.body.data.id}/open`)
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({ expectedRowVersion: created.body.data.rowVersion })
    .expect(200);

  const patient = await request(server)
    .post('/api/v1/patients')
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({
      legalName: 'SYNTHETIC Encounter Patient',
      contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'SELF', isPreferred: true }],
      consents: ['care'],
    })
    .expect(201);
  const walkIn = await request(server)
    .post(`/api/v1/chamber-days/${opened.body.data.id}/walk-ins`)
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({ patientId: patient.body.data.id, careMode: 'PHYSICAL' })
    .expect(201);
  const called = await request(server)
    .post(`/api/v1/serials/${walkIn.body.data.id}/call`)
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({ expectedRowVersion: walkIn.body.data.rowVersion })
    .expect(200);

  return {
    tenantId,
    admin,
    owner,
    chamberId: chamber.body.data.id,
    patientId: patient.body.data.id,
    serial: called.body.data,
  };
}

describe('encounters over HTTP', () => {
  it('runs a consultation from a called serial to a completed record', async () => {
    const s = await calledSerial('flow');

    const started = await request(server)
      .post(`/api/v1/serials/${s.serial.id}/encounter`)
      .set(s.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: s.serial.rowVersion })
      .expect(201);
    expect(started.body.data).toMatchObject({
      status: 'IN_PROGRESS',
      serialId: s.serial.id,
      patientId: s.patientId,
      doctorProfileId: s.owner.profileId,
      coveringDoctorProfileId: null,
      legacyInterim: false,
    });

    const read = await request(server)
      .get(`/api/v1/encounters/${started.body.data.id}`)
      .set(s.owner.headers)
      .expect(200);
    expect(read.body.data.id).toBe(started.body.data.id);

    const completed = await request(server)
      .post(`/api/v1/encounters/${started.body.data.id}/complete`)
      .set(s.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: started.body.data.rowVersion })
      .expect(200);
    expect(completed.body.data.status).toBe('COMPLETED');

    // The serial finished with it, in the same transaction.
    const serial = await request(server)
      .get(`/api/v1/serials/${s.serial.id}`)
      .set(s.admin.headers)
      .expect(200);
    expect(serial.body.data.status).toBe('COMPLETED');
  });

  it('lets a covering doctor consult, which ADR-021 could not', async () => {
    const s = await calledSerial('covering');
    const locum = await doctor(s.tenantId, 'locum');

    // No grant yet: a doctor with the permission but no relationship to this patient is refused.
    await request(server)
      .post(`/api/v1/serials/${s.serial.id}/encounter`)
      .set(locum.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: s.serial.rowVersion })
      .expect(403);

    const now = new Date();
    await api.runtime.prisma.doctorCoverage.create({
      data: {
        id: newId(),
        tenantId: s.tenantId,
        coveredDoctorProfileId: s.owner.profileId,
        coveringDoctorProfileId: locum.profileId,
        startsAt: new Date(now.getTime() - 60 * 60_000),
        endsAt: new Date(now.getTime() + 60 * 60_000),
        reason: 'DEMO colleague unwell',
        status: 'ACTIVE',
        grantedByUserId: s.admin.userId,
        createdAt: now,
        updatedAt: now,
      },
    });

    const started = await request(server)
      .post(`/api/v1/serials/${s.serial.id}/encounter`)
      .set(locum.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: s.serial.rowVersion })
      .expect(201);
    // The grant is recorded on the encounter, not merely consulted: months later the record says who
    // treated the patient and under what authority.
    expect(started.body.data.coveringDoctorProfileId).toBe(locum.profileId);
    expect(started.body.data.doctorProfileId).toBe(locum.profileId);
  });

  it('refuses a covering doctor whose window has closed', async () => {
    const s = await calledSerial('expired');
    const locum = await doctor(s.tenantId, 'expired-locum');
    const now = new Date();
    await api.runtime.prisma.doctorCoverage.create({
      data: {
        id: newId(),
        tenantId: s.tenantId,
        coveredDoctorProfileId: s.owner.profileId,
        coveringDoctorProfileId: locum.profileId,
        startsAt: new Date(now.getTime() - 4 * 60 * 60_000),
        endsAt: new Date(now.getTime() - 60 * 60_000),
        reason: 'DEMO yesterday',
        status: 'ACTIVE',
        grantedByUserId: s.admin.userId,
        createdAt: now,
        updatedAt: now,
      },
    });
    // Coverage is checked at action time, not "has ever covered".
    await request(server)
      .post(`/api/v1/serials/${s.serial.id}/encounter`)
      .set(locum.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: s.serial.rowVersion })
      .expect(403);
  });

  it('refuses staff who hold no doctor profile', async () => {
    const s = await calledSerial('nurse');
    const nurse = await staff(s.tenantId, 'nurse'); // has encounter.start? no — and no profile either
    await request(server)
      .post(`/api/v1/serials/${s.serial.id}/encounter`)
      .set(nurse.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: s.serial.rowVersion })
      .expect(403);
  });

  it('interrupts and resumes without releasing the serial', async () => {
    const s = await calledSerial('interrupt');
    const started = await request(server)
      .post(`/api/v1/serials/${s.serial.id}/encounter`)
      .set(s.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: s.serial.rowVersion })
      .expect(201);

    const interrupted = await request(server)
      .post(`/api/v1/encounters/${started.body.data.id}/interrupt`)
      .set(s.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: started.body.data.rowVersion, reason: 'CALLED_AWAY' })
      .expect(200);
    expect(interrupted.body.data.status).toBe('INTERRUPTED');

    // The patient still holds the room while the doctor is out.
    const serial = await request(server)
      .get(`/api/v1/serials/${s.serial.id}`)
      .set(s.admin.headers)
      .expect(200);
    expect(serial.body.data.status).toBe('IN_CONSULTATION');

    const resumed = await request(server)
      .post(`/api/v1/encounters/${started.body.data.id}/resume`)
      .set(s.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: interrupted.body.data.rowVersion })
      .expect(200);
    expect(resumed.body.data.status).toBe('IN_PROGRESS');
  });

  it('refuses a second start on the same serial', async () => {
    const s = await calledSerial('twice');
    await request(server)
      .post(`/api/v1/serials/${s.serial.id}/encounter`)
      .set(s.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: s.serial.rowVersion })
      .expect(201);
    const second = await request(server)
      .post(`/api/v1/serials/${s.serial.id}/encounter`)
      .set(s.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: s.serial.rowVersion });
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(['STALE_VERSION', 'INVALID_TRANSITION', 'CONFLICT']).toContain(second.body.code);
  });
});

describe('ADR-021 retirement', () => {
  it('answers 410 on both interim routes, naming the replacement', async () => {
    const s = await calledSerial('retired');
    for (const [action, replacement] of [
      ['start-consultation', 'POST /api/v1/serials/{id}/encounter'],
      ['complete', 'POST /api/v1/encounters/{id}/complete'],
    ] as const) {
      const res = await request(server)
        .post(`/api/v1/serials/${s.serial.id}/${action}`)
        .set(s.owner.headers)
        .set('idempotency-key', idem())
        .send({ expectedRowVersion: s.serial.rowVersion });
      expect(res.status, action).toBe(410);
      expect(res.body.code, action).toBe('ENDPOINT_RETIRED');
      // A client on the old model is told where to go, not left guessing.
      expect(res.body.details?.replacement, action).toBe(replacement);
    }
  });

  it('leaves the serial untouched when an old client calls a retired route', async () => {
    const s = await calledSerial('retired-noop');
    await request(server)
      .post(`/api/v1/serials/${s.serial.id}/start-consultation`)
      .set(s.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: s.serial.rowVersion })
      .expect(410);
    const serial = await request(server)
      .get(`/api/v1/serials/${s.serial.id}`)
      .set(s.admin.headers)
      .expect(200);
    expect(serial.body.data.status).toBe('CALLED');
    expect(await api.runtime.prisma.encounter.count({ where: { tenantId: s.tenantId } })).toBe(0);
  });
});
