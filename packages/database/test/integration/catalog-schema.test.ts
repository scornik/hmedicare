import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import { type Database, dbErrorInfo } from '../../src';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

/**
 * MEDDATA-001, migration 0019. The medication catalog's invariants, asserted against the engine.
 *
 * These matter more than most schema rules because the catalog is the one part of this system filled from
 * outside it. An importer runs unattended over 50,000 rows from a dataset nobody in the building wrote,
 * and the service that calls it can be bypassed by a repair script or the next person's CLI. What the
 * database refuses is what actually holds.
 *
 * Written through the typed client rather than raw SQL, for the same reason the encounter suite is: the
 * schema has 54 tables and a hand-written INSERT discovers its required columns one failure at a time.
 */
let db: Database;

beforeAll(async () => {
  db = openTestDatabase();
  await truncateAll();
  await db.prisma.medicationAlias.deleteMany();
  await db.prisma.medicationPriceObservation.deleteMany();
  await db.prisma.medicationGenericLink.deleteMany();
  await db.prisma.medicationDatasetImport.deleteMany();
  await db.prisma.medication.deleteMany();
  await db.prisma.medicationGeneric.deleteMany();
  await db.prisma.medicationManufacturer.deleteMany();
});
afterAll(async () => {
  await db?.close();
});

const now = () => new Date();
const sha = (seed: string) => seed.padEnd(64, '0').slice(0, 64);

/** A medication row with everything the importer would supply. */
async function medication(
  over: Partial<Parameters<Database['prisma']['medication']['create']>[0]['data']> = {},
) {
  const id = newId();
  const key = `synthetic:${id}`;
  return db.prisma.medication.create({
    data: {
      id,
      canonicalKey: key,
      canonicalKeySha256: sha(id.replace(/-/g, '')),
      datasetRecordId: `syn_${id.replace(/-/g, '').slice(0, 16)}`,
      datasetVersion: 'test-v1',
      firstSeenVersion: 'test-v1',
      brandName: 'DEMO-Synthacillin',
      brandSearchKey: 'demo synthacillin',
      genericDisplay: 'DEMO Generic A',
      genericSetKey: 'demo generic a',
      strengthParsed: {},
      dosageForm: 'tablet',
      dosageFormRaw: [],
      manufacturerDisplay: 'DEMO Manufacturer',
      dgdaMatch: 'NOT_CHECKED',
      reviewStatus: 'UNVERIFIED',
      sourceIds: [],
      fieldProvenance: {},
      isSynthetic: true,
      importedAt: now(),
      updatedAt: now(),
      ...over,
    },
  });
}

async function refused(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'ACCEPTED';
  } catch (e) {
    const info = dbErrorInfo(e);
    return info.constraint ?? info.kind ?? 'REFUSED';
  }
}

describe('the catalog cannot hold two of the same thing', () => {
  it('refuses a second medication with the same canonical key', async () => {
    const first = await medication();
    // The importer upserts on this hash. If the database allowed a duplicate, a re-import would quietly
    // produce two rows for one medicine and a doctor would see the same brand twice with different ids.
    expect(await refused(() => medication({ canonicalKeySha256: first.canonicalKeySha256 }))).not.toBe(
      'ACCEPTED',
    );
  });

  it('refuses a second medication with the same dataset record id', async () => {
    const first = await medication();
    expect(await refused(() => medication({ datasetRecordId: first.datasetRecordId }))).not.toBe('ACCEPTED');
  });

  it('refuses the same alias spelling twice for the same target', async () => {
    const med = await medication();
    const identity = sha(`alias${med.id.replace(/-/g, '')}`);
    const alias = {
      tenantless: true,
      targetType: 'MEDICATION',
      medicationId: med.id,
      alias: 'DEMO-সিনথাসিলিন',
      aliasSearchKey: 'demo synthacillin bn',
      script: 'bengali',
      kind: 'brand_bn',
      aliasOrigin: 'source',
      sources: [],
      datasetVersion: 'test-v1',
      aliasIdentitySha256: identity,
    };
    const { tenantless: _t, ...data } = alias;
    await db.prisma.medicationAlias.create({ data: { id: newId(), ...data } });
    expect(
      await refused(() => db.prisma.medicationAlias.create({ data: { id: newId(), ...data } })),
    ).not.toBe('ACCEPTED');
  });
});

describe('an alias points at exactly one thing', () => {
  it('refuses a MEDICATION alias that also names a generic, and one that names neither', async () => {
    const med = await medication();
    const generic = await db.prisma.medicationGeneric.create({
      data: {
        id: newId(),
        genericKey: 'demo-generic-a',
        genericKeySha256: sha('generic-a'),
        name: 'DEMO Generic A',
        nameSearchKey: 'demo generic a',
        aliases: [],
        saltForms: [],
        datasetRecordId: `syn_${newId().replace(/-/g, '').slice(0, 16)}`,
        datasetVersion: 'test-v1',
      },
    });
    const base = {
      alias: 'DEMO alias',
      aliasSearchKey: 'demo alias',
      script: 'latin',
      kind: 'brand_variant',
      aliasOrigin: 'generated',
      sources: [],
      datasetVersion: 'test-v1',
    };

    // Both targets: a search hit that belongs to two different things.
    expect(
      await refused(() =>
        db.prisma.medicationAlias.create({
          data: {
            id: newId(),
            targetType: 'MEDICATION',
            medicationId: med.id,
            genericId: generic.id,
            aliasIdentitySha256: sha('both'),
            ...base,
          },
        }),
      ),
    ).not.toBe('ACCEPTED');

    // Neither: a search hit that belongs to nothing.
    expect(
      await refused(() =>
        db.prisma.medicationAlias.create({
          data: {
            id: newId(),
            targetType: 'MEDICATION',
            aliasIdentitySha256: sha('neither'),
            ...base,
          },
        }),
      ),
    ).not.toBe('ACCEPTED');
  });
});

describe('an import says what it did', () => {
  const importRow = (over: Record<string, unknown> = {}) => ({
    id: newId(),
    datasetVersion: 'test-v1',
    datasetStatus: 'UNVERIFIED',
    environment: 'development',
    executionPath: 'CLI',
    status: 'SUCCEEDED',
    requestedBy: 'cli:test',
    fileChecksums: {},
    schemaHashes: {},
    counts: {},
    createdAt: now(),
    ...over,
  });

  it('allows only one import to be in flight', async () => {
    await db.prisma.medicationDatasetImport.deleteMany();
    await db.prisma.medicationDatasetImport.create({ data: importRow({ status: 'RUNNING' }) });
    // Two importers upserting the same catalog concurrently would interleave and leave a version nobody
    // can reproduce. The generated key makes that impossible rather than merely discouraged.
    expect(
      await refused(() =>
        db.prisma.medicationDatasetImport.create({
          data: importRow({ status: 'QUEUED', datasetVersion: 'test-v2' }),
        }),
      ),
    ).not.toBe('ACCEPTED');
  });

  it('allows only one successful import per dataset version', async () => {
    await db.prisma.medicationDatasetImport.deleteMany();
    await db.prisma.medicationDatasetImport.create({ data: importRow() });
    expect(await refused(() => db.prisma.medicationDatasetImport.create({ data: importRow() }))).not.toBe(
      'ACCEPTED',
    );

    // A failed attempt at the same version is fine: failures are history, not results.
    await db.prisma.medicationDatasetImport.create({
      data: importRow({ status: 'FAILED', errorClass: 'SCHEMA_MISMATCH' }),
    });
    expect(await db.prisma.medicationDatasetImport.count({ where: { datasetVersion: 'test-v1' } })).toBe(2);
  });

  it('refuses a refusal with no reason', async () => {
    await db.prisma.medicationDatasetImport.deleteMany();
    // REFUSED with nothing attached is the shape of a gate that was skipped rather than failed.
    expect(
      await refused(() =>
        db.prisma.medicationDatasetImport.create({ data: importRow({ status: 'REFUSED' }) }),
      ),
    ).not.toBe('ACCEPTED');

    const ok = await db.prisma.medicationDatasetImport.create({
      data: importRow({ status: 'REFUSED', refusalReason: 'GATES_NOT_ATTESTED' }),
    });
    expect(ok.refusalReason).toBe('GATES_NOT_ATTESTED');
  });
});

describe('a gate is attested once per dataset version', () => {
  it('refuses a second attestation of the same gate', async () => {
    const tenantUser = await db.prisma.user.create({
      data: {
        id: newId(),
        email: `${newId()}@example.invalid`,
        emailNormalized: `${newId()}@example.invalid`,
        status: 'ACTIVE',
        createdAt: now(),
        updatedAt: now(),
      },
    });
    // A unique version per run rather than clearing the table: attestations are append-only and
    // hash-chained, and a test that deletes them would be rehearsing the one operation that must never
    // happen. The ESLint rule forbids it, which is how this was caught.
    const version = `test-${newId().slice(-12)}`;
    let seq = 0n;
    const row = (over: Record<string, unknown> = {}) => ({
      id: newId(),
      seq: ++seq,
      datasetVersion: version,
      gateCode: 'LEGAL_SOURCE_REVIEW',
      evidenceRef: 'DEMO evidence reference',
      summary: 'DEMO: reviewed, 0 of 0 sampled',
      recordedByUserId: tenantUser.id,
      recordedAt: now(),
      rowHash: sha('gate1'),
      ...over,
    });
    const first = await db.prisma.medicationDatasetGateAttestation.create({ data: row() });
    // Attesting the same gate twice would let a later, weaker review quietly stand beside the first.
    expect(
      await refused(() =>
        db.prisma.medicationDatasetGateAttestation.create({
          data: row({ rowHash: sha('gate2'), prevRowHash: first.rowHash }),
        }),
      ),
    ).not.toBe('ACCEPTED');

    // A different gate on the same version is exactly what the four-gate design expects.
    const second = await db.prisma.medicationDatasetGateAttestation.create({
      data: {
        ...row({ gateCode: 'DGDA_CROSS_REFERENCE', rowHash: sha('gate2') }),
        prevRowHash: first.rowHash,
      },
    });
    expect(second.gateCode).toBe('DGDA_CROSS_REFERENCE');
  });
});

describe('what the patient is already taking', () => {
  it('needs a catalog entry or a name, and accepts a name alone', async () => {
    const tenantId = newId();
    await db.prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'DEMO catalog',
        slug: tenantId,
        status: 'ACTIVE',
        createdAt: now(),
        updatedAt: now(),
      },
    });
    const patientId = newId();
    await db.prisma.patient.create({
      data: {
        id: patientId,
        tenantId,
        medicalRecordNumber: patientId.slice(-12),
        legalName: 'SYNTHETIC Patient',
        displayName: 'SYNTHETIC Patient',
        status: 'ACTIVE',
        createdAt: now(),
        updatedAt: now(),
      },
    });
    const base = {
      tenantId,
      patientId,
      status: 'ACTIVE',
      createdAt: now(),
      updatedAt: now(),
    };

    expect(
      await refused(() => db.prisma.patientMedication.create({ data: { id: newId(), ...base } })),
    ).not.toBe('ACCEPTED');

    // A patient arrives with a strip of tablets whose brand is in no dataset. Recording that is the whole
    // point of the free-text column; refusing it would lose the most clinically important thing in the room.
    const freeText = await db.prisma.patientMedication.create({
      data: { id: newId(), freeTextName: 'SYNTHETIC unlabelled tablets from another clinic', ...base },
    });
    expect(freeText.medicationId).toBeNull();

    const med = await medication();
    const linked = await db.prisma.patientMedication.create({
      data: { id: newId(), medicationId: med.id, ...base },
    });
    expect(linked.freeTextName).toBeNull();
  });
});

describe('a price observation is an observation', () => {
  it('refuses one with no price at all', async () => {
    const med = await medication();
    const base = {
      medicationId: med.id,
      datasetVersion: 'test-v1',
      sourceId: 'demo-source',
      sourceUrl: 'https://example.invalid/demo',
      observedAt: now(),
    };
    expect(
      await refused(() => db.prisma.medicationPriceObservation.create({ data: { id: newId(), ...base } })),
    ).not.toBe('ACCEPTED');

    const ok = await db.prisma.medicationPriceObservation.create({
      data: { id: newId(), unitPrice: '12.50', ...base },
    });
    // Not an official MRP unless the source says so: retail prices here vary by pharmacy, and a number
    // shown as authoritative when it is not turns a patient away at the counter.
    expect(ok.isOfficialMrp).toBe(false);
  });
});
