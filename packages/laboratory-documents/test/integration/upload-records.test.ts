import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {} from '../../../../tests/support/mariadb-global-setup';
import { type Database } from '@hmedic/database';
import { newId } from '@hmedic/kernel';
import { JobPort, JobRegistry } from '@hmedic/jobs';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import {
  abortUploadRecord,
  claimUploadFinalize,
  recordUploadPart,
} from '../../src/infrastructure/upload-records';
import { UploadSessionService } from '../../src/infrastructure/upload-sessions';
import { commitUploadFinalize, registerUploadScanJobType } from '../../src/infrastructure/upload-finalize';
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

describe('proxied part admission', () => {
  it('checks ownership and patient scope around storage I/O, then selects the receipt', async () => {
    const session = await db.prisma.uploadSession.findUniqueOrThrow({ where: { id: sessionId } });
    await db.prisma.document.update({ where: { id: session.documentId }, data: { status: 'CREATED' } });
    let storageCalls = 0;
    const storage: ProxiedUploadStoragePort = {
      async createUploadSession(descriptor) {
        expect(descriptor.key).toBe(session.storageKey);
        storageCalls++;
      },
      async uploadPart(descriptor, number, body, checksum) {
        expect(descriptor.sessionId).toBe(sessionId);
        expect(number).toBe(1);
        expect(body).toBeInstanceOf(Buffer);
        expect(checksum).toBe(hash);
        storageCalls++;
        return receipt;
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
    let authChecks = 0;
    const authorize = async (scope: { patientId: string; tenantId: string }) => {
      expect(scope.patientId).toBe(patientId);
      expect(scope.tenantId).toBe(tenantId);
      authChecks++;
    };
    await expect(
      service.uploadPart({ ...identity(), ownerUserId: newId() }, 1, Buffer.alloc(1024), hash, authorize),
    ).rejects.toMatchObject({ code: 'UPLOAD_NOT_FOUND' });
    expect(storageCalls).toBe(0);
    expect(await service.uploadPart(identity(), 1, Buffer.alloc(1024), hash, authorize)).toEqual(receipt);
    expect(storageCalls).toBe(2);
    expect(authChecks).toBe(2);
    expect(await db.prisma.uploadSessionPart.count({ where: { uploadSessionId: sessionId } })).toBe(1);
    expect((await db.prisma.document.findUniqueOrThrow({ where: { id: session.documentId } })).status).toBe(
      'UPLOADING',
    );
  });

  it('does not select a stored part if patient access lapses during transfer', async () => {
    const storage: ProxiedUploadStoragePort = {
      async createUploadSession() {},
      async uploadPart() {
        return receipt;
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
    let checks = 0;
    await expect(
      service.uploadPart(identity(), 1, Buffer.alloc(1024), hash, async () => {
        if (++checks === 2) throw new Error('access revoked');
      }),
    ).rejects.toThrow('access revoked');
    expect(await db.prisma.uploadSessionPart.count({ where: { uploadSessionId: sessionId } })).toBe(0);
  });
});

const identity = () => ({ tenantId, sessionId, ownerUserId });

describe('durable upload receipt and finalize claims', () => {
  const jobPort = () => {
    const registry = new JobRegistry();
    registerUploadScanJobType(registry);
    return new JobPort(db.prisma, registry);
  };

  it('commits a verified version and scan job together, then refuses a duplicate commit', async () => {
    await recordUploadPart(db.prisma, identity(), receipt, now);
    const claim = await claimUploadFinalize(db.prisma, identity(), now);
    const result = await commitUploadFinalize(
      db.prisma,
      jobPort(),
      identity(),
      claim.partsSha256,
      { key: claim.session.key, sizeBytes: 1024, sha256: hash },
      now,
    );
    expect((await db.prisma.document.findUniqueOrThrow({ where: { id: result.documentId } })).status).toBe(
      'SCANNING',
    );
    expect(
      (await db.prisma.documentVersion.findUniqueOrThrow({ where: { id: result.versionId } })).scanStatus,
    ).toBe('PENDING');
    expect((await db.prisma.uploadSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe(
      'FINALIZED',
    );
    expect(await db.prisma.job.count({ where: { type: 'ScanDocumentVersion' } })).toBe(1);
    await expect(
      commitUploadFinalize(
        db.prisma,
        jobPort(),
        identity(),
        claim.partsSha256,
        { key: claim.session.key, sizeBytes: 1024, sha256: hash },
        now,
      ),
    ).rejects.toMatchObject({ code: 'UPLOAD_CONFLICT' });
  });

  it('rolls back the version and status when enqueue fails or the object differs', async () => {
    await recordUploadPart(db.prisma, identity(), receipt, now);
    const claim = await claimUploadFinalize(db.prisma, identity(), now);
    await expect(
      commitUploadFinalize(
        db.prisma,
        jobPort(),
        identity(),
        claim.partsSha256,
        { key: claim.session.key, sizeBytes: 1024, sha256: 'b'.repeat(64) },
        now,
      ),
    ).rejects.toMatchObject({ code: 'UPLOAD_CHECKSUM_MISMATCH' });
    await expect(
      commitUploadFinalize(
        db.prisma,
        new JobPort(db.prisma, new JobRegistry()),
        identity(),
        claim.partsSha256,
        { key: claim.session.key, sizeBytes: 1024, sha256: hash },
        now,
      ),
    ).rejects.toThrow('unknown job type');
    const row = await db.prisma.uploadSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.status).toBe('FINALIZING');
    expect((await db.prisma.document.findUniqueOrThrow({ where: { id: row.documentId } })).status).toBe(
      'UPLOADING',
    );
    expect(await db.prisma.documentVersion.count({ where: { documentId: row.documentId } })).toBe(0);
  });
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
