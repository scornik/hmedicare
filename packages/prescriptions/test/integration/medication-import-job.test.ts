import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { JobPort, JobRegistry, JobRunner } from '@hmedic/jobs';
import { PrismaAuditPort } from '@hmedic/audit';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { MedicationCatalogAdminService } from '../../src/infrastructure/medication-catalog-admin';
import {
  CATALOG_QUEUE,
  IMPORT_MEDICATION_DATASET,
  registerMedicationImportJobs,
} from '../../src/infrastructure/medication-import/jobs';
import { MedicationSearchService } from '../../src/infrastructure/medication-search';

/**
 * The whole import workflow, driven the way production drives it (MEDDATA-003).
 *
 * Every other test reaches the importer directly or through the CLI. This one goes the long way —
 * operator request → job row → runner claim → handler → catalog → search — because that is the path an
 * operator actually triggers, and every seam in it is somewhere the two halves could disagree: the
 * payload the service writes versus the schema the job declares, the staged directory the service
 * verifies versus the one the handler reads, the queue the type is registered on versus the one the
 * runner claims from.
 *
 * Nothing here records a gate attestation. The production refusal is asserted from the outside, where an
 * operator would meet it.
 */
const V1 = 'meddata-mini-20260924-1';
const OPERATOR = '01a0d900-0000-7000-8000-000000000001';

let db: Database;
let registry: JobRegistry;
let runner: JobRunner;
let jobs: JobPort;
let admin: MedicationCatalogAdminService;

/** The fixtures live at `test/fixtures/<version>/`, so `test/` + `fixtures/` is the staged layout. */
const staging = { root: path.resolve(__dirname, '..'), prefix: 'fixtures/' };

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

/** Claims and executes whatever is queued on the catalog queue, as the runner loop would. */
async function drainCatalogQueue(): Promise<string[]> {
  const outcomes: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const claimed = await runner.claim(CATALOG_QUEUE, 5);
    if (claimed.length === 0) break;
    for (const job of claimed) outcomes.push(await runner.execute(job));
  }
  return outcomes;
}

function build(environment: string, productionAllowed = false) {
  registry = new JobRegistry();
  runner = new JobRunner(db.prisma, registry, { app: 'test' });
  registerMedicationImportJobs(registry, runner, {
    prisma: db.prisma,
    environment,
    productionAllowed,
    staging,
  });
  jobs = new JobPort(db.prisma, registry);
  admin = new MedicationCatalogAdminService({
    prisma: db.prisma,
    jobs,
    audit: new PrismaAuditPort(),
    environment,
    staging,
  });
}

beforeAll(async () => {
  db = openTestDatabase();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await truncateAll();
  await clearCatalog();
  build('test');
});

describe('medication import, end to end through the job', () => {
  it('carries an operator request all the way to a searchable catalog', async () => {
    const requested = await admin.requestImport({
      actor: { userId: OPERATOR, requestId: newId() },
      datasetVersion: V1,
    });
    expect(requested).toMatchObject({ datasetVersion: V1, created: true });

    // Queued on its own queue, unattached to any tenant, carrying nothing but a version and a requester.
    const queued = await db.prisma.job.findUniqueOrThrow({ where: { id: requested.jobId } });
    expect(queued).toMatchObject({ type: IMPORT_MEDICATION_DATASET, queue: CATALOG_QUEUE, status: 'QUEUED' });
    expect(queued.tenantId).toBeNull();

    // Nothing has been imported yet: requesting is not doing.
    expect(await db.prisma.medication.count()).toBe(0);

    expect(await drainCatalogQueue()).toEqual(['SUCCEEDED']);

    const done = await db.prisma.medicationDatasetImport.findFirstOrThrow({
      where: { datasetVersion: V1 },
    });
    // The path is recorded, which is how an operator tells a job run from someone's shell.
    expect(done).toMatchObject({ status: 'SUCCEEDED', executionPath: 'JOB', requestedBy: OPERATOR });

    expect(await db.prisma.medication.count()).toBe(5);

    // And the catalog is actually usable at the far end, which is the point of importing it.
    const search = new MedicationSearchService(db.prisma);

    // "zentaxil" is a prefix of both Zentaxil products and the exact brand of neither, so both come
    // back in the prefix tier, ordered by brand. Asserting EXACT_BRAND here would have been asserting a
    // misunderstanding of the tiers rather than the catalog.
    const prefix = await search.search({ tenantId: newId(), q: 'zentaxil' });
    expect(prefix.map((h) => h.brandName)).toEqual(['Zentaxil 250 Suspension', 'Zentaxil 500']);
    expect(prefix.every((h) => h.tier === 'BRAND_PREFIX')).toBe(true);

    // The full brand is the exact match, and it outranks the prefix tier.
    const exact = await search.search({ tenantId: newId(), q: 'Zentaxil 500' });
    expect(exact[0]).toMatchObject({ tier: 'EXACT_BRAND', brandName: 'Zentaxil 500' });
    // A prescriber sees where the row came from, including that nobody has reviewed it.
    expect(exact[0]?.source).toMatchObject({ datasetVersion: V1, reviewStatus: 'UNVERIFIED' });
  });

  it('returns the same job when an operator asks twice, and imports once', async () => {
    const first = await admin.requestImport({ actor: { userId: OPERATOR }, datasetVersion: V1 });
    const second = await admin.requestImport({ actor: { userId: OPERATOR }, datasetVersion: V1 });

    expect(second.jobId).toBe(first.jobId);
    expect(second.created).toBe(false);
    expect(await db.prisma.job.count({ where: { type: IMPORT_MEDICATION_DATASET } })).toBe(1);

    await drainCatalogQueue();
    expect(await db.prisma.medication.count()).toBe(5);
  });

  it('refuses a second request while one is in flight', async () => {
    await admin.requestImport({ actor: { userId: OPERATOR }, datasetVersion: V1 });
    await drainCatalogQueue();

    // A RUNNING import is what a long job leaves behind while it works.
    await db.prisma.medicationDatasetImport.updateMany({ data: { status: 'RUNNING' } });

    await expect(
      admin.requestImport({ actor: { userId: OPERATOR }, datasetVersion: 'meddata-mini-20260924-2' }),
    ).rejects.toMatchObject({ code: 'MEDDATA_IMPORT_IN_PROGRESS' });
  });

  it('refuses a dataset that is not staged without queueing anything', async () => {
    await expect(
      admin.requestImport({ actor: { userId: OPERATOR }, datasetVersion: 'meddata-mini-absent' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await db.prisma.job.count({ where: { type: IMPORT_MEDICATION_DATASET } })).toBe(0);
  });

  it('fails closed in production and does not retry a policy refusal', async () => {
    build('production', true);

    await admin.requestImport({ actor: { userId: OPERATOR }, datasetVersion: V1 });
    // The handler throws NonRetryableJobError on a refusal: a policy decision is not a fault, and
    // retrying it would rewrite the same refusal twice more and dead-letter as if it were a bug.
    expect(await drainCatalogQueue()).toEqual(['DEAD']);

    expect(await db.prisma.medication.count()).toBe(0);
    const refused = await db.prisma.medicationDatasetImport.findFirstOrThrow({
      where: { datasetVersion: V1 },
    });
    expect(refused).toMatchObject({ status: 'REFUSED', refusalReason: 'MEDDATA_PRODUCTION_GATES_OPEN' });

    // And the operator can see which gates are missing without reading a log.
    const status = await admin.gateStatus(V1);
    expect(status.allAttested).toBe(false);
    expect(status.gates.filter((g) => !g.attested)).toHaveLength(4);
  });

  it('reports every gate as open for the real dataset version', async () => {
    // GATE-MEDDATA-PROD. No test in this repository records an attestation, so this is the true state
    // and not a fixture: `medicine-dataset-20260917-4` is UNVERIFIED and stays that way.
    const status = await admin.gateStatus('medicine-dataset-20260917-4');
    expect(status.allAttested).toBe(false);
    expect(status.gates.map((g) => g.gateCode)).toEqual([
      'LEGAL_SOURCE_REVIEW',
      'CLINICAL_SAMPLE_REVIEW',
      'DGDA_CROSS_REFERENCE',
      'IMPORT_SAFEGUARDS_VERIFIED',
    ]);
  });
});
