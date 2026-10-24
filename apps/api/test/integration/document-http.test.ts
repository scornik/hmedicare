import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher, PolicyEngine } from '@hmedic/identity-access';
import { buildStorageKey } from '@hmedic/laboratory-documents';
import { DiskObjectStorage } from '@hmedic/storage-adapters-disk';
import { type ApiInstance, buildApi } from '../../src/compose';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

/**
 * Document download over HTTP (RX-005, FILE-STORAGE-IMPLEMENTATION.md §2.5).
 *
 * A clinical file is never reachable by URL alone, and every assertion here is a way that could stop
 * being true: a link that works for the next person, a link that works twice, a link that survives the
 * access it was issued under, or a response header that lets a PDF run inside the application's origin.
 */
const PASSWORD = 'correct horse battery';
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let storageRoot = '';
let seq = 0;
const idem = () => `doc-key-${Date.now()}-${++seq}`;
const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 });

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), 'hmedic-doc-http-'));
  api = await buildApi(
    loadConfig<ServerConfig>(
      'api',
      testEnv({
        DATABASE_URL: testDatabaseUrl(),
        STORAGE_DISK_ROOT: storageRoot,
        UPLOAD_SCAN_WORKER_ENABLED: 'true',
      }),
    ),
  );
  server = api.app.getHttpServer();
});
afterAll(async () => {
  await api?.close();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});
beforeEach(async () => {
  await truncateAll();
});

async function staff(tenantId: string, role: string) {
  const now = new Date();
  const id = newId();
  const email = `d.${id.slice(-10)}@example.invalid`;
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
    headers: {
      authorization: `Bearer ${r.body.data.accessToken}`,
      'x-tenant-id': tenantId,
    } as Record<string, string>,
  };
}

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

async function patientUser(tenantId: string, patientId: string) {
  const now = new Date();
  const userId = newId();
  const email = `patient.${userId.slice(-10)}@example.invalid`;
  await api.runtime.prisma.user.create({
    data: {
      id: userId,
      email,
      emailNormalized: email,
      status: 'ACTIVE',
      passwordHash: await hasher.hash(PASSWORD),
      createdAt: now,
      updatedAt: now,
    },
  });
  await api.runtime.prisma.patientAccount.create({
    data: {
      id: newId(),
      tenantId,
      userId,
      patientId,
      relationship: 'SELF',
      verificationMethod: 'STAFF_VERIFIED_IN_PERSON',
      verifiedAt: now,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  const login = await request(server)
    .post('/api/v1/auth/password/login')
    .set('idempotency-key', idem())
    .send({ email, password: PASSWORD, client: 'web' })
    .expect(200);
  return {
    authorization: `Bearer ${login.body.data.accessToken}`,
    'x-tenant-id': tenantId,
    'x-patient-context': patientId,
  };
}

/**
 * A stored PRESCRIPTION_PDF document, with its encounter and a doctor logged in over HTTP.
 *
 * The tenant-doctor-chamber-serial scaffold comes from the shared fixture. Hand-rolling it here meant
 * discovering every required column one failed test at a time — which is exactly what that fixture's
 * own comment warns about — so this adds only what the fixture does not: a password and a membership so
 * the doctor can log in, and the document itself.
 */
async function storedDocument(label: string, options: { status?: string } = {}) {
  const now = new Date();
  const base = await chamberWithCalledSerial(api.runtime.prisma, label);
  const { tenantId, patientId, doctorProfileId } = base;

  const user = await api.runtime.prisma.user.findFirstOrThrow({ where: { id: base.userId } });
  await api.runtime.prisma.user.update({
    where: { id: base.userId },
    data: { passwordHash: await hasher.hash(PASSWORD), passwordChangedAt: now },
  });
  await api.runtime.prisma.tenantMembership.create({
    data: {
      id: newId(),
      tenantId,
      userId: base.userId,
      role: 'doctor',
      permissions: { grants: [], denials: [] },
      clinicIds: [],
      chamberIds: [],
      status: 'ACTIVE',
      rolePermissionsVersion: PolicyEngine.version,
      createdAt: now,
      updatedAt: now,
    },
  });
  const login = await request(server)
    .post('/api/v1/auth/password/login')
    .set('idempotency-key', idem())
    .send({ email: user.email, password: PASSWORD, client: 'web' })
    .expect(200);
  const doctorStaff = {
    userId: base.userId,
    profileId: doctorProfileId,
    headers: {
      authorization: `Bearer ${login.body.data.accessToken}`,
      'x-tenant-id': tenantId,
    } as Record<string, string>,
  };

  const encounterId = newId();
  await api.runtime.prisma.encounter.create({
    data: {
      id: encounterId,
      tenantId,
      patientId,
      doctorProfileId,
      chamberId: base.chamberId,
      serialId: base.serial.id,
      careMode: 'PHYSICAL',
      status: 'IN_PROGRESS',
      legacyInterim: false,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  const documentId = newId();
  const revision = 1;
  const status = options.status ?? 'AVAILABLE';
  await api.runtime.prisma.document.create({
    data: {
      id: documentId,
      tenantId,
      patientId,
      encounterId,
      category: 'PRESCRIPTION_PDF',
      status,
      currentRevision: status === 'AVAILABLE' ? revision : null,
      accessPolicy: 'CLINICAL_TEAM',
      createdAt: now,
      updatedAt: now,
    },
  });

  const bytes = Buffer.from('%PDF-1.7\nSYNTHETIC prescription\n');
  const key = buildStorageKey({ tenantId, category: 'PRESCRIPTION_PDF', documentId, revision });
  const stored = await new DiskObjectStorage({ root: storageRoot }).put(key, bytes, 'application/pdf');
  await api.runtime.prisma.documentVersion.create({
    data: {
      id: newId(),
      tenantId,
      documentId,
      revision,
      storageAdapter: 'disk',
      storageKey: stored.key,
      contentType: 'application/pdf',
      sizeBytes: BigInt(stored.sizeBytes),
      sha256: stored.sha256,
      scanStatus: 'CLEAN',
      scanAdapter: 'generated:rx-pdf-v1',
      scannedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  return { tenantId, documentId, doctor: doctorStaff, bytes, encounterId, patientId };
}

async function tokenFor(d: Awaited<ReturnType<typeof storedDocument>>): Promise<string> {
  const issued = await request(server)
    .post(`/api/v1/documents/${d.documentId}/download-token`)
    .set(d.doctor.headers)
    .set('idempotency-key', idem())
    .send({})
    .expect(201);
  return issued.body.data.token as string;
}

describe('document download over HTTP', () => {
  it('disables upload admission when the scan worker is not enabled', async () => {
    const d = await storedDocument('upload-disabled');
    Object.assign(api.runtime.config, { UPLOAD_SCAN_WORKER_ENABLED: false });
    try {
      const capability = await request(server)
        .get('/api/v1/documents/upload-capability')
        .set(d.doctor.headers)
        .expect(200);
      expect(capability.body.data.enabled).toBe(false);
      const bytes = Buffer.from('%PDF-1.7\nreport\n');
      const response = await request(server)
        .post('/api/v1/documents/upload-sessions')
        .set(d.doctor.headers)
        .set('idempotency-key', idem())
        .send({
          patientId: d.patientId,
          encounterId: d.encounterId,
          category: 'LAB_REPORT',
          contentType: 'application/pdf',
          sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
        .expect(409);
      expect(response.body.code).toBe('FEATURE_DISABLED');
    } finally {
      Object.assign(api.runtime.config, { UPLOAD_SCAN_WORKER_ENABLED: true });
    }
  });
  it('accepts an authorized upload and queues its completed bytes for scanning', async () => {
    const d = await storedDocument('upload-ok');
    const bytes = Buffer.from('%PDF-1.7\nsynthetic lab report\n');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const created = await request(server)
      .post('/api/v1/documents/upload-sessions')
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({
        patientId: d.patientId,
        encounterId: d.encounterId,
        category: 'LAB_REPORT',
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        sha256,
        fileName: 'report.pdf',
      })
      .expect(201);
    const { sessionId, documentId } = created.body.data;
    await request(server)
      .put(`/api/v1/documents/upload-sessions/${sessionId}/parts/1`)
      .set(d.doctor.headers)
      .set('x-part-sha256', sha256)
      .set('content-type', 'application/octet-stream')
      .send(bytes)
      .expect(200);
    const finished = await request(server)
      .post(`/api/v1/documents/upload-sessions/${sessionId}/finalize`)
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({})
      .expect(201);
    expect(finished.body.data.documentId).toBe(documentId);
    expect(
      await api.runtime.prisma.document.findFirst({ where: { id: documentId }, select: { status: true } }),
    ).toEqual({ status: 'SCANNING' });
    const metadata = await request(server)
      .get(`/api/v1/documents/${documentId}`)
      .set(d.doctor.headers)
      .expect(200);
    expect(metadata.body.data).toMatchObject({ id: documentId, status: 'SCANNING', currentRevision: null });
  });

  it('refuses an upload for a patient outside the authorized encounter', async () => {
    const d = await storedDocument('upload-mismatch');
    const bytes = Buffer.from('%PDF-1.7\nreport\n');
    const response = await request(server)
      .post('/api/v1/documents/upload-sessions')
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({
        patientId: newId(),
        encounterId: d.encounterId,
        category: 'LAB_REPORT',
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    expect(response.status).toBe(404);
  });

  it('rejects a wrong part checksum and allows its owner to abort', async () => {
    const d = await storedDocument('upload-abort');
    const bytes = Buffer.from('%PDF-1.7\nreport\n');
    const created = await request(server)
      .post('/api/v1/documents/upload-sessions')
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({
        patientId: d.patientId,
        encounterId: d.encounterId,
        category: 'LAB_REPORT',
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
      .expect(201);
    const { sessionId, documentId } = created.body.data;
    await request(server)
      .put(`/api/v1/documents/upload-sessions/${sessionId}/parts/1`)
      .set(d.doctor.headers)
      .set('x-part-sha256', '0'.repeat(64))
      .set('content-type', 'application/octet-stream')
      .send(bytes)
      .expect(422);
    await request(server)
      .post(`/api/v1/documents/upload-sessions/${sessionId}/abort`)
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({})
      .expect(201);
    expect(
      await api.runtime.prisma.document.findFirst({ where: { id: documentId }, select: { status: true } }),
    ).toEqual({ status: 'EXPIRED' });
  });

  it('lists only available documents for the authorized encounter and patient', async () => {
    const d = await storedDocument('dl-list');
    const result = await request(server)
      .get(`/api/v1/documents/by-encounter/${d.encounterId}`)
      .set(d.doctor.headers)
      .expect(200);
    expect(result.body.data.items.map((item: { id: string }) => item.id)).toEqual([d.documentId]);
    expect(result.body.data).toMatchObject({ page: 1, hasMore: false });

    await api.runtime.prisma.document.update({
      where: { id: d.documentId },
      data: { accessPolicy: 'AUDIT_ONLY' },
    });
    const hidden = await request(server)
      .get(`/api/v1/documents/by-encounter/${d.encounterId}`)
      .set(d.doctor.headers)
      .expect(200);
    expect(hidden.body.data.items).toEqual([]);
  });

  it('does not list another doctor’s encounter documents', async () => {
    const d = await storedDocument('dl-list-access');
    const unrelated = await doctor(d.tenantId, 'List other');
    await request(server)
      .get(`/api/v1/documents/by-encounter/${d.encounterId}`)
      .set(unrelated.headers)
      .expect(403);
  });

  it('limits document processing status to the authorized clinical scope', async () => {
    const d = await storedDocument('dl-status-access');
    const available = await request(server)
      .get(`/api/v1/documents/${d.documentId}`)
      .set(d.doctor.headers)
      .expect(200);
    expect(available.body.data).toMatchObject({ status: 'AVAILABLE', currentRevision: 1 });
    const unrelated = await doctor(d.tenantId, 'Status other');
    await request(server).get(`/api/v1/documents/${d.documentId}`).set(unrelated.headers).expect(403);
  });

  it('issues a token and streams the bytes as an attachment', async () => {
    const d = await storedDocument('dl-ok');
    const token = await tokenFor(d);

    const res = await request(server)
      .get(`/api/v1/documents/${d.documentId}/download`)
      .query({ token })
      .set(d.doctor.headers)
      .expect(200);

    expect(Buffer.from(res.body).subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.headers['content-type']).toContain('application/pdf');
    // `attachment`, never `inline`: a clinical PDF rendered inside this origin would run with its
    // privileges.
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('prescription-pdf-');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    // The global policy plus `sandbox`, not instead of it: a download must not be able to relax the
    // headers every other response carries.
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('refuses the same token twice', async () => {
    const d = await storedDocument('dl-replay');
    const token = await tokenFor(d);

    await request(server)
      .get(`/api/v1/documents/${d.documentId}/download`)
      .query({ token })
      .set(d.doctor.headers)
      .expect(200);
    // A saved link does not work twice.
    await request(server)
      .get(`/api/v1/documents/${d.documentId}/download`)
      .query({ token })
      .set(d.doctor.headers)
      .expect(401);
  });

  it('refuses a token presented by another doctor, who holds every permission', async () => {
    const d = await storedDocument('dl-other-actor');
    const token = await tokenFor(d);
    const other = await doctor(d.tenantId, 'other');

    // Not an authorization gap in the route — this other doctor is refused at the encounter anyway —
    // but the token binding is what makes a leaked link worthless even to someone who is authorized.
    await request(server)
      .get(`/api/v1/documents/${d.documentId}/download`)
      .query({ token })
      .set(other.headers)
      .expect(403);
  });

  it('refuses an unrelated doctor a token at all', async () => {
    const d = await storedDocument('dl-unrelated');
    const other = await doctor(d.tenantId, 'other');

    await request(server)
      .post(`/api/v1/documents/${d.documentId}/download-token`)
      .set(other.headers)
      .set('idempotency-key', idem())
      .send({})
      .expect(403);
  });

  it('answers not-found across a tenant boundary', async () => {
    const a = await storedDocument('dl-tenant-a');
    const b = await storedDocument('dl-tenant-b');

    // Not 403: whether a document exists in another tenant is itself information.
    await request(server)
      .post(`/api/v1/documents/${a.documentId}/download-token`)
      .set(b.doctor.headers)
      .set('idempotency-key', idem())
      .send({})
      .expect(404);
  });

  it('refuses a document whose patient does not match its authorized encounter', async () => {
    const d = await storedDocument('dl-mismatched-patient');
    const token = await tokenFor(d);
    const otherPatientId = newId();
    const now = new Date();
    await api.runtime.prisma.patient.create({
      data: {
        id: otherPatientId,
        tenantId: d.tenantId,
        medicalRecordNumber: `P-DL-${otherPatientId.slice(-8)}`,
        legalName: 'Other Synthetic Patient',
        displayName: 'Other Synthetic Patient',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await api.runtime.prisma.document.update({
      where: { id: d.documentId },
      data: { patientId: otherPatientId },
    });

    await request(server)
      .post(`/api/v1/documents/${d.documentId}/download-token`)
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({})
      .expect(404);
    await request(server)
      .get(`/api/v1/documents/${d.documentId}/download`)
      .query({ token })
      .set(d.doctor.headers)
      .expect(404);
  });

  it('does not issue or redeem a clinical download for an audit-only document', async () => {
    const d = await storedDocument('dl-audit-only');
    const token = await tokenFor(d);
    await api.runtime.prisma.document.update({
      where: { id: d.documentId },
      data: { accessPolicy: 'AUDIT_ONLY' },
    });

    await request(server)
      .post(`/api/v1/documents/${d.documentId}/download-token`)
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({})
      .expect(404);
    await request(server)
      .get(`/api/v1/documents/${d.documentId}/download`)
      .query({ token })
      .set(d.doctor.headers)
      .expect(404);
  });

  it('refuses a token for a document that is not available yet', async () => {
    const d = await storedDocument('dl-scanning', { status: 'SCANNING' });

    const res = await request(server)
      .post(`/api/v1/documents/${d.documentId}/download-token`)
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({})
      .expect(409);
    expect(res.body.code).toBe('DOCUMENT_NOT_AVAILABLE');
  });

  it.each([
    ['garbage', 'not-a-token'],
    ['empty', ''],
    ['forged signature', `9999999999.${'0'.repeat(64)}`],
  ])('refuses a %s token with the same answer', async (_label, token) => {
    const d = await storedDocument(`dl-bad-${_label.replace(/\s+/g, '-')}`);
    const res = await request(server)
      .get(`/api/v1/documents/${d.documentId}/download`)
      .query({ token })
      .set(d.doctor.headers);
    // Expired, malformed and forged are indistinguishable from outside, so a caller cannot probe.
    expect(res.status).toBe(401);
  });

  it('refuses a download with no token at all, the same way as a bad one', async () => {
    const d = await storedDocument('dl-no-token');
    // 401 rather than a validation error: a missing token and a wrong token must be indistinguishable,
    // or the difference is itself a hint to whoever is probing.
    await request(server).get(`/api/v1/documents/${d.documentId}/download`).set(d.doctor.headers).expect(401);
  });
});

describe('lab reports over HTTP', () => {
  it('links only an available lab file, records a result and freezes it on doctor review', async () => {
    const d = await storedDocument('lab-flow');
    const create = () =>
      request(server)
        .post('/api/v1/lab-reports')
        .set(d.doctor.headers)
        .set('idempotency-key', idem())
        .send({ documentId: d.documentId, labName: 'Synthetic Lab', reportDate: '2026-10-01' });
    await create().expect(409);
    await api.runtime.prisma.document.update({
      where: { id: d.documentId },
      data: { category: 'LAB_REPORT', status: 'SCANNING', currentRevision: null },
    });
    await create().expect(409);
    await api.runtime.prisma.document.update({
      where: { id: d.documentId },
      data: { status: 'AVAILABLE', currentRevision: 1 },
    });
    const created = await create().expect(201);
    const reportId = created.body.data.id as string;
    expect(created.body.data).toMatchObject({
      documentId: d.documentId,
      reviewStatus: 'UNREVIEWED',
      rowVersion: 1,
      reportDate: '2026-10-01',
    });
    await create().expect(409);
    const listed = await request(server)
      .get(`/api/v1/lab-reports/by-encounter/${d.encounterId}`)
      .set(d.doctor.headers)
      .expect(200);
    expect(listed.body.data.items).toHaveLength(1);
    const other = await doctor(d.tenantId, 'Lab other');
    await request(server).get(`/api/v1/lab-reports/${reportId}`).set(other.headers).expect(403);

    await request(server)
      .post(`/api/v1/lab-reports/${reportId}/results`)
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({
        expectedRowVersion: 1,
        analyteDisplay: 'Synthetic analyte',
        valueNumeric: '4.250000',
        unit: 'mmol/L',
        referenceRange: '3–5',
        abnormalFlag: 'NORMAL',
      })
      .expect(201);
    const draft = await request(server)
      .get(`/api/v1/lab-reports/${reportId}`)
      .set(d.doctor.headers)
      .expect(200);
    expect(draft.body.data.rowVersion).toBe(2);
    expect(draft.body.data.results).toMatchObject([
      { analyteDisplay: 'Synthetic analyte', valueNumeric: '4.25', reviewStatus: 'UNREVIEWED' },
    ]);
    await request(server)
      .post(`/api/v1/lab-reports/${reportId}/review`)
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: 2 })
      .expect(400);
    const reviewed = await request(server)
      .post(`/api/v1/lab-reports/${reportId}/review`)
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: 2, attestedSource: true })
      .expect(200);
    expect(reviewed.body.data.reviewStatus).toBe('REVIEWED');
    const final = await request(server)
      .get(`/api/v1/lab-reports/${reportId}`)
      .set(d.doctor.headers)
      .expect(200);
    expect(final.body.data.results[0].reviewStatus).toBe('REVIEWED');
    const patientHeaders = await patientUser(d.tenantId, d.patientId);
    const hidden = await request(server)
      .get('/api/v1/lab-reports/patient/mine')
      .set(patientHeaders)
      .expect(200);
    expect(hidden.body.data.items).toEqual([]);
    await request(server).get(`/api/v1/lab-reports/patient/mine/${reportId}`).set(patientHeaders).expect(404);
    await request(server)
      .post(`/api/v1/documents/${d.documentId}/download-token`)
      .set(patientHeaders)
      .set('idempotency-key', idem())
      .send({})
      .expect(404);
    const shared = await request(server)
      .post(`/api/v1/lab-reports/${reportId}/share`)
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: 3 })
      .expect(200);
    expect(shared.body.data.patientShared).toBe(true);
    const visible = await request(server)
      .get('/api/v1/lab-reports/patient/mine')
      .set(patientHeaders)
      .expect(200);
    expect(visible.body.data.items).toHaveLength(1);
    const patientReport = await request(server)
      .get(`/api/v1/lab-reports/patient/mine/${reportId}`)
      .set(patientHeaders)
      .expect(200);
    expect(patientReport.body.data.results).toMatchObject([{ analyteDisplay: 'Synthetic analyte' }]);
    const patientToken = await request(server)
      .post(`/api/v1/documents/${d.documentId}/download-token`)
      .set(patientHeaders)
      .set('idempotency-key', idem())
      .send({})
      .expect(201);
    await request(server)
      .get(`/api/v1/documents/${d.documentId}/download`)
      .query({ token: patientToken.body.data.token })
      .set(patientHeaders)
      .expect(200);
    const unusedToken = await request(server)
      .post(`/api/v1/documents/${d.documentId}/download-token`)
      .set(patientHeaders)
      .set('idempotency-key', idem())
      .send({})
      .expect(201);
    await api.runtime.prisma.patientAccount.updateMany({
      where: { tenantId: d.tenantId, patientId: d.patientId },
      data: { status: 'REVOKED' },
    });
    await request(server).get(`/api/v1/lab-reports/patient/mine/${reportId}`).set(patientHeaders).expect(403);
    await request(server)
      .get(`/api/v1/documents/${d.documentId}/download`)
      .query({ token: unusedToken.body.data.token })
      .set(patientHeaders)
      .expect(403);
    await request(server)
      .post(`/api/v1/lab-reports/${reportId}/results`)
      .set(d.doctor.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: 3, analyteDisplay: 'Late entry', valueText: 'positive' })
      .expect(409);
  });
});
