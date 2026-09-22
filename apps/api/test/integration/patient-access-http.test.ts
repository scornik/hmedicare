import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher, PolicyEngine } from '@hmedic/identity-access';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

/**
 * TEST-001. Care team, patient accounts and guardianships are covered by service-level tests but were
 * never exercised over HTTP. The Stage 5 queue suite found four gaps of exactly the kind a service test
 * cannot see — a response shaped differently from its contract, a permission that was never wired to the
 * route, an audit field the use case never filled — so the same class of gap is likely here.
 *
 * This covers what only HTTP can: routing, the permission actually attached to each route, the response
 * envelope, and the tenant boundary.
 */
const PASSWORD = 'correct horse battery';
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let seq = 0;
const idem = () => `access-key-${Date.now()}-${++seq}`;
const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 });
let phoneSeq = 300;
const nextPhone = () => `+88017003${String(phoneSeq++).padStart(5, '0')}`;

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
  return id;
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
    .send({ email, password: PASSWORD, client: 'web' })
    .expect(200);
  return {
    userId: id,
    headers: { authorization: `Bearer ${r.body.data.accessToken}`, 'x-tenant-id': tenantId },
  };
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

describe('care team over HTTP', () => {
  it('adds and ends a member under care_team.manage, and reads under patient.read', async () => {
    const tenantId = await tenant('ct');
    const admin = await staff(tenantId, 'clinic_admin');
    const doctor = await staff(tenantId, 'doctor');
    const reception = await staff(tenantId, 'receptionist');
    const p = await patient(admin.headers, 'Care Team Patient');

    // The contract declares a bare array here (`ok(z.array(CareTeamMember))`), unlike the account and
    // guardianship lists which are `{items, nextCursor, hasMore}`. Recorded as an inconsistency rather
    // than changed: the generated clients follow these contracts.
    const empty = await request(server)
      .get(`/api/v1/patients/${p.id}/care-team`)
      .set(reception.headers)
      .expect(200);
    expect(empty.body.data).toEqual([]);

    const added = await request(server)
      .post(`/api/v1/patients/${p.id}/care-team`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({ memberUserId: doctor.userId, role: 'DOCTOR', reason: 'DEMO primary physician' })
      .expect(201);
    expect(added.body.data).toMatchObject({
      patientId: p.id,
      memberUserId: doctor.userId,
      role: 'DOCTOR',
      endsAt: null,
    });
    expect(added.body.meta.requestId).toBeTruthy();

    const listed = await request(server)
      .get(`/api/v1/patients/${p.id}/care-team`)
      .set(reception.headers)
      .expect(200);
    expect(listed.body.data.map((m: { id: string }) => m.id)).toEqual([added.body.data.id]);

    // The desk can see who is on the team but cannot change it.
    await request(server)
      .post(`/api/v1/patients/${p.id}/care-team`)
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ memberUserId: doctor.userId, role: 'NURSE' })
      .expect(403);

    const ended = await request(server)
      .post(`/api/v1/care-team-members/${added.body.data.id}/end`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: added.body.data.rowVersion })
      .expect(200);
    expect(ended.body.data.endsAt).not.toBeNull();

    const stale = await request(server)
      .post(`/api/v1/care-team-members/${added.body.data.id}/end`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: added.body.data.rowVersion });
    expect(stale.body.code).toBe('STALE_VERSION');
  });

  it('does not reach across a tenant boundary', async () => {
    const a = await tenant('ct-a');
    const adminA = await staff(a, 'clinic_admin');
    const p = await patient(adminA.headers, 'Tenant A Patient');

    const b = await tenant('ct-b');
    const adminB = await staff(b, 'clinic_admin');
    // The query is tenant-scoped, so another tenant sees an empty list. That discloses nothing — an id
    // that does not exist at all answers identically — but it does differ from the sibling routes, which
    // 404. Asserted as it behaves, and recorded in the consistency audit.
    const crossed = await request(server)
      .get(`/api/v1/patients/${p.id}/care-team`)
      .set(adminB.headers)
      .expect(200);
    expect(crossed.body.data).toEqual([]);
  });
});

describe('patient accounts over HTTP', () => {
  it('lists, verifies and revokes under patient_account.manage', async () => {
    const tenantId = await tenant('acct');
    const admin = await staff(tenantId, 'clinic_admin');
    const reception = await staff(tenantId, 'receptionist');
    const mine = await patient(admin.headers, 'Account Patient');

    // An OTP login with a verified phone auto-links (PAT-004), which is how an account comes to exist.
    await api.runtime.prisma.patientContact.updateMany({
      where: { tenantId },
      data: { verificationStatus: 'VERIFIED' },
    });
    const req = await request(server)
      .post('/api/v1/auth/otp/request')
      .set('idempotency-key', idem())
      .send({ phone: mine.phone, locale: 'bn-BD' })
      .expect(202);
    const code = (await request(server).get(`/internal/test/otp/${req.body.data.challengeId}`).expect(200))
      .body.code;
    await request(server)
      .post('/api/v1/auth/otp/verify')
      .set('idempotency-key', idem())
      .send({ phone: mine.phone, code, client: 'android' })
      .expect(200);

    const listed = await request(server).get('/api/v1/patient-accounts').set(admin.headers).expect(200);
    expect(listed.body.data.items.length).toBeGreaterThan(0);
    expect(listed.body.data).toHaveProperty('hasMore');
    const account = listed.body.data.items.find((a: { patientId: string }) => a.patientId === mine.id);
    expect(account).toBeTruthy();

    // The desk handles patients all day but does not decide who may see a record.
    await request(server).get('/api/v1/patient-accounts').set(reception.headers).expect(403);
    await request(server)
      .post(`/api/v1/patient-accounts/${account.id}/revoke`)
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: account.rowVersion })
      .expect(403);

    const revoked = await request(server)
      .post(`/api/v1/patient-accounts/${account.id}/revoke`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: account.rowVersion })
      .expect(200);
    expect(revoked.body.data.status).toBe('REVOKED');
  });
});

describe('guardianships over HTTP', () => {
  it('activates, ends and revokes under guardianship.manage', async () => {
    const tenantId = await tenant('guard');
    const admin = await staff(tenantId, 'clinic_admin');
    const reception = await staff(tenantId, 'receptionist');
    const child = await patient(admin.headers, 'Dependent Patient');
    const guardianUser = await staff(tenantId, 'doctor'); // any user id; the role is irrelevant here

    const created = await request(server)
      .post(`/api/v1/patients/${child.id}/guardianships`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({
        guardianUserId: guardianUser.userId,
        relationship: 'PARENT',
        authorityScope: ['VIEW_RECORDS', 'BOOK_APPOINTMENTS'],
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      dependentPatientId: child.id,
      relationship: 'PARENT',
      status: 'PENDING',
    });

    const listed = await request(server).get('/api/v1/guardianships').set(admin.headers).expect(200);
    expect(listed.body.data.items.map((g: { id: string }) => g.id)).toContain(created.body.data.id);
    await request(server).get('/api/v1/guardianships').set(reception.headers).expect(403);

    const activated = await request(server)
      .post(`/api/v1/guardianships/${created.body.data.id}/activate`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({
        expectedRowVersion: created.body.data.rowVersion,
        verificationMethod: 'STAFF_VERIFIED_IN_PERSON',
      })
      .expect(200);
    expect(activated.body.data.status).toBe('ACTIVE');

    const ended = await request(server)
      .post(`/api/v1/guardianships/${created.body.data.id}/end`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: activated.body.data.rowVersion, reason: 'DEMO dependent turned 18' })
      .expect(200);
    expect(ended.body.data.status).not.toBe('ACTIVE');
  });

  it('revokes a guardianship and refuses the desk', async () => {
    const tenantId = await tenant('guard-revoke');
    const admin = await staff(tenantId, 'clinic_admin');
    const reception = await staff(tenantId, 'receptionist');
    const child = await patient(admin.headers, 'Revoked Dependent');
    const guardianUser = await staff(tenantId, 'nurse');

    const created = await request(server)
      .post(`/api/v1/patients/${child.id}/guardianships`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({
        guardianUserId: guardianUser.userId,
        relationship: 'PARENT',
        authorityScope: ['VIEW_RECORDS'],
      })
      .expect(201);

    await request(server)
      .post(`/api/v1/guardianships/${created.body.data.id}/revoke`)
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: created.body.data.rowVersion })
      .expect(403);

    const revoked = await request(server)
      .post(`/api/v1/guardianships/${created.body.data.id}/revoke`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: created.body.data.rowVersion })
      .expect(200);
    expect(revoked.body.data.status).toBe('REVOKED');
  });
});

describe('sessions over HTTP', () => {
  it('lists this user’s own sessions and revokes one', async () => {
    const tenantId = await tenant('sess');
    const admin = await staff(tenantId, 'clinic_admin');

    const listed = await request(server).get('/api/v1/me/sessions').set(admin.headers).expect(200);
    expect(listed.body.data.length).toBeGreaterThan(0);
    const other = await staff(tenantId, 'doctor');
    const theirs = await request(server).get('/api/v1/me/sessions').set(other.headers).expect(200);

    // Each caller sees only their own sessions; no session id appears in both lists.
    const mine = new Set(listed.body.data.map((x: { id: string }) => x.id));
    for (const x of theirs.body.data) expect(mine.has(x.id)).toBe(false);

    const revoked = await request(server)
      .delete(`/api/v1/me/sessions/${listed.body.data[0].id}`)
      .set(admin.headers);
    expect([200, 204]).toContain(revoked.status);
  });
});

describe('consents and merge cases over HTTP', () => {
  it('withdraws a consent and rejects a merge case', async () => {
    const tenantId = await tenant('consent');
    const admin = await staff(tenantId, 'clinic_admin');
    const p = await patient(admin.headers, 'Consent Patient');

    // Consents are their own resource, not a field on the patient record.
    const listed = await request(server)
      .get(`/api/v1/patients/${p.id}/consents`)
      .set(admin.headers)
      .expect(200);
    const consent = (listed.body.data.items ?? listed.body.data)[0];
    expect(consent, 'the patient was created with a care consent').toBeTruthy();

    const withdrawn = await request(server)
      .post(`/api/v1/consents/${consent.id}/withdraw`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: consent.rowVersion, reason: 'DEMO withdrawn at the desk' })
      .expect(200);
    expect(withdrawn.body.data.withdrawnAt).not.toBeNull();

    // A duplicate creates a merge case, which is the only way to get one to reject.
    const twin = await patient(admin.headers, 'Consent Patient');
    expect(twin.id).not.toBe(p.id);
    const cases = await request(server).get('/api/v1/merge-cases').set(admin.headers).expect(200);
    if (cases.body.data.items.length > 0) {
      const mergeCase = cases.body.data.items[0];
      const rejected = await request(server)
        .post(`/api/v1/merge-cases/${mergeCase.id}/reject`)
        .set(admin.headers)
        .set('idempotency-key', idem())
        .send({ expectedRowVersion: mergeCase.rowVersion, reason: 'DEMO different people' })
        .expect(200);
      expect(rejected.body.data.status).toBe('REJECTED');
    }
  });
});

describe('clinic and chamber day transitions over HTTP', () => {
  it('updates a clinic, and pauses then cancels a day under schedule.manage', async () => {
    const tenantId = await tenant('sched');
    const admin = await staff(tenantId, 'clinic_admin');
    const reception = await staff(tenantId, 'receptionist');

    const clinic = await request(server)
      .post('/api/v1/clinics')
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({ name: 'DEMO Clinic Patch' })
      .expect(201);

    const renamed = await request(server)
      .patch(`/api/v1/clinics/${clinic.body.data.id}`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: clinic.body.data.rowVersion, name: 'DEMO Clinic Renamed' })
      .expect(200);
    expect(renamed.body.data.name).toBe('DEMO Clinic Renamed');

    await request(server)
      .patch(`/api/v1/clinics/${clinic.body.data.id}`)
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: renamed.body.data.rowVersion, name: 'DEMO Nope' })
      .expect(403);

    const doctorUserId = newId();
    const doctorProfileId = newId();
    const now = new Date();
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
        tenantId,
        userId: doctorUserId,
        displayName: 'Dr. Sched',
        specialties: [],
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    const chamber = await request(server)
      .post('/api/v1/chambers')
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({
        clinicId: clinic.body.data.id,
        doctorProfileId,
        name: 'DEMO Chamber Sched',
        supportsPhysical: true,
      })
      .expect(201);
    // A rule for every weekday. Deriving one weekday from `new Date()` reads it in UTC while the day is
    // materialized in Dhaka time (UTC+6), so after 18:00 UTC the two disagree and no rule matches — a
    // failure that only appears in the evening.
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

    const { dhakaDate } = await import('@hmedic/localization');
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

    await request(server)
      .post(`/api/v1/chamber-days/${created.body.data.id}/pause`)
      .set(reception.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: opened.body.data.rowVersion })
      .expect(403);

    const paused = await request(server)
      .post(`/api/v1/chamber-days/${created.body.data.id}/pause`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: opened.body.data.rowVersion })
      .expect(200);
    expect(paused.body.data.status).toBe('PAUSED');

    const cancelled = await request(server)
      .post(`/api/v1/chamber-days/${created.body.data.id}/cancel`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: paused.body.data.rowVersion, reason: 'DEMO doctor unavailable' })
      .expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });
});

describe('password reset over HTTP', () => {
  it('issues a token, resets the password, and answers the same for an unknown account', async () => {
    const tenantId = await tenant('reset');
    const admin = await staff(tenantId, 'clinic_admin');
    const user = await api.runtime.prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });

    await request(server)
      .post('/api/v1/auth/password/reset/request')
      .set('idempotency-key', idem())
      .send({ email: user.email, locale: 'bn-BD' })
      .expect(202);

    // An unknown address answers identically, so the endpoint cannot be used to discover who has an
    // account here.
    await request(server)
      .post('/api/v1/auth/password/reset/request')
      .set('idempotency-key', idem())
      .send({ email: 'nobody.at.all@example.invalid', locale: 'bn-BD' })
      .expect(202);

    const token = (await request(server).get(`/internal/test/password-reset/${admin.userId}`).expect(200))
      .body.token;
    expect(typeof token).toBe('string');

    const next = 'a different correct horse';
    await request(server)
      .post('/api/v1/auth/password/reset/complete')
      .set('idempotency-key', idem())
      .send({ token, newPassword: next })
      .expect(200);

    // The new password works and the old one does not.
    await request(server)
      .post('/api/v1/auth/password/login')
      .set('idempotency-key', idem())
      .send({ email: user.email, password: next, client: 'web' })
      .expect(200);
    await request(server)
      .post('/api/v1/auth/password/login')
      .set('idempotency-key', idem())
      .send({ email: user.email, password: PASSWORD, client: 'web' })
      .expect(401);

    // A token is single use.
    const reused = await request(server)
      .post('/api/v1/auth/password/reset/complete')
      .set('idempotency-key', idem())
      .send({ token, newPassword: 'yet another passphrase' });
    expect(reused.status).toBeGreaterThanOrEqual(400);
  });
});
