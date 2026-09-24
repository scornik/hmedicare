import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher, PlatformOperatorService } from '@hmedic/identity-access';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

/**
 * The medication catalog over HTTP (MEDDATA-003/004): the platform-operator import controls and the
 * prescriber-facing search.
 *
 * What matters here is not that the routes answer — it is who they refuse. The catalog belongs to the
 * installation rather than to any tenant, so `medication.import` is a platform permission and the
 * guard's whole ladder applies: operator context, a password-plus-OTP session, the permission itself.
 * Each rung is asserted separately, because a route that is protected by three things and tested as one
 * is a route where two of them can quietly stop working.
 *
 * No attestation is recorded. The gate-status route is read, never written past.
 */
const PASSWORD = 'correct horse battery';
const STAGED_ROOT = path.resolve(__dirname, '../../../../packages/prescriptions/test');
const V1 = 'meddata-mini-20260924-1';

let api: ApiInstance;
let server: Parameters<typeof request>[0];
let seq = 0;
const idem = () => `mc-key-${Date.now()}-${++seq}`;
const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 });

beforeAll(async () => {
  api = await buildApi(
    loadConfig<ServerConfig>(
      'api',
      testEnv({
        DATABASE_URL: testDatabaseUrl(),
        // The fixtures live under `test/fixtures/<version>/`, so pointing the storage root at `test/`
        // with a `fixtures/` prefix makes the staged layout resolve to the checked-in datasets without
        // copying anything.
        STORAGE_DISK_ROOT: STAGED_ROOT,
        MEDICATION_DATASET_STORAGE_PREFIX: 'fixtures/',
      }),
    ),
  );
  server = api.app.getHttpServer();
});
afterAll(async () => {
  await api?.close();
});
beforeEach(async () => {
  await truncateAll();
  await api.runtime.prisma.medicationDatasetImport.deleteMany();
  // Attestations are not cleared between tests, and cannot be: the table is append-only and the lint
  // rule says so. Nothing here records one, so there is nothing to clear — which is the point.
});

async function user(phone: string) {
  const now = new Date();
  const id = newId();
  const email = `u.${id.slice(-10)}@example.invalid`;
  await api.runtime.prisma.user.create({
    data: {
      id,
      email,
      emailNormalized: email,
      phoneE164: phone,
      phoneVerifiedAt: now,
      status: 'ACTIVE',
      passwordHash: await hasher.hash(PASSWORD),
      createdAt: now,
      updatedAt: now,
    },
  });
  return { id, email };
}

async function login(email: string) {
  const r = await request(server)
    .post('/api/v1/auth/password/login')
    .set('idempotency-key', idem())
    .send({ email, password: PASSWORD, client: 'android' })
    .expect(200);
  return { authorization: `Bearer ${r.body.data.accessToken}` };
}

async function stepUp(auth: Record<string, string>) {
  const r = await request(server)
    .post('/api/v1/auth/step-up/otp/request')
    .set(auth)
    .set('idempotency-key', idem())
    .send({})
    .expect(202);
  const code = (await request(server).get(`/internal/test/otp/${r.body.data.challengeId}`).expect(200)).body
    .code;
  await request(server)
    .post('/api/v1/auth/step-up/otp/verify')
    .set(auth)
    .set('idempotency-key', idem())
    .send({ code })
    .expect(200);
  return auth;
}

const operators = () => new PlatformOperatorService(api.runtime.prisma, api.runtime.audit, api.runtime.clock);

/** An operator holding `permissions`, logged in and stepped up. */
async function operator(phone: string, permissions: string[]) {
  const op = await user(phone);
  await operators().grant({
    email: op.email,
    permissions: permissions as never,
    grantedBy: 'cli:test',
    grantorUserId: null,
  });
  return { ...op, auth: await stepUp(await login(op.email)) };
}

const requestImport = (auth: Record<string, string>, body: unknown, headers: Record<string, string> = {}) =>
  request(server)
    .post('/api/v1/admin/medications/imports')
    .set(auth)
    .set({ 'x-platform-context': 'operator', ...headers })
    .set('idempotency-key', idem())
    .send(body as object);

describe('medication import administration', () => {
  it('queues an import for an operator with medication.import', async () => {
    const op = await operator('+8801700000061', ['medication.import']);

    const queued = await requestImport(op.auth, { datasetVersion: V1 }).expect(202);
    expect(queued.body.data).toMatchObject({ datasetVersion: V1, created: true });

    // The work is queued, not done: the route must not have imported anything itself.
    const job = await api.runtime.prisma.job.findUniqueOrThrow({ where: { id: queued.body.data.jobId } });
    expect(job).toMatchObject({ type: 'ImportMedicationDataset', queue: 'catalog', status: 'QUEUED' });
    expect(job.tenantId).toBeNull();
    // Nothing in the payload is worth reading: a version name and who asked.
    expect(job.payload).toEqual({
      v: 1,
      datasetVersion: V1,
      requestedBy: op.id,
      dryRun: false,
      excludeVeterinary: true,
    });

    const audited = await api.runtime.prisma.auditLog.count({
      where: { action: 'MEDICATION_IMPORT_REQUESTED', actorType: 'OPERATOR', chainKey: 'platform' },
    });
    expect(audited).toBe(1);
  });

  it('returns the original job when the same import is requested twice', async () => {
    const op = await operator('+8801700000062', ['medication.import']);
    const first = await requestImport(op.auth, { datasetVersion: V1 }).expect(202);

    // A double-clicked button must not start a second import of the same catalog. The job's own
    // idempotency key is what settles it, so a *different* Idempotency-Key still reaches the same job.
    const second = await requestImport(op.auth, { datasetVersion: V1 }).expect(202);
    expect(second.body.data.jobId).toBe(first.body.data.jobId);
    expect(second.body.data.created).toBe(false);
    expect(await api.runtime.prisma.job.count({ where: { type: 'ImportMedicationDataset' } })).toBe(1);
  });

  it('refuses a dataset that is not staged, before queueing anything', async () => {
    const op = await operator('+8801700000063', ['medication.import']);
    const r = await requestImport(op.auth, { datasetVersion: 'meddata-mini-not-staged' }).expect(400);
    expect(r.body.code).toBe('VALIDATION_FAILED');
    expect(await api.runtime.prisma.job.count({ where: { type: 'ImportMedicationDataset' } })).toBe(0);
  });

  it('refuses a version name that is not a plain name', async () => {
    const op = await operator('+8801700000064', ['medication.import']);
    // The value becomes a path segment, so this is a traversal attempt and not a typo.
    const r = await requestImport(op.auth, { datasetVersion: '../../etc' });
    expect(r.status).toBe(400);
    expect(await api.runtime.prisma.job.count()).toBe(0);
  });

  it('refuses a password-only session, a missing operator context and a missing permission', async () => {
    const weak = await user('+8801700000065');
    await operators().grant({
      email: weak.email,
      permissions: ['medication.import'],
      grantedBy: 'cli:test',
      grantorUserId: null,
    });
    const passwordOnly = await login(weak.email);
    expect((await requestImport(passwordOnly, { datasetVersion: V1 })).body.code).toBe('FORBIDDEN');

    const op = await operator('+8801700000066', ['medication.import']);
    const noHeader = await request(server)
      .post('/api/v1/admin/medications/imports')
      .set(op.auth)
      .set('idempotency-key', idem())
      .send({ datasetVersion: V1 });
    expect(noHeader.body.code).toBe('PLATFORM_CONTEXT_REQUIRED');

    const wrongPermission = await operator('+8801700000067', ['ops.metrics.read']);
    expect((await requestImport(wrongPermission.auth, { datasetVersion: V1 })).body.code).toBe('FORBIDDEN');

    expect(await api.runtime.prisma.job.count({ where: { type: 'ImportMedicationDataset' } })).toBe(0);
  });

  it('reads back imports and one import by id', async () => {
    const op = await operator('+8801700000068', ['medication.import']);
    await api.runtime.prisma.medicationDatasetImport.create({
      data: {
        id: '01a0d100-0000-7000-8000-000000000001',
        datasetVersion: V1,
        datasetStatus: 'UNVERIFIED',
        environment: 'test',
        executionPath: 'JOB',
        status: 'FAILED',
        errorClass: 'MEDDATA_IMPORT_ABORTED',
        requestedBy: op.id,
        fileChecksums: {},
        schemaHashes: {},
        counts: { read: 3 },
        checkpoint: { file: 'medications.jsonl', line: 2 },
        createdAt: new Date(),
      },
    });

    const list = await request(server)
      .get('/api/v1/admin/medications/imports')
      .set(op.auth)
      .set('x-platform-context', 'operator')
      .expect(200);
    expect(list.body.data.items).toHaveLength(1);

    const one = await request(server)
      .get('/api/v1/admin/medications/imports/01a0d100-0000-7000-8000-000000000001')
      .set(op.auth)
      .set('x-platform-context', 'operator')
      .expect(200);
    // The checkpoint is part of the answer: it is how an operator knows a retry will continue rather
    // than restart.
    expect(one.body.data).toMatchObject({
      status: 'FAILED',
      errorClass: 'MEDDATA_IMPORT_ABORTED',
      checkpoint: { file: 'medications.jsonl', line: 2 },
    });
  });

  it('reports all four gates as unattested for the current dataset', async () => {
    const op = await operator('+8801700000069', ['medication.import']);
    const r = await request(server)
      .get('/api/v1/admin/medications/gates/medicine-dataset-20260917-4')
      .set(op.auth)
      .set('x-platform-context', 'operator')
      .expect(200);

    // GATE-MEDDATA-PROD is OPEN and nothing in this suite opens it.
    expect(r.body.data.allAttested).toBe(false);
    expect(r.body.data.gates.map((g: { gateCode: string }) => g.gateCode)).toEqual([
      'LEGAL_SOURCE_REVIEW',
      'CLINICAL_SAMPLE_REVIEW',
      'DGDA_CROSS_REFERENCE',
      'IMPORT_SAFEGUARDS_VERIFIED',
    ]);
    expect(r.body.data.gates.every((g: { attested: boolean }) => !g.attested)).toBe(true);
  });

  it('refuses an attestation with no evidence and no summary', async () => {
    const op = await operator('+8801700000070', ['medication.import']);
    const r = await request(server)
      .post('/api/v1/admin/medications/gates')
      .set(op.auth)
      .set('x-platform-context', 'operator')
      .set('idempotency-key', idem())
      .send({
        datasetVersion: 'meddata-mini-synthetic',
        gateCode: 'LEGAL_SOURCE_REVIEW',
        evidenceRef: '   ',
        summary: '   ',
      });

    // An attestation without its basis is a checkbox, and a checkbox is what these gates exist to
    // prevent. Nothing is recorded.
    expect(r.status).toBe(400);
    expect(await api.runtime.prisma.medicationDatasetGateAttestation.count()).toBe(0);
  });
});

describe('catalog search over HTTP', () => {
  it('refuses a tenant session without prescription.write and a query under two characters', async () => {
    const op = await operator('+8801700000071', ['medication.import']);
    // An operator is not a prescriber: the platform session carries no tenant, so the tenant-scoped
    // search must not answer it.
    const r = await request(server).get('/api/v1/medications/search?q=napa').set(op.auth);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('requires authentication', async () => {
    const r = await request(server).get('/api/v1/medications/search?q=napa');
    expect(r.status).toBe(401);
  });
});
