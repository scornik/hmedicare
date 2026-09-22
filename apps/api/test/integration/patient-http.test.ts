import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher } from '@hmedic/identity-access';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

// PAT-003…PAT-007 over HTTP: permissions, patient context header, guardian scope, idempotency (T10-style
// tenant isolation for every new route). Synthetic data only.
const PASSWORD = 'correct horse battery';
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let seq = 0;
const idem = () => `pt-key-${Date.now()}-${++seq}`;
const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 });
let phoneSeq = 300;
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
      rolePermissionsVersion: 2,
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

const createBody = (legalName: string, phone: string, extra: Record<string, unknown> = {}) => ({
  legalName,
  contacts: [{ type: 'PHONE', value: phone, relationship: 'SELF', isPreferred: true }],
  consents: ['care'],
  ...extra,
});

describe('patients over HTTP', () => {
  it('receptionist creates and searches; billing_manager cannot create; other tenant sees nothing; idempotent replay', async () => {
    const t = await tenant('http');
    const reception = await staff(t, 'receptionist');
    const billing = await staff(t, 'billing_manager'); // patient.read only
    const other = await staff(await tenant('other'), 'clinic_admin');
    const phone = nextPhone();

    await request(server)
      .post('/api/v1/patients')
      .set(billing.headers)
      .set('idempotency-key', idem())
      .send(createBody('Nusrat Jahan', phone))
      .expect(403);
    const key = idem();
    const created = await request(server)
      .post('/api/v1/patients')
      .set(reception.headers)
      .set('idempotency-key', key)
      .send(createBody('Nusrat Jahan', phone))
      .expect(201);
    const id = created.body.data.id as string;
    expect(created.body.data.medicalRecordNumber).toMatch(/^P-/);
    const replay = await request(server)
      .post('/api/v1/patients')
      .set(reception.headers)
      .set('idempotency-key', key)
      .send(createBody('Nusrat Jahan', phone))
      .expect(201);
    expect(replay.body.data.id).toBe(id);
    expect(replay.body.meta.replayed).toBe(true);
    await request(server)
      .post('/api/v1/patients')
      .set(reception.headers)
      .send(createBody('X Y', nextPhone()))
      .expect(400);

    const found = await request(server)
      .get('/api/v1/patients')
      .query({ query: 'nusrat' })
      .set(billing.headers)
      .expect(200);
    expect(found.body.data.items.map((i: { id: string }) => i.id)).toEqual([id]);
    expect(JSON.stringify(found.body)).not.toContain(phone);
    await request(server).get(`/api/v1/patients/${id}`).set(other.headers).expect(404);
    expect(
      (await request(server).get('/api/v1/patients').query({ phone }).set(other.headers).expect(200)).body
        .data.items,
    ).toEqual([]);
    await request(server)
      .patch(`/api/v1/patients/${id}`)
      .set(other.headers)
      .send({ expectedRowVersion: 1, displayName: 'x' })
      .expect(404);
    await request(server)
      .get('/api/v1/patients')
      .query({ query: 'nusrat' })
      .set({ authorization: reception.headers.authorization })
      .expect(400);
  });

  it('duplicate review: 409 with candidate ids, then created with duplicateReview; merge needs patient.merge', async () => {
    const t = await tenant('dup');
    const admin = await staff(t, 'clinic_admin');
    const billing = await staff(t, 'billing_manager'); // no patient.merge
    const phone = nextPhone();
    const first = (
      await request(server)
        .post('/api/v1/patients')
        .set(admin.headers)
        .set('idempotency-key', idem())
        .send(createBody('Rahima Khatun', phone, { dateOfBirth: '1990-05-01' }))
        .expect(201)
    ).body.data;
    const dup = await request(server)
      .post('/api/v1/patients')
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send(createBody('Rohima Khatun', phone, { birthYear: 1990 }))
      .expect(409);
    expect(dup.body.code).toBe('DUPLICATE_PATIENT_REVIEW_REQUIRED');
    expect(dup.body.details.candidateIds).toBe(first.id);
    const check = await request(server)
      .post('/api/v1/patients/duplicate-check')
      .set(admin.headers)
      .send({ legalName: 'Rohima Khatun', phones: [phone] })
      .expect(200);
    expect(check.body.data.reviewRequired).toBe(true);
    const second = (
      await request(server)
        .post('/api/v1/patients')
        .set(admin.headers)
        .set('idempotency-key', idem())
        .send(
          createBody('Rohima Khatun', phone, {
            birthYear: 1990,
            duplicateReview: { acknowledgedCandidateIds: [first.id], reason: 'confirmed different' },
          }),
        )
        .expect(201)
    ).body.data;

    await request(server)
      .post(`/api/v1/patients/${second.id}/merge-cases`)
      .set(billing.headers)
      .set('idempotency-key', idem())
      .send({ targetPatientId: first.id, reason: 'same' })
      .expect(403);
    const opened = (
      await request(server)
        .post(`/api/v1/patients/${second.id}/merge-cases`)
        .set(admin.headers)
        .set('idempotency-key', idem())
        .send({ targetPatientId: first.id, reason: 'same person' })
        .expect(201)
    ).body.data;
    const list = await request(server)
      .get('/api/v1/merge-cases')
      .query({ status: 'OPEN' })
      .set(admin.headers)
      .expect(200);
    expect(list.body.data.items.map((m: { id: string }) => m.id)).toEqual([opened.id]);
    const approved = await request(server)
      .post(`/api/v1/merge-cases/${opened.id}/approve`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: opened.rowVersion })
      .expect(200);
    expect(approved.body.data.status).toBe('APPROVED');
    const resolved = await request(server)
      .get(`/api/v1/patients/${second.id}`)
      .set(admin.headers)
      .expect(200);
    expect(resolved.body.data.id).toBe(first.id);
  });
});

describe('patient context over HTTP (AUTHORIZATION-MATRIX §4)', () => {
  it('OTP login auto-links a verified phone; the context reads only its own patient; guardians need scope', async () => {
    const t = await tenant('ctx');
    const admin = await staff(t, 'clinic_admin');
    const mine = nextPhone();
    const otherPhone = nextPhone();
    const me = (
      await request(server)
        .post('/api/v1/patients')
        .set(admin.headers)
        .set('idempotency-key', idem())
        .send(createBody('Own Patient', mine))
        .expect(201)
    ).body.data;
    const child = (
      await request(server)
        .post('/api/v1/patients')
        .set(admin.headers)
        .set('idempotency-key', idem())
        .send(createBody('Child One', otherPhone, { birthYear: 2019 }))
        .expect(201)
    ).body.data;
    await api.runtime.prisma.patientContact.updateMany({
      where: { tenantId: t },
      data: { verificationStatus: 'VERIFIED' },
    });

    const user = await otpLogin(mine);
    const contexts = await request(server)
      .get('/api/v1/me/patient-contexts')
      .set({ authorization: user.authorization })
      .expect(200);
    expect(contexts.body.data).toEqual([
      expect.objectContaining({ tenantId: t, patientId: me.id, relationship: 'SELF' }),
    ]);

    const ctx = { authorization: user.authorization, 'x-tenant-id': t, 'x-patient-context': me.id };
    const own = await request(server).get(`/api/v1/patients/${me.id}`).set(ctx).expect(200);
    expect(own.body.data.id).toBe(me.id);
    // Another patient in the same tenant: the context header names a patient this user is not linked to.
    await request(server)
      .get(`/api/v1/patients/${child.id}`)
      .set({ ...ctx, 'x-patient-context': child.id })
      .expect(403);
    // A patient user without a membership cannot use staff routes.
    await request(server)
      .get('/api/v1/patients')
      .query({ query: 'own' })
      .set({ authorization: user.authorization, 'x-tenant-id': t })
      .expect(403);
    await request(server)
      .post('/api/v1/patients')
      .set({ authorization: user.authorization, 'x-tenant-id': t })
      .set('idempotency-key', idem())
      .send(createBody('Z', nextPhone()))
      .expect(403);
    // Patient context on a route that does not accept it.
    await request(server).get('/api/v1/merge-cases').set(ctx).expect(403);

    // Guardianship: requested by the user (PENDING) → no access; activated by staff with a limited scope.
    const requested = (
      await request(server)
        .post(`/api/v1/patients/${child.id}/guardianships`)
        .set({ authorization: user.authorization, 'x-tenant-id': t })
        .set('idempotency-key', idem())
        .send({ relationship: 'PARENT', authorityScope: ['VIEW_RECORDS'] })
        .expect(201)
    ).body.data;
    const childCtx = { ...ctx, 'x-patient-context': child.id };
    await request(server).get(`/api/v1/patients/${child.id}`).set(childCtx).expect(403);
    await request(server)
      .post(`/api/v1/guardianships/${requested.id}/activate`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({
        expectedRowVersion: requested.rowVersion,
        verificationMethod: 'STAFF_VERIFIED_DOCUMENT',
        evidenceRef: 'DEMO',
      })
      .expect(200);
    expect(
      (await request(server).get(`/api/v1/patients/${child.id}`).set(childCtx).expect(200)).body.data.id,
    ).toBe(child.id);
    // GIVE_CONSENT is not in the scope → FORBIDDEN, audited as AUTHZ_DENIED.
    await request(server)
      .post(`/api/v1/patients/${child.id}/consents`)
      .set(childCtx)
      .set('idempotency-key', idem())
      .send({ purpose: 'sms' })
      .expect(403);
    const denied = await api.runtime.prisma.auditLog.findMany({
      where: { tenantId: t, action: 'AUTHZ_DENIED' },
    });
    expect(denied.some((a) => JSON.stringify(a.metadata).includes('patient_scope:GIVE_CONSENT'))).toBe(true);
    // Own consent works and records SELF.
    const consent = await request(server)
      .post(`/api/v1/patients/${me.id}/consents`)
      .set(ctx)
      .set('idempotency-key', idem())
      .send({ purpose: 'sms' })
      .expect(201);
    expect(consent.body.data.givenByRelationship).toBe('SELF');
    const picker = await request(server)
      .get('/api/v1/me/patient-contexts')
      .set({ authorization: user.authorization })
      .expect(200);
    expect(picker.body.data).toHaveLength(2);
  });
});
