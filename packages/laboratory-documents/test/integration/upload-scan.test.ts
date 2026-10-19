import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {} from '../../../../tests/support/mariadb-global-setup';
import { type Database } from '@hmedic/database';
import { newId } from '@hmedic/kernel';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import type { MalwareScanPort, ScanVerdict } from '../../src/application/malware-scan-port';
import { processUploadScan } from '../../src/infrastructure/upload-scan';

let db: Database;
let tenantId: string;
let documentId: string;
let versionId: string;
const now = new Date();
const sha256 = 'a'.repeat(64);

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
  documentId = newId();
  versionId = newId();
  await db.prisma.document.create({
    data: {
      id: documentId,
      tenantId,
      patientId: base.patientId,
      category: 'LAB_REPORT',
      status: 'SCANNING',
      accessPolicy: 'CLINICAL_TEAM',
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.prisma.documentVersion.create({
    data: {
      id: versionId,
      tenantId,
      documentId,
      revision: 1,
      storageAdapter: 'disk',
      storageKey: `t/${tenantId}/lab-report/${documentId}/1`,
      contentType: 'application/pdf',
      sizeBytes: BigInt(1024),
      sha256,
      scanStatus: 'PENDING',
      createdAt: now,
      updatedAt: now,
    },
  });
});

const identity = () => ({ tenantId, documentId, versionId });
const scanner = (verdict: ScanVerdict): MalwareScanPort => ({
  describe: () => ({ adapter: 'baseline-content-policy', detectsKnownMalware: false, limits: [] }),
  scan: async () => verdict,
});

describe('upload scan result commit', () => {
  it('does not scan a version from another tenant', async () => {
    let called = false;
    const guarded: MalwareScanPort = {
      ...scanner({ result: 'CLEAN' }),
      scan: async () => {
        called = true;
        return { result: 'CLEAN' };
      },
    };
    await expect(
      processUploadScan(db.prisma, guarded, { ...identity(), tenantId: newId() }, 1, now),
    ).rejects.toMatchObject({ code: 'UPLOAD_NOT_FOUND' });
    expect(called).toBe(false);
  });

  it('does not publish a result after the worker loses its lease', async () => {
    const controller = new AbortController();
    const guarded: MalwareScanPort = {
      ...scanner({ result: 'CLEAN' }),
      scan: async () => {
        controller.abort();
        return { result: 'CLEAN' };
      },
    };
    await expect(
      processUploadScan(db.prisma, guarded, identity(), 1, now, controller.signal),
    ).rejects.toMatchObject({ code: 'UPLOAD_CONFLICT' });
    expect((await db.prisma.document.findUniqueOrThrow({ where: { id: documentId } })).status).toBe(
      'SCANNING',
    );
  });

  it('publishes a clean PDF revision and treats repeat delivery as idempotent', async () => {
    expect(await processUploadScan(db.prisma, scanner({ result: 'CLEAN' }), identity(), 1, now)).toBe(
      'AVAILABLE',
    );
    const document = await db.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.status).toBe('AVAILABLE');
    expect(document.currentRevision).toBe(1);
    expect((await db.prisma.documentVersion.findUniqueOrThrow({ where: { id: versionId } })).scanStatus).toBe(
      'CLEAN',
    );
    expect(await processUploadScan(db.prisma, scanner({ result: 'CLEAN' }), identity(), 1, now)).toBe(
      'AVAILABLE',
    );
  });

  it('keeps scanner errors unavailable until a later clean attempt', async () => {
    expect(
      await processUploadScan(
        db.prisma,
        scanner({ result: 'ERROR', reasonCode: 'SCAN_UNAVAILABLE' }),
        identity(),
        1,
        now,
      ),
    ).toBe('RETRY');
    expect((await db.prisma.document.findUniqueOrThrow({ where: { id: documentId } })).status).toBe(
      'SCAN_ERROR',
    );
    expect(await processUploadScan(db.prisma, scanner({ result: 'CLEAN' }), identity(), 2, now)).toBe(
      'AVAILABLE',
    );
  });

  it('rejects an unavailable scanner after its final attempt', async () => {
    expect(
      await processUploadScan(
        db.prisma,
        scanner({ result: 'ERROR', reasonCode: 'SCAN_UNAVAILABLE' }),
        identity(),
        3,
        now,
      ),
    ).toBe('REJECTED');
    const document = await db.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.status).toBe('REJECTED');
    expect(document.currentRevision).toBeNull();
  });

  it('publishes only a sanitized image revision', async () => {
    const key = `t/${tenantId}/image/${documentId}/2`;
    await db.prisma.document.update({ where: { id: documentId }, data: { category: 'IMAGE' } });
    await db.prisma.documentVersion.update({
      where: { id: versionId },
      data: {
        storageKey: `t/${tenantId}/image/${documentId}/1`,
        contentType: 'image/png',
      },
    });
    const clean = scanner({ result: 'CLEAN', sanitized: { key, sizeBytes: 800, sha256: 'b'.repeat(64) } });
    expect(await processUploadScan(db.prisma, clean, identity(), 1, now)).toBe('AVAILABLE');
    const document = await db.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.currentRevision).toBe(2);
    const derived = await db.prisma.documentVersion.findFirstOrThrow({ where: { documentId, revision: 2 } });
    expect(derived.storageKey).toBe(key);
    expect(derived.derivedFromRevision).toBe(1);
    expect(derived.scanStatus).toBe('CLEAN');
  });
});
