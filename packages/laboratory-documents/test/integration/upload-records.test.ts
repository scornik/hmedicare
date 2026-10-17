import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {} from '../../../../tests/support/mariadb-global-setup';
import { type Database } from '@hmedic/database';
import { newId } from '@hmedic/kernel';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { claimUploadFinalize, recordUploadPart } from '../../src/infrastructure/upload-records';

let db: Database;
let tenantId: string;
let sessionId: string;
let ownerUserId: string;
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

const identity = () => ({ tenantId, sessionId, ownerUserId });

describe('durable upload receipt and finalize claims', () => {
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
