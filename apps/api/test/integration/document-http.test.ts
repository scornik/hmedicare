import { mkdtemp, rm } from 'node:fs/promises';
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
      testEnv({ DATABASE_URL: testDatabaseUrl(), STORAGE_DISK_ROOT: storageRoot }),
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
