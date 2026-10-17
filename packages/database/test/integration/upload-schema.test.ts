import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Database, dbErrorInfo } from '@hmedic/database';
import { newId } from '@hmedic/kernel';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

let db: Database;
let tenantId: string;
let documentId: string;
let ownerUserId: string;
const now = new Date();
const later = new Date(now.getTime() + 3_600_000);
const hash = 'a'.repeat(64);

beforeAll(() => {
  db = openTestDatabase();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await truncateAll();
  const base = await chamberWithCalledSerial(db.prisma, 'upload');
  tenantId = base.tenantId;
  ownerUserId = base.userId;
  documentId = newId();
  await db.prisma.document.create({
    data: {
      id: documentId,
      tenantId,
      patientId: base.patientId,
      category: 'LAB_REPORT',
      status: 'CREATED',
      accessPolicy: 'CLINICAL_TEAM',
      createdAt: now,
      updatedAt: now,
    },
  });
});

async function session(over: Record<string, unknown> = {}) {
  const id = newId();
  await db.prisma.uploadSession.create({
    data: {
      id,
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
      expiresAt: later,
      createdAt: now,
      updatedAt: now,
      ...over,
    } as never,
  });
  return id;
}

describe('durable upload schema', () => {
  it('stores selected part receipts under a tenant-bound session', async () => {
    const id = await session();
    await db.prisma.uploadSessionPart.create({
      data: { uploadSessionId: id, tenantId, partNumber: 1, sizeBytes: 1024, sha256: hash, receivedAt: now },
    });
    const part = await db.prisma.uploadSessionPart.findUniqueOrThrow({
      where: { uploadSessionId_partNumber: { uploadSessionId: id, partNumber: 1 } },
    });
    expect(part.sha256).toBe(hash);
    expect(part.tenantId).toBe(tenantId);
  });

  it.each([
    ['invalid status', { status: 'READY' }, 'chk_upload_sessions_status'],
    ['unleased finalize claim', { status: 'FINALIZING' }, 'chk_upload_sessions_claim'],
    ['unrecorded finalize completion', { status: 'FINALIZED' }, 'chk_upload_sessions_finalized'],
    ['oversized file', { expectedSizeBytes: BigInt(209715201) }, 'chk_upload_sessions_size'],
  ])('rejects %s', async (_label, over, constraint) => {
    const error = await session(over).catch((caught: unknown) => caught);
    expect(dbErrorInfo(error).constraint).toBe(constraint);
  });

  it('refuses a second claim for the same document revision', async () => {
    await session();
    const error = await session({ storageKey: `t/${tenantId}/lab-report/${documentId}/2` }).catch(
      (caught: unknown) => caught,
    );
    expect(dbErrorInfo(error).constraint).toBe('uq_upload_sessions_revision');
  });

  it('refuses a receipt associated with another tenant', async () => {
    const id = await session();
    const other = await chamberWithCalledSerial(db.prisma, 'other-upload');
    const error = await db.prisma.uploadSessionPart
      .create({
        data: {
          uploadSessionId: id,
          tenantId: other.tenantId,
          partNumber: 1,
          sizeBytes: 1024,
          sha256: hash,
          receivedAt: now,
        },
      })
      .catch((caught: unknown) => caught);
    expect(dbErrorInfo(error).kind).toBe('REFERENCE_VIOLATION');
  });
});
