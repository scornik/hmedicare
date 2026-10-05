import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { JobRegistry, JobRunner } from '@hmedic/jobs';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { MedicationSearchService } from '../../src/infrastructure/medication-search';
import {
  MAINTENANCE_QUEUE,
  RECORD_MEDICATION_USAGE,
  registerMedicationUsageJobs,
} from '../../src/infrastructure/usage-jobs';

/**
 * `RecordMedicationUsage`, the `PrescriptionApproved` consumer (EVENT-ARCHITECTURE §4).
 *
 * What is worth asserting is not that a counter goes up — it is what the consumer refuses to count: a
 * prescription voided before the job ran, a free-text line that names no catalog row, and anything
 * belonging to another tenant. The boost is an ordering hint, and a hint built from the wrong rows is
 * worse than no hint, because nobody checks it.
 */
let db: Database;
let registry: JobRegistry;
let runner: JobRunner;

/** Filled per test by the shared fixture: a prescription hangs off a real encounter. */
let TENANT = '';
let scaffold: { patientId: string; doctorProfileId: string; encounterId: string };
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
  await db.prisma.medicationUsageStat.deleteMany();
  await db.prisma.medication.deleteMany();

  registry = new JobRegistry();
  runner = new JobRunner(db.prisma, registry, { app: 'test', strategy: 'skip_locked' });
  revisionSeq = 0;
  registerMedicationUsageJobs(registry, runner, {
    prisma: db.prisma,
    search: new MedicationSearchService(db.prisma),
  });

  const base = await chamberWithCalledSerial(db.prisma, 'usage');
  TENANT = base.tenantId;
  const encounterId = newId();
  await db.prisma.encounter.create({
    data: {
      id: encounterId,
      tenantId: base.tenantId,
      patientId: base.patientId,
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
  scaffold = {
    patientId: base.patientId,
    doctorProfileId: base.doctorProfileId,
    encounterId,
  };
});

async function medication() {
  const id = newId();
  await db.prisma.medication.create({
    data: {
      id,
      canonicalKey: `synthetic:${id}`,
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
      manufacturerDisplay: 'DEMO Labs',
      dgdaMatch: 'NOT_CHECKED',
      reviewStatus: 'UNVERIFIED',
      sourceIds: [],
      fieldProvenance: {},
      importedAt: now,
      updatedAt: now,
    },
  });
  return id;
}

/** A prescription row with its items, written directly — the lifecycle is tested elsewhere. */
let revisionSeq = 0;

async function prescription(
  clinicalStatus: string,
  items: Array<{ medicationId: string | null; freeTextName?: string }>,
) {
  const id = newId();
  // `uq_prescriptions_revision` is per encounter, so each row in a test needs its own number.
  const revision = ++revisionSeq;
  await db.prisma.prescription.create({
    data: {
      id,
      tenantId: TENANT,
      patientId: scaffold.patientId,
      encounterId: scaffold.encounterId,
      doctorProfileId: scaffold.doctorProfileId,
      revision,
      clinicalStatus,
      renderStatus: 'NOT_REQUESTED',
      ...(clinicalStatus === 'APPROVED'
        ? {
            approvedByDoctorProfileId: scaffold.doctorProfileId,
            approvedAt: now,
            attestationVersion: 1,
            approvedSnapshotSha256: sha('snap'),
          }
        : {}),
      ...(clinicalStatus === 'VOID' ? { voidReason: 'SYNTHETIC' } : {}),
      createdAt: now,
      updatedAt: now,
    } as never,
  });
  await db.prisma.prescriptionItem.createMany({
    data: items.map((i, n) => ({
      id: newId(),
      tenantId: TENANT,
      prescriptionId: id,
      sequence: n + 1,
      medicationId: i.medicationId,
      medicationDatasetVersion: i.medicationId ? 'test-v1' : null,
      isFreeText: i.medicationId === null,
      freeTextName: i.medicationId === null ? (i.freeTextName ?? 'SYNTHETIC syrup') : null,
      dose: '1 tablet',
      frequency: 'twice daily',
      duration: '5 days',
      substitutionAllowed: true,
    })),
  });
  return id;
}

/** Enqueues the handler's job directly and runs it, as the outbox publisher would. */
async function runConsumer(prescriptionId: string): Promise<string> {
  const jobId = newId();
  await db.prisma.job.create({
    data: {
      id: jobId,
      queue: MAINTENANCE_QUEUE,
      type: RECORD_MEDICATION_USAGE,
      payload: { v: 1, prescriptionId, tenantId: TENANT },
      status: 'QUEUED',
      runAt: new Date(),
      correlationId: newId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const claimed = await runner.claim(MAINTENANCE_QUEUE, 5);
  const target = claimed.find((j) => j.id === jobId);
  if (!target) throw new Error('job was not claimed');
  return runner.execute(target);
}

describe('RecordMedicationUsage', () => {
  it('counts each catalog medication on an approved prescription', async () => {
    const a = await medication();
    const b = await medication();
    const id = await prescription('APPROVED', [{ medicationId: a }, { medicationId: b }]);

    expect(await runConsumer(id)).toBe('SUCCEEDED');

    const stats = await db.prisma.medicationUsageStat.findMany({ where: { tenantId: TENANT } });
    expect(stats).toHaveLength(2);
    expect(stats.every((s) => s.prescribedCount === 1)).toBe(true);
    expect(stats.every((s) => s.lastPrescribedAt !== null)).toBe(true);
  });

  it('increments rather than overwrites, and a replayed event counts again', async () => {
    const a = await medication();
    const id = await prescription('APPROVED', [{ medicationId: a }]);

    expect(await runConsumer(id)).toBe('SUCCEEDED');
    expect(await runConsumer(id)).toBe('SUCCEEDED');

    // Two runs, count two. The outbox gives one job per event per handler, so this only happens on a
    // genuine replay — and the weakness is bounded on purpose: the boost orders rows inside a tier and
    // can never move one across a tier, so an over-count changes an ordering hint and nothing clinical.
    const stat = await db.prisma.medicationUsageStat.findFirstOrThrow({
      where: { tenantId: TENANT, medicationId: a },
    });
    expect(stat.prescribedCount).toBe(2);
  });

  it('counts nothing for a prescription voided before the job ran', async () => {
    const a = await medication();
    // Approved and then withdrawn. Counting it would record a prescription the patient never kept.
    const id = await prescription('VOID', [{ medicationId: a }]);

    expect(await runConsumer(id)).toBe('SUCCEEDED');
    expect(await db.prisma.medicationUsageStat.count({ where: { tenantId: TENANT } })).toBe(0);
  });

  it('counts nothing for a free-text-only prescription', async () => {
    // A free-text line names no catalog row, so a clinic that prescribes mostly free text gets no
    // boost rather than a wrong one.
    const id = await prescription('APPROVED', [{ medicationId: null }]);

    expect(await runConsumer(id)).toBe('SUCCEEDED');
    expect(await db.prisma.medicationUsageStat.count({ where: { tenantId: TENANT } })).toBe(0);
  });

  it('counts only the catalog lines of a mixed prescription', async () => {
    const a = await medication();
    const id = await prescription('APPROVED', [{ medicationId: a }, { medicationId: null }]);

    expect(await runConsumer(id)).toBe('SUCCEEDED');
    const stats = await db.prisma.medicationUsageStat.findMany({ where: { tenantId: TENANT } });
    expect(stats.map((s) => s.medicationId)).toEqual([a]);
  });

  it('dead-letters rather than retrying when the prescription does not exist', async () => {
    // Nothing a retry can fix: the row is gone or belongs to another tenant.
    expect(await runConsumer(newId())).toBe('DEAD');
  });
});
