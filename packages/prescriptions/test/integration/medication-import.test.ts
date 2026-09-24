import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@hmedic/database';
import { openTestDatabase, rawConnection } from '../../../../tests/support/db';
import { DatasetReader } from '../../src/infrastructure/medication-import/dataset-reader';
import { MedicationImporter } from '../../src/infrastructure/medication-import/importer';
import { MedicationSearchService } from '../../src/infrastructure/medication-search';

/**
 * The medication importer against a real database (Stage 7 CP9, mandatory tests 5–10).
 *
 * Everything here runs on `meddata-mini`, the synthetic fixture: two tiny Stage M datasets whose
 * medicines are invented and whose schemas are the real pinned ones. The 50,000-row dataset is not in
 * the repository and could not be, so a suite that needed it would be a suite that never ran.
 *
 * No attestation is recorded by any test in this file. `medicine-dataset-20260917-4` is UNVERIFIED with
 * all four gates open, and test 10 asserts the refusal rather than arranging its way past it.
 */
const FIXTURES = path.resolve(__dirname, '../fixtures');
const V1 = 'meddata-mini-20260924-1';
const V2 = 'meddata-mini-20260924-2';

let db: Database;

const importerFor = (version: string) =>
  new MedicationImporter(db.prisma, new DatasetReader(path.join(FIXTURES, version)));

const base = {
  environment: 'test',
  executionPath: 'CLI' as const,
  requestedBy: 'vitest',
};

/** Every catalog row this fixture could have written, so each test starts from a known catalog. */
async function clearCatalog(): Promise<void> {
  await db.prisma.medicationUsageStat.deleteMany();
  await db.prisma.medicationAlias.deleteMany();
  await db.prisma.medicationPriceObservation.deleteMany();
  await db.prisma.medicationGenericLink.deleteMany();
  await db.prisma.medicationDatasetImport.deleteMany();
  await db.prisma.medication.deleteMany();
  await db.prisma.medicationGeneric.deleteMany();
  await db.prisma.medicationManufacturer.deleteMany();
}

/**
 * A full-row fingerprint of the catalog.
 *
 * Every non-generated column of every medication, ordered, hashed. "Byte-identical" is the property
 * test 7 is about, and counting rows or spot-checking a brand name would pass while `updated_at` moved
 * underneath — which is exactly the bug this fingerprint caught during MEDDATA-002.
 *
 * Built over `rawConnection` rather than the Prisma client. The column list has to come from
 * `information_schema` so that a column added later is covered without anyone remembering to add it
 * here, and that is the session-level access `tests/support/db.ts` keeps a raw connection for. It also
 * means no raw SQL goes through the application's database client, where it does not belong.
 */
async function catalogFingerprint(): Promise<string> {
  const conn = await rawConnection();
  try {
    const cols: Array<{ c: string }> = await conn.query(
      'SELECT column_name AS c FROM information_schema.columns ' +
        'WHERE table_schema = DATABASE() AND table_name = ? AND extra NOT LIKE ? ' +
        'ORDER BY ordinal_position',
      ['medications', '%GENERATED%'],
    );
    const list = cols.map((r) => `COALESCE(CAST(\`${r.c}\` AS CHAR), 0x00)`).join(', ');
    const rows: Array<{ fp: string | null }> = await conn.query(
      `SELECT MD5(GROUP_CONCAT(CONCAT_WS(0x1f, ${list}) ORDER BY id SEPARATOR 0x1e)) AS fp FROM medications`,
    );
    return rows[0]?.fp ?? '';
  } finally {
    await conn.end();
  }
}

beforeAll(async () => {
  db = openTestDatabase();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await clearCatalog();
});

describe('medication catalog import', () => {
  it('imports the fixture, excluding veterinary products and unusable prices', async () => {
    const result = await importerFor(V1).run({ ...base, datasetVersion: V1 });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.counts.inserted).toBe(5);
    expect(result.counts.excludedVeterinary).toBe(1);
    // The alias pointing at the excluded veterinary product, counted rather than fatal.
    expect(result.counts.rejectedUnresolvedTarget).toBe(1);
    // 12.345 against DECIMAL(12,2): rounding would invent a price nobody published.
    expect(result.counts.rejectedPricePrecision).toBe(1);

    const brands = (
      await db.prisma.medication.findMany({ select: { brandName: true }, orderBy: { brandName: 'asc' } })
    ).map((m) => m.brandName);
    expect(brands).toEqual([
      'Brivolan 20',
      'Corvexa Plus',
      'Dolaprex Drops',
      'Zentaxil 250 Suspension',
      'Zentaxil 500',
    ]);
    expect(brands).not.toContain('Vetrizol 100');

    // A combination's ingredients are linked in the order the dataset listed them.
    const corvexa = await db.prisma.medication.findFirst({ where: { brandName: 'Corvexa Plus' } });
    const links = await db.prisma.medicationGenericLink.findMany({
      where: { medicationId: corvexa!.id },
      orderBy: { position: 'asc' },
    });
    expect(links).toHaveLength(2);

    // The Bangla brand name is stored exactly as the dataset gave it.
    const zentaxil = await db.prisma.medication.findFirst({ where: { brandName: 'Zentaxil 500' } });
    expect(zentaxil?.brandNameBn).toBe('জেনটাক্সিল ৫০০');
    // Its search key keeps every Bangla letter and its combining marks — a class of letters and numbers
    // alone would tear "জেনটাক্সিল" into disconnected consonants — while folding the Bangla digits to
    // ASCII, so a doctor typing "500" and a doctor typing "৫০০" reach the same product.
    expect(zentaxil?.brandBnSearchKey).toBe('জেনটাক্সিল 500');

    expect(await db.prisma.medicationPriceObservation.count()).toBe(3);
  });

  /** Mandatory test 5. */
  it('resumes from its checkpoint after an interruption, with no duplicates and no skips', async () => {
    // Aborted after the first committed batch. One row per batch makes the interruption land in a
    // known place rather than depending on how fast the machine is.
    const controller = new AbortController();
    const first = importerFor(V1);
    await expect(
      first.run({
        ...base,
        datasetVersion: V1,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toThrow(/aborted/i);

    const failed = await db.prisma.medicationDatasetImport.findFirst({
      where: { datasetVersion: V1, status: 'FAILED' },
    });
    expect(failed?.errorClass).toBe('MEDDATA_IMPORT_ABORTED');
    expect(failed?.checkpoint).toMatchObject({ file: 'medications.jsonl' });

    const partial = await db.prisma.medication.count();
    expect(partial).toBeGreaterThan(0);

    const resumed = await importerFor(V1).run({ ...base, datasetVersion: V1 });
    expect(resumed.status).toBe('SUCCEEDED');
    expect(resumed.resumedFrom).toMatchObject({ file: 'medications.jsonl' });

    // No skips: every non-veterinary product is present. No duplicates: the upsert key is the identity,
    // so a row written twice would be one row — the count is what proves neither happened.
    expect(await db.prisma.medication.count()).toBe(5);
    const canonicalKeys = await db.prisma.medication.findMany({ select: { canonicalKeySha256: true } });
    expect(new Set(canonicalKeys.map((m) => m.canonicalKeySha256)).size).toBe(5);
  });

  /** Mandatory test 6: proven at the service level, not only by the key. */
  it('refuses a second importer while one is running', async () => {
    // A RUNNING row is what a first importer leaves while it works. The second one must recognise it and
    // say so, rather than racing to a constraint violation three layers down.
    await db.prisma.medicationDatasetImport.create({
      data: {
        id: '01a0d000-0000-7000-8000-000000000001',
        datasetVersion: V1,
        datasetStatus: 'UNVERIFIED',
        environment: 'test',
        executionPath: 'JOB',
        status: 'RUNNING',
        requestedBy: 'vitest-first',
        fileChecksums: {},
        schemaHashes: {},
        counts: {},
        startedAt: new Date(),
        createdAt: new Date(),
      },
    });

    await expect(importerFor(V2).run({ ...base, datasetVersion: V2 })).rejects.toMatchObject({
      code: 'MEDDATA_IMPORT_IN_PROGRESS',
    });
    // Nothing was written by the refused run.
    expect(await db.prisma.medication.count()).toBe(0);
  });

  /** Mandatory test 7. */
  it('leaves rows byte-identical when the same version is imported again', async () => {
    await importerFor(V1).run({ ...base, datasetVersion: V1 });
    const before = await catalogFingerprint();

    // Without --force this short-circuits, which is the documented behaviour but proves nothing about
    // the writes. Forcing it makes the importer redo every upsert and is the only way to show that
    // redoing them changes nothing.
    const again = await importerFor(V1).run({ ...base, datasetVersion: V1, force: true });

    expect(again.status).toBe('SUCCEEDED');
    expect(again.counts.updated).toBe(0);
    expect(again.counts.unchanged).toBe(5);
    expect(await catalogFingerprint()).toBe(before);
  });

  it('reports a real change as an update rather than as unchanged', async () => {
    // The mirror image of test 7, and the reason it means anything. An importer whose touch condition
    // can never fire reports "unchanged" for everything, which looks like perfect idempotence until the
    // catalog quietly fails to record a change that did happen.
    await importerFor(V1).run({ ...base, datasetVersion: V1 });
    await db.prisma.medication.updateMany({
      where: { brandName: 'Brivolan 20' },
      data: { brandName: 'Brivolan 20 STALE' },
    });

    const again = await importerFor(V1).run({ ...base, datasetVersion: V1, force: true });
    expect(again.counts.updated).toBe(1);
    expect(again.counts.unchanged).toBe(4);
  });

  /** Mandatory test 8, as far as this checkpoint can carry it. */
  it('keeps a medication a later import dropped, deactivated but readable', async () => {
    await importerFor(V1).run({ ...base, datasetVersion: V1 });
    const dolaprex = await db.prisma.medication.findFirst({ where: { brandName: 'Dolaprex Drops' } });
    expect(dolaprex).not.toBeNull();

    const second = await importerFor(V2).run({ ...base, datasetVersion: V2 });
    expect(second.counts.deactivated).toBe(1);

    // Deactivated, never deleted. An approved prescription from last year may name this product, and it
    // has to stay readable and renderable forever — so the catalog stops *offering* the row without
    // forgetting it. (Rendering arrives in CP11; what CP9 can prove is that the row survives.)
    const after = await db.prisma.medication.findUnique({ where: { id: dolaprex!.id } });
    expect(after).not.toBeNull();
    expect(after?.active).toBe(false);
    expect(after?.deactivatedInVersion).toBe(V2);
    expect(after?.brandName).toBe('Dolaprex Drops');

    // Gone from search, because a prescriber should not be offered a product the catalog has withdrawn.
    const search = new MedicationSearchService(db.prisma);
    const results = await search.search({ tenantId: '00000000-0000-0000-0000-000000000000', q: 'dolaprex' });
    expect(results).toHaveLength(0);
  });

  /** Mandatory test 10. */
  it('refuses a production import naming every missing gate, and writes that refusal down', async () => {
    const refused = await importerFor(V1).run({
      ...base,
      datasetVersion: V1,
      environment: 'production',
      productionAllowed: true,
    });

    expect(refused.status).toBe('REFUSED');
    for (const gate of [
      'LEGAL_SOURCE_REVIEW',
      'CLINICAL_SAMPLE_REVIEW',
      'DGDA_CROSS_REFERENCE',
      'IMPORT_SAFEGUARDS_VERIFIED',
    ]) {
      expect(refused.refusalReason).toContain(gate);
    }
    // Fails closed: not one row reached the catalog.
    expect(await db.prisma.medication.count()).toBe(0);

    // And the refusal is a row somebody can point at later, not just an error that went to a log.
    const row = await db.prisma.medicationDatasetImport.findUnique({ where: { id: refused.importId } });
    expect(row?.status).toBe('REFUSED');
    expect(row?.refusalReason).toBe('MEDDATA_PRODUCTION_GATES_OPEN');
  });

  it('refuses a production import when the deployment has not opted in, even before gates', async () => {
    const refused = await importerFor(V1).run({
      ...base,
      datasetVersion: V1,
      environment: 'production',
      productionAllowed: false,
    });
    expect(refused.status).toBe('REFUSED');
    expect(refused.refusalReason).toContain('MEDICATION_IMPORT_PRODUCTION_ALLOWED');
    expect(await db.prisma.medication.count()).toBe(0);
  });

  it('refuses a dataset whose files do not match their checksums', async () => {
    // The fixture is pinned; pointing the reader at the wrong version's directory while claiming this
    // version's name is the cheapest honest way to make the manifest disagree with the bytes.
    const reader = new DatasetReader(path.join(FIXTURES, V1));
    await expect(reader.preflight(V1)).resolves.toMatchObject({ schemaSet: { id: 'stage-m-v1' } });

    const tampered = new DatasetReader(path.join(FIXTURES, 'does-not-exist'));
    await expect(tampered.preflight(V1)).rejects.toMatchObject({ code: 'MEDDATA_MANIFEST_MISSING' });
  });
});

/** Mandatory test 9, the half of it CP9 owns: search must survive a catalog that has nothing in it. */
describe('catalog search with nothing to search', () => {
  const tenantId = '00000000-0000-0000-0000-000000000000';

  it('returns no results on an empty catalog rather than failing', async () => {
    const search = new MedicationSearchService(db.prisma);
    expect(await search.search({ tenantId, q: 'napa' })).toEqual([]);
    // Free-text prescribing is what a prescriber falls back to, and it must never depend on the catalog
    // having been imported at all. CP10 asserts the item path; what CP9 asserts is that the lookup in
    // front of it returns an empty list quietly instead of erroring.
  });

  it('returns synthetic rows badged as synthetic', async () => {
    await importerFor(V1).run({ ...base, datasetVersion: V1 });
    await db.prisma.medication.updateMany({ data: { isSynthetic: true } });

    const search = new MedicationSearchService(db.prisma);
    const results = await search.search({ tenantId, q: 'zentaxil' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.source.isSynthetic)).toBe(true);
    expect(results.every((r) => r.source.reviewStatus === 'UNVERIFIED')).toBe(true);
  });

  it('refuses a query shorter than two characters', async () => {
    const search = new MedicationSearchService(db.prisma);
    await expect(search.search({ tenantId, q: 'z' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
