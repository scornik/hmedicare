import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {} from '../../../../tests/support/mariadb-global-setup';
import { type Database } from '@hmedic/database';
import { newId } from '@hmedic/kernel';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import {
  abortUploadRecord,
  claimUploadFinalize,
  recordUploadPart,
} from '../../src/infrastructure/upload-records';
import { UploadSessionService } from '../../src/infrastructure/upload-sessions';
import type {
  ProxiedUploadStoragePort,
  UploadStorageSession,
} from '../../src/application/upload-storage-port';

let db: Database;
let tenantId: string;
let sessionId: string;
let ownerUserId: string;
let patientId: string;
const now = new Date();
const expiresAt = new Date(now.getTime() + 3_600_000);
const hash = 'a'.repeat(64);
const receipt = { partNumber: 1, sizeBytes: 1024, sha256: hash };

beforeAll(() => {
  db = openTestDatabase();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await truncateAll();
  const base = await chamberWithCalledSerial(db.prisma, 'claim');
  tenantId = base.tenantId;
  ownerUserId = base.userId;
  patientId = base.patientId;
  const documentId = newId();
  sessionId = newId();
  await db.prisma.document.create({
    data: {
      id: documentId,
      tenantId,
      patientId: base.patientId,
      category: 'LAB_REPORT',
      status: 'UPLOADING',
      accessPolicy: 'CLINICAL_TEAM',
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.prisma.uploadSession.create({
    data: {
      id: sessionId,
      tenantId,
      documentId,
      ownerUserId,
      targetRevision: 1,
      storageAdapter: 'disk',
      storageKey: `t/${tenantId}/lab-report/${documentId}/1`,
      contentType: 'application/pdf',
      expectedSizeBytes: BigInt(1024),
      expectedSha256: hash,
      partSizeBytes: 1024,
      status: 'OPEN',
      expiresAt,
      createdAt: now,
      updatedAt: now,
    },
  });
});

describe('upload session creation', () => {
  const request = () => ({
    tenantId,
    ownerUserId,
    patientId,
    category: 'LAB_REPORT',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    sha256: hash,
    fileName: 'Report.pdf',
  });

  it('checks authorization and patient before creating an immutable storage manifest', async () => {
    let authorized = false;
    const manifests: UploadStorageSession[] = [];
    const storage: ProxiedUploadStoragePort = {
      async createUploadSession(session) {
        expect(authorized).toBe(true);
        manifests.push(session);
      },
      async uploadPart() {
        throw new Error('unused');
      },
      async completeUpload() {
        throw new Error('unused');
      },
      async abortUpload() {
        throw new Error('unused');
      },
    };
    const service = new UploadSessionService(
      db.prisma,
      storage,
      async () => {
        authorized = true;
        return 'PATIENT_SHARED';
      },
      () => now,
    );
    const created = await service.create(request());
    expect(created.mode).toBe('proxied');
    expect(created.partCount).toBe(1);
    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.sessionId).toBe(created.sessionId);
    expect(created.partSizeBytes).toBe(manifests[0]?.partSizeBytes);
    const document = await db.prisma.document.findUniqueOrThrow({ where: { id: created.documentId } });
    expect(document.patientId).toBe(patientId);
    expect(document.title).toBe('Report.pdf');
    expect(document.accessPolicy).toBe('PATIENT_SHARED');
    const stored = await db.prisma.uploadSession.findUniqueOrThrow({
      where: { id: created.sessionId },
    });
    expect(stored.status).toBe('OPEN');
    expect(stored.storageKey).toBe(manifests[0]?.key);
  });

  it('refuses a missing patient without calling storage', async () => {
    let storageCalls = 0;
    const storage: ProxiedUploadStoragePort = {
      async createUploadSession() {
        storageCalls++;
      },
      async uploadPart() {
        throw new Error('unused');
      },
      async completeUpload() {
        throw new Error('unused');
      },
      async abortUpload() {
        throw new Error('unused');
      },
    };
    const service = new UploadSessionService(
      db.prisma,
      storage,
      async () => 'CLINICAL_TEAM',
      () => now,
    );
    await expect(service.create({ ...request(), patientId: newId() })).rejects.toMatchObject({
      code: 'UPLOAD_NOT_FOUND',
    });
    await expect(service.create({ ...request(), encounterId: newId() })).rejects.toMatchObject({
      code: 'UPLOAD_NOT_FOUND',
    });
    expect(storageCalls).toBe(0);
  });

  it('marks the record unusable when storage cannot create the manifest', async () => {
    const storage: ProxiedUploadStoragePort = {
      async createUploadSession() {
        throw new Error('disk offline');
      },
      async uploadPart() {
        throw new Error('unused');
      },
      async completeUpload() {
        throw new Error('unused');
      },
      async abortUpload() {
        throw new Error('unused');
      },
    };
    const service = new UploadSessionService(
      db.prisma,
      storage,
      async () => 'CLINICAL_TEAM',
      () => now,
    );
    await expect(service.create(request())).rejects.toMatchObject({ code: 'UPLOAD_IO_FAILED' });
    const stored = await db.prisma.uploadSession.findFirstOrThrow({
      where: { tenantId, ownerUserId, id: { not: sessionId } },
    });
    const document = await db.prisma.document.findUniqueOrThrow({ where: { id: stored.documentId } });
    expect(stored.status).toBe('ABORTED');
    expect(document.status).toBe('EXPIRED');
  });
});

const identity = () => ({ tenantId, sessionId, ownerUserId });

describe('durable upload receipt and finalize claims', () => {
  it('aborts an open session and retries cleanup without deleting another actor’s session', async () => {
    let cleanupAttempts = 0;
    const storage: ProxiedUploadStoragePort = {
      async createUploadSession() {
        throw new Error('unused');
      },
      async uploadPart() {
        throw new Error('unused');
      },
      async completeUpload() {
        throw new Error('unused');
      },
      async abortUpload() {
        cleanupAttempts++;
        if (cleanupAttempts === 1) throw new Error('temporary disk error');
      },
    };
    await expect(
      abortUploadRecord(db.prisma, storage, { ...identity(), ownerUserId: newId() }, now),
    ).rejects.toMatchObject({ code: 'UPLOAD_NOT_FOUND' });
    expect(cleanupAttempts).toBe(0);
    await expect(abortUploadRecord(db.prisma, storage, identity(), now)).rejects.toThrow(
      'temporary disk error',
    );
    const aborted = await db.prisma.uploadSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(aborted.status).toBe('ABORTED');
    const document = await db.prisma.document.findUniqueOrThrow({ where: { id: aborted.documentId } });
    expect(document.status).toBe('EXPIRED');
    await abortUploadRecord(db.prisma, storage, identity(), now);
    expect(cleanupAttempts).toBe(2);
  });

  it('will not abort a session already claimed for finalize', async () => {
    await recordUploadPart(db.prisma, identity(), receipt, now);
    await claimUploadFinalize(db.prisma, identity(), now);
    let cleaned = false;
    const storage: ProxiedUploadStoragePort = {
      async createUploadSession() {
        throw new Error('unused');
      },
      async uploadPart() {
        throw new Error('unused');
      },
      async completeUpload() {
        throw new Error('unused');
      },
      async abortUpload() {
        cleaned = true;
      },
    };
    await expect(abortUploadRecord(db.prisma, storage, identity(), now)).rejects.toMatchObject({
      code: 'UPLOAD_CONFLICT',
    });
    expect(cleaned).toBe(false);
  });

  it('selects a receipt and claims its exact set once', async () => {
    await recordUploadPart(db.prisma, identity(), receipt, now);
    const first = await claimUploadFinalize(db.prisma, identity(), now);
    expect(first.parts).toEqual([receipt]);
    expect(first.partsSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(claimUploadFinalize(db.prisma, identity(), now)).rejects.toMatchObject({
      code: 'UPLOAD_CONFLICT',
    });
    await expect(recordUploadPart(db.prisma, identity(), receipt, now)).rejects.toMatchObject({
      code: 'UPLOAD_CONFLICT',
    });
  });

  it('reclaims an expired lease only for the same receipt set', async () => {
    await recordUploadPart(db.prisma, identity(), receipt, now);
    const first = await claimUploadFinalize(db.prisma, identity(), now, 1_000);
    const retry = await claimUploadFinalize(db.prisma, identity(), new Date(now.getTime() + 1_001), 1_000);
    expect(retry.partsSha256).toBe(first.partsSha256);
    const stored = await db.prisma.uploadSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(stored.status).toBe('FINALIZING');
    expect(stored.finalizePartsSha256).toBe(first.partsSha256);
  });

  it('gives a simultaneous finalize claim to exactly one worker', async () => {
    await recordUploadPart(db.prisma, identity(), receipt, now);
    const results = await Promise.allSettled([
      claimUploadFinalize(db.prisma, identity(), now),
      claimUploadFinalize(db.prisma, identity(), now),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('refuses incomplete coverage and a different owner', async () => {
    await expect(claimUploadFinalize(db.prisma, identity(), now)).rejects.toMatchObject({
      code: 'UPLOAD_PARTS_INVALID',
    });
    await expect(
      recordUploadPart(db.prisma, { ...identity(), ownerUserId: newId() }, receipt, now),
    ).rejects.toMatchObject({
      code: 'UPLOAD_CONFLICT',
    });
    expect((await db.prisma.uploadSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe(
      'OPEN',
    );
  });
});
