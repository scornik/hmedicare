import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import { type Database, dbErrorInfo } from '@hmedic/database';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

/**
 * What migration 0010 refuses (DATABASE-IMPLEMENTATION.md §3.10, ADR-016, DOC-001).
 *
 * These assert the engine, not the service. A document row is a claim that a file exists and that
 * someone may read it; the code that writes such rows will eventually include an upload route, a render
 * job, a repair script and whatever Stage 8 brings. The invariants that matter are the ones none of
 * those can talk their way around.
 */
let db: Database;
let tenantId = '';
let patientId = '';
let encounterId = '';
const now = new Date();
const sha = (seed: string) => seed.padEnd(64, '0').slice(0, 64);

beforeAll(async () => {
  db = openTestDatabase();
});
afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await truncateAll();
  const base = await chamberWithCalledSerial(db.prisma, 'doc');
  tenantId = base.tenantId;
  patientId = base.patientId;
  encounterId = newId();
  await db.prisma.encounter.create({
    data: {
      id: encounterId,
      tenantId,
      patientId,
      doctorProfileId: base.doctorProfileId,
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
});

async function document(over: Record<string, unknown> = {}) {
  const id = newId();
  await db.prisma.document.create({
    data: {
      id,
      tenantId,
      patientId,
      encounterId,
      category: 'PRESCRIPTION_PDF',
      status: 'CREATED',
      accessPolicy: 'CLINICAL_TEAM',
      createdAt: now,
      updatedAt: now,
      ...over,
    } as never,
  });
  return id;
}

async function version(documentId: string, over: Record<string, unknown> = {}) {
  const id = newId();
  await db.prisma.documentVersion.create({
    data: {
      id,
      tenantId,
      documentId,
      revision: 1,
      storageAdapter: 'disk',
      storageKey: `t/${tenantId}/prescription-pdf/${id}/1`,
      contentType: 'application/pdf',
      sizeBytes: BigInt(1024),
      sha256: sha('a'),
      scanStatus: 'CLEAN',
      scanAdapter: 'generated:prescription-pdf',
      scannedAt: now,
      createdAt: now,
      updatedAt: now,
      ...over,
    } as never,
  });
  return id;
}

describe('documents invariants the database enforces', () => {
  it('accepts the generated-document shape end to end', async () => {
    const id = await document({ status: 'AVAILABLE', currentRevision: 1, title: 'Prescription' });
    await version(id);

    const row = await db.prisma.document.findFirstOrThrow({ where: { tenantId, id } });
    expect(row.status).toBe('AVAILABLE');
    expect(row.currentRevision).toBe(1);
    const v = await db.prisma.documentVersion.findFirstOrThrow({ where: { tenantId, documentId: id } });
    expect(v.sizeBytes).toBe(BigInt(1024));
    expect(v.scanStatus).toBe('CLEAN');
  });

  it('refuses an available document that names no revision', async () => {
    // An AVAILABLE row with a null current_revision is a download that 500s instead of one that 404s.
    const e = await document({ status: 'AVAILABLE' }).catch((x: unknown) => x);
    expect(dbErrorInfo(e).constraint).toBe('chk_documents_available_revision');
  });

  it.each([
    ['category', { category: 'ANYTHING' }, 'chk_documents_category'],
    ['status', { status: 'DONE' }, 'chk_documents_status'],
    ['access policy', { accessPolicy: 'EVERYONE' }, 'chk_documents_access_policy'],
  ])('refuses an unknown %s', async (_label, over, constraint) => {
    const e = await document(over).catch((x: unknown) => x);
    expect(dbErrorInfo(e).constraint).toBe(constraint);
  });

  it('refuses a second version at the same revision', async () => {
    const id = await document();
    await version(id);
    const e = await version(id, { storageKey: `t/${tenantId}/prescription-pdf/${id}/1-again` }).catch(
      (x: unknown) => x,
    );
    // A revision someone has read must keep pointing at the bytes they read.
    expect(dbErrorInfo(e).constraint).toBe('uq_document_versions_revision');
  });

  it('refuses two versions sharing a storage key', async () => {
    const a = await document();
    const b = await document();
    const key = `t/${tenantId}/prescription-pdf/shared/1`;
    await version(a, { storageKey: key });
    const e = await version(b, { storageKey: key }).catch((x: unknown) => x);
    // Two rows over one object means deleting either one orphans or destroys the other's bytes.
    expect(dbErrorInfo(e).constraint).toBe('uq_document_versions_key');
  });

  it.each([
    ['a zero-length object', { sizeBytes: BigInt(0) }, 'chk_document_versions_size'],
    ['revision zero', { revision: 0 }, 'chk_document_versions_revision'],
    ['an unknown adapter', { storageAdapter: 'ftp' }, 'chk_document_versions_adapter'],
    ['an unknown scan status', { scanStatus: 'MAYBE' }, 'chk_document_versions_scan_status'],
  ])('refuses %s', async (_label, over, constraint) => {
    const id = await document();
    const e = await version(id, over).catch((x: unknown) => x);
    expect(dbErrorInfo(e).constraint).toBe(constraint);
  });

  it('refuses a decided scan verdict with nothing that reached it', async () => {
    const id = await document();
    // "Generated, so not scanned" has to be a recorded decision rather than an empty column that reads
    // like an oversight, so a CLEAN verdict must name its adapter and its time.
    const e = await version(id, { scanStatus: 'CLEAN', scanAdapter: null, scannedAt: null }).catch(
      (x: unknown) => x,
    );
    expect(dbErrorInfo(e).constraint).toBe('chk_document_versions_scan_decided');
  });

  it('permits a pending scan with no verdict yet', async () => {
    const id = await document();
    await expect(
      version(id, { scanStatus: 'PENDING', scanAdapter: null, scannedAt: null }),
    ).resolves.toBeTruthy();
  });

  it('refuses a version whose document belongs to another tenant', async () => {
    const other = await chamberWithCalledSerial(db.prisma, 'doc2');
    const id = await document();
    const e = await db.prisma.documentVersion
      .create({
        data: {
          id: newId(),
          tenantId: other.tenantId,
          documentId: id,
          revision: 1,
          storageAdapter: 'disk',
          storageKey: `t/${other.tenantId}/prescription-pdf/${id}/1`,
          contentType: 'application/pdf',
          sizeBytes: BigInt(10),
          sha256: sha('b'),
          scanStatus: 'CLEAN',
          scanAdapter: 'generated:prescription-pdf',
          scannedAt: now,
          createdAt: now,
          updatedAt: now,
        } as never,
      })
      .catch((x: unknown) => x);
    // The composite FK is what stops a cross-tenant read from being one row away. Asserted by kind:
    // MariaDB's foreign-key message does not name the constraint in a form the parser can extract.
    expect(dbErrorInfo(e).kind).toBe('REFERENCE_VIOLATION');
  });
});
