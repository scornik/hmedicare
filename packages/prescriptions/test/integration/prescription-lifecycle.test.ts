import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import { type Database, dbErrorInfo } from '@hmedic/database';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { ATTESTATION_VERSION, type PrescriptionItemInput } from '../../src/domain/prescription';

/**
 * The prescription lifecycle against the engine (Stage 7 CP10).
 *
 * These assert what the *database* refuses, not what the service promises. A service can be bypassed by
 * a repair script, a migration or the next person's CLI; a prescription that a patient was handed has to
 * stay what it was regardless of who is at the keyboard. Where a rule exists in both places, this file
 * tests the one that cannot be talked out of it.
 *
 * The tenant-doctor-encounter scaffold comes from the shared fixture rather than a local copy: the first
 * draft of this file grew its own and every required column had to be discovered one failure at a time,
 * which is the exact thing that fixture's comment warns about.
 */
let db: Database;

const sha = (seed: string) => seed.padEnd(64, '0').slice(0, 64);

beforeAll(async () => {
  db = openTestDatabase();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await truncateAll();
});

/** The shared fixture, plus the encounter a prescription hangs off. */
async function scaffold() {
  const base = await chamberWithCalledSerial(db.prisma, 'rx');
  const now = new Date();
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
  return { ...base, encounterId, now };
}

async function prescription(s: Awaited<ReturnType<typeof scaffold>>, over: Record<string, unknown> = {}) {
  const id = newId();
  return db.prisma.prescription.create({
    data: {
      id,
      tenantId: s.tenantId,
      patientId: s.patientId,
      encounterId: s.encounterId,
      doctorProfileId: s.doctorProfileId,
      revision: 1,
      clinicalStatus: 'DRAFT',
      renderStatus: 'NOT_REQUESTED',
      createdAt: s.now,
      updatedAt: s.now,
      ...over,
    } as never,
  });
}

const refused = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return 'ACCEPTED';
  } catch (error) {
    return dbErrorInfo(error)?.kind ?? 'REFUSED';
  }
};

const itemData = (prescriptionId: string, tenantId: string, over: Record<string, unknown> = {}) => ({
  id: newId(),
  tenantId,
  prescriptionId,
  sequence: 1,
  isFreeText: true,
  freeTextName: 'DEMO compounded syrup',
  dose: '5 ml',
  frequency: 'twice daily',
  duration: '3 days',
  substitutionAllowed: true,
  ...over,
});

describe('prescription invariants the database enforces', () => {
  it('permits one approved revision per encounter and refuses a second', async () => {
    const s = await scaffold();
    await prescription(s, {
      revision: 1,
      clinicalStatus: 'APPROVED',
      approvedByDoctorProfileId: s.doctorProfileId,
      approvedAt: s.now,
      attestationVersion: ATTESTATION_VERSION,
      approvedSnapshotSha256: sha('snap1'),
    });

    // Two approved revisions would mean a patient holds two valid prescriptions for one consultation.
    expect(
      await refused(() =>
        prescription(s, {
          revision: 2,
          clinicalStatus: 'APPROVED',
          approvedByDoctorProfileId: s.doctorProfileId,
          approvedAt: s.now,
          attestationVersion: ATTESTATION_VERSION,
          approvedSnapshotSha256: sha('snap2'),
        }),
      ),
    ).not.toBe('ACCEPTED');
  });

  it('permits one open draft per encounter and refuses a second', async () => {
    const s = await scaffold();
    await prescription(s, { revision: 1, clinicalStatus: 'DRAFT' });
    // Two tabs must not each grow their own draft and silently diverge.
    expect(await refused(() => prescription(s, { revision: 2, clinicalStatus: 'REVIEWED' }))).not.toBe(
      'ACCEPTED',
    );
  });

  it('allows an approved revision to coexist with the draft that will replace it', async () => {
    const s = await scaffold();
    const approved = await prescription(s, {
      revision: 1,
      clinicalStatus: 'APPROVED',
      approvedByDoctorProfileId: s.doctorProfileId,
      approvedAt: s.now,
      attestationVersion: ATTESTATION_VERSION,
      approvedSnapshotSha256: sha('snap1'),
    });
    // The correction is drafted while the approved one is still the patient's prescription. The two
    // generated keys are separate for exactly this reason.
    const draft = await prescription(s, {
      revision: 2,
      clinicalStatus: 'DRAFT',
      supersedesPrescriptionId: approved.id,
    });
    expect(draft.supersedesPrescriptionId).toBe(approved.id);
  });

  it('refuses an approved row without an approver, a time or a snapshot hash', async () => {
    const s = await scaffold();
    for (const missing of [
      { approvedByDoctorProfileId: null },
      { approvedAt: null },
      { approvedSnapshotSha256: null },
    ]) {
      expect(
        await refused(() =>
          prescription(s, {
            clinicalStatus: 'APPROVED',
            approvedByDoctorProfileId: s.doctorProfileId,
            approvedAt: s.now,
            attestationVersion: ATTESTATION_VERSION,
            approvedSnapshotSha256: sha('snap'),
            ...missing,
          }),
        ),
      ).not.toBe('ACCEPTED');
    }
  });

  it('refuses a void without a reason', async () => {
    const s = await scaffold();
    expect(await refused(() => prescription(s, { clinicalStatus: 'VOID', voidReason: null }))).not.toBe(
      'ACCEPTED',
    );
  });

  it('refuses a render on anything that is not final', async () => {
    const s = await scaffold();
    // A draft PDF is a document that can be handed over and then changed.
    for (const status of ['DRAFT', 'REVIEWED']) {
      expect(
        await refused(() => prescription(s, { clinicalStatus: status, renderStatus: 'QUEUED' })),
      ).not.toBe('ACCEPTED');
    }
    const ok = await prescription(s, {
      clinicalStatus: 'APPROVED',
      approvedByDoctorProfileId: s.doctorProfileId,
      approvedAt: s.now,
      attestationVersion: ATTESTATION_VERSION,
      approvedSnapshotSha256: sha('snap'),
      renderStatus: 'QUEUED',
    });
    expect(ok.renderStatus).toBe('QUEUED');
  });

  it('refuses an unknown clinical or render status', async () => {
    const s = await scaffold();
    expect(await refused(() => prescription(s, { clinicalStatus: 'SIGNED' }))).not.toBe('ACCEPTED');
    expect(await refused(() => prescription(s, { renderStatus: 'PRINTED' }))).not.toBe('ACCEPTED');
  });
});

describe('prescription item invariants', () => {
  it('accepts a free-text line and a catalog line', async () => {
    const s = await scaffold();
    const p = await prescription(s);
    await db.prisma.prescriptionItem.create({ data: itemData(p.id, s.tenantId) });

    const medicationId = newId();
    await db.prisma.medication.create({
      data: {
        id: medicationId,
        canonicalKey: `synthetic:${medicationId}`,
        canonicalKeySha256: sha(medicationId.replace(/-/g, '')),
        datasetRecordId: `syn_${medicationId.replace(/-/g, '').slice(0, 16)}`,
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
        importedAt: s.now,
        updatedAt: s.now,
      },
    });
    const created = await db.prisma.prescriptionItem.create({
      data: itemData(p.id, s.tenantId, {
        sequence: 2,
        isFreeText: false,
        freeTextName: null,
        medicationId,
        medicationDatasetVersion: 'test-v1',
      }),
    });
    expect(created.medicationId).toBe(medicationId);
  });

  it('refuses a line that is both a catalog item and free text, and one that is neither', async () => {
    const s = await scaffold();
    const p = await prescription(s);
    expect(
      await refused(() =>
        db.prisma.prescriptionItem.create({
          data: itemData(p.id, s.tenantId, { isFreeText: true, medicationId: newId() }),
        }),
      ),
    ).not.toBe('ACCEPTED');
    expect(
      await refused(() =>
        db.prisma.prescriptionItem.create({
          data: itemData(p.id, s.tenantId, { isFreeText: false, freeTextName: null }),
        }),
      ),
    ).not.toBe('ACCEPTED');
  });

  it('refuses a catalog line with no dataset version', async () => {
    const s = await scaffold();
    const p = await prescription(s);
    // Without it, a later import silently changes what this line meant.
    expect(
      await refused(() =>
        db.prisma.prescriptionItem.create({
          data: itemData(p.id, s.tenantId, {
            isFreeText: false,
            freeTextName: null,
            medicationId: newId(),
            medicationDatasetVersion: null,
          }),
        }),
      ),
    ).not.toBe('ACCEPTED');
  });

  it('refuses two lines at the same sequence', async () => {
    const s = await scaffold();
    const p = await prescription(s);
    await db.prisma.prescriptionItem.create({ data: itemData(p.id, s.tenantId, { sequence: 1 }) });
    expect(
      await refused(() =>
        db.prisma.prescriptionItem.create({ data: itemData(p.id, s.tenantId, { sequence: 1 }) }),
      ),
    ).not.toBe('ACCEPTED');
  });
});

/** The shape the service hands to the hash, kept beside the schema test so the two cannot drift. */
export type _ItemShapeCheck = PrescriptionItemInput;
