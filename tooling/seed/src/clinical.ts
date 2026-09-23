import { type Clock, type TenantContext, newId } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { composeClinical } from '@hmedic/clinical';
import type { ClinicalActor } from '@hmedic/clinical';
import type { SerialService } from '@hmedic/queue';

/**
 * Stage 6 clinical dataset (prompt §7): consultations with signed notes, an amendment, a voided and
 * replaced diagnosis, an encounter still running on today's board, an interrupted one, and a handful of
 * Stage 5 serials in the shape the ADR-021 backfill leaves behind.
 *
 * Every word of clinical text below is templated and prefixed `SYNTHETIC`. That is not decoration: a demo
 * database ends up on laptops, in screenshots and in bug reports, and clinical prose that reads like a
 * real consultation will eventually be mistaken for one. These read like what they are.
 */
export interface ClinicalSeedDeps {
  prisma: PrismaClient;
  audit: PrismaAuditPort;
  clock: Clock;
  serials: SerialService;
  tenantA: { tenantId: string; ownerCtx: { userId: string; tenant: TenantContext } };
  report: { created: string[] };
}

const NOTES = [
  {
    chiefComplaint: 'SYNTHETIC: fever and sore throat for three days',
    history: 'SYNTHETIC: no prior episodes recorded in this demo dataset',
    examination: 'SYNTHETIC: throat inflamed, chest clear, no rash',
    assessment: 'SYNTHETIC: viral pharyngitis, self-limiting',
    plan: 'SYNTHETIC: fluids and rest, review in one week if not settling',
  },
  {
    chiefComplaint: 'SYNTHETIC: cough for two weeks',
    history: 'SYNTHETIC: non-smoker, no known allergies (demo record)',
    examination: 'SYNTHETIC: chest clear on auscultation',
    assessment: 'SYNTHETIC: post-viral cough',
    plan: 'SYNTHETIC: reassurance, return if the cough persists beyond four weeks',
  },
  {
    chiefComplaint: 'SYNTHETIC: headache, intermittent, one month',
    history: 'SYNTHETIC: no red-flag features recorded in this demo dataset',
    examination: 'SYNTHETIC: neurological examination unremarkable',
    assessment: 'SYNTHETIC: tension-type headache',
    plan: 'SYNTHETIC: sleep and hydration advice, review in six weeks',
  },
];

export async function seedClinical(d: ClinicalSeedDeps): Promise<void> {
  const { prisma, tenantA } = d;
  const { encounters, notes, diagnoses } = composeClinical({
    prisma,
    audit: d.audit,
    serials: d.serials,
    clock: d.clock,
  });

  // Idempotent on the natural key: a database that already has encounters has been seeded.
  if ((await prisma.encounter.count({ where: { tenantId: tenantA.tenantId } })) > 0) return;

  /** The acting doctor, as the API would resolve them: user plus their own profile. */
  const asDoctor = async (doctorProfileId: string): Promise<ClinicalActor> => {
    const profile = await prisma.doctorProfile.findFirstOrThrow({
      where: { id: doctorProfileId },
      select: { userId: true },
    });
    return {
      userId: profile.userId,
      tenant: tenantA.ownerCtx.tenant,
      doctorProfileId,
      requestId: newId(),
      correlationId: newId(),
    };
  };

  const called = await prisma.serial.findMany({
    where: { tenantId: tenantA.tenantId, status: 'CALLED' },
    orderBy: { createdAt: 'asc' },
  });
  if (called.length < 3) {
    throw new Error(
      `seed: expected at least 3 CALLED serials for the clinical dataset, found ${called.length}`,
    );
  }

  const dayOf = async (serialId: string) => {
    const s = await prisma.serial.findFirstOrThrow({ where: { id: serialId } });
    const day = await prisma.chamberDay.findFirstOrThrow({ where: { id: s.chamberDayId } });
    return day;
  };

  // ---------------------------------------------------------------- 1. two completed consultations
  //
  // The first carries a single signed note; the second is amended, so the demo has a record whose history
  // shows a doctor changing their mind and saying why.
  const completed: string[] = [];
  for (const [i, serial] of called.slice(0, 2).entries()) {
    const day = await dayOf(serial.id);
    const actor = await asDoctor(day.doctorProfileId);
    const encounter = await encounters.start(actor, serial.id, { expectedRowVersion: serial.rowVersion });

    const draft = await notes.getDraft(actor, encounter.id);
    const saved = await notes.saveDraft(actor, encounter.id, {
      expectedRowVersion: draft.rowVersion,
      sections: NOTES[i]!,
    });
    await notes.sign(actor, encounter.id, { expectedRowVersion: saved.rowVersion });

    const dx = await diagnoses.add(actor, encounter.id, {
      display: NOTES[i]!.assessment.replace('SYNTHETIC: ', 'SYNTHETIC: '),
      certainty: 'PROVISIONAL',
    });

    if (i === 1) {
      // An amendment, and a diagnosis withdrawn and replaced — the two ways a signed record legitimately
      // changes, both of which leave the original readable.
      const reloaded = await notes.getDraft(actor, encounter.id);
      const corrected = await notes.saveDraft(actor, encounter.id, {
        expectedRowVersion: reloaded.rowVersion,
        sections: {
          ...NOTES[i]!,
          examination: 'SYNTHETIC: chest clear; added after reviewing the film',
        },
      });
      await notes.sign(actor, encounter.id, {
        expectedRowVersion: corrected.rowVersion,
        correctionReason: 'SYNTHETIC: chest film reviewed after the consultation',
      });
      await diagnoses.void(actor, dx.id, {
        expectedRowVersion: dx.rowVersion,
        reason: 'SYNTHETIC: superseded once the film was reviewed',
      });
      await diagnoses.add(actor, encounter.id, {
        display: 'SYNTHETIC: resolved post-viral cough',
        certainty: 'CONFIRMED',
        replacesDiagnosisId: dx.id,
      });
    }

    await diagnoses.addSymptom(actor, encounter.id, {
      display: i === 0 ? 'SYNTHETIC: fever' : 'SYNTHETIC: cough',
      source: 'PATIENT_REPORTED',
      certainty: 'CONFIRMED',
      severity: 'MODERATE',
    });

    const current = await prisma.encounter.findFirstOrThrow({ where: { id: encounter.id } });
    await encounters.complete(actor, encounter.id, { expectedRowVersion: current.rowVersion });
    completed.push(encounter.id);
  }

  // ---------------------------------------------------------------- 2. one running, one interrupted
  //
  // A board where every consultation has finished shows nothing about a working day.
  const live = called[2]!;
  const liveDay = await dayOf(live.id);
  const liveActor = await asDoctor(liveDay.doctorProfileId);
  const running = await encounters.start(liveActor, live.id, { expectedRowVersion: live.rowVersion });
  const runningDraft = await notes.getDraft(liveActor, running.id);
  await notes.saveDraft(liveActor, running.id, {
    expectedRowVersion: runningDraft.rowVersion,
    // Unsigned on purpose: this is what a half-written note looks like mid-consultation.
    sections: { chiefComplaint: NOTES[2]!.chiefComplaint, history: NOTES[2]!.history },
  });

  let interruptedId: string | null = null;
  if (called.length > 3) {
    const s = called[3]!;
    const day = await dayOf(s.id);
    const actor = await asDoctor(day.doctorProfileId);
    const e = await encounters.start(actor, s.id, { expectedRowVersion: s.rowVersion });
    const current = await prisma.encounter.findFirstOrThrow({ where: { id: e.id } });
    await encounters.interrupt(actor, e.id, {
      expectedRowVersion: current.rowVersion,
      reason: 'CALLED_AWAY',
    });
    interruptedId = e.id;
  }

  // ---------------------------------------------------------------- 3. the legacy shape
  //
  // What a database migrated from Stage 5 looks like: a completed consultation with an encounter marked
  // `legacy_interim` and no note, because none was ever written. Seeded directly rather than through the
  // retired transitions, so the dataset matches a migrated database instead of re-creating the state the
  // migration exists to remove.
  const now = d.clock.now();
  const legacyDay = await prisma.chamberDay.findFirstOrThrow({
    where: { tenantId: tenantA.tenantId },
    orderBy: { localDate: 'asc' },
  });
  const spare = await prisma.patient.findMany({
    where: {
      tenantId: tenantA.tenantId,
      status: 'ACTIVE',
      id: { notIn: (await prisma.serial.findMany({ select: { patientId: true } })).map((s) => s.patientId) },
    },
    take: 2,
    orderBy: { createdAt: 'asc' },
  });
  const highest = await prisma.serial.aggregate({
    where: { chamberDayId: legacyDay.id },
    _max: { serialNumber: true },
  });
  let legacyNumber = (highest._max.serialNumber ?? 0) + 1;
  const legacy: string[] = [];
  for (const patient of spare) {
    const serialId = newId();
    const encounterId = newId();
    const earlier = new Date(now.getTime() - 7 * 86_400_000);
    await prisma.serial.create({
      data: {
        id: serialId,
        tenantId: tenantA.tenantId,
        chamberDayId: legacyDay.id,
        patientId: patient.id,
        serialNumber: legacyNumber++,
        source: 'WALK_IN',
        careMode: 'PHYSICAL',
        status: 'COMPLETED',
        consultationStartedAt: earlier,
        completedAt: new Date(earlier.getTime() + 9 * 60_000),
        createdAt: earlier,
        updatedAt: earlier,
      },
    });
    await prisma.encounter.create({
      data: {
        id: encounterId,
        tenantId: tenantA.tenantId,
        patientId: patient.id,
        doctorProfileId: legacyDay.doctorProfileId,
        chamberId: legacyDay.chamberId,
        serialId,
        careMode: 'PHYSICAL',
        status: 'COMPLETED',
        legacyInterim: true,
        startedAt: earlier,
        completedAt: new Date(earlier.getTime() + 9 * 60_000),
        createdAt: earlier,
        updatedAt: earlier,
      },
    });
    await prisma.serial.update({ where: { id: serialId }, data: { encounterId } });
    legacy.push(encounterId);
  }

  d.report.created.push(
    `clinical: ${completed.length} completed consultations (one amended, with a voided and replaced ` +
      `diagnosis), one running with an unsigned draft, ${interruptedId ? 'one interrupted, ' : ''}` +
      `${legacy.length} legacy ADR-021 encounters with no note`,
  );
}

/** Seed assertions for the clinical dataset (SEED-DATA §4, Stage 6 §7). */
export async function verifyClinicalSeed(prisma: PrismaClient, tenantAId: string): Promise<string[]> {
  const problems: string[] = [];
  const encounters = await prisma.encounter.findMany({ where: { tenantId: tenantAId } });
  if (encounters.length === 0) return ['no encounters seeded'];

  const statuses = new Set(encounters.map((e) => e.status));
  for (const s of ['COMPLETED', 'IN_PROGRESS']) {
    if (!statuses.has(s)) problems.push(`no encounter in status ${s}`);
  }
  if (!encounters.some((e) => e.legacyInterim)) problems.push('no legacy ADR-021 encounter');

  // A legacy encounter carries no note, because none was ever written. An empty draft beside one would
  // suggest a doctor opened a record they never did.
  for (const e of encounters.filter((x) => x.legacyInterim)) {
    if ((await prisma.encounterNote.count({ where: { encounterId: e.id } })) > 0)
      problems.push(`legacy encounter ${e.id} has a note`);
  }

  const revisions = await prisma.encounterNoteVersion.findMany({
    where: { tenantId: tenantAId },
    orderBy: [{ encounterId: 'asc' }, { revision: 'asc' }],
  });
  if (revisions.length === 0) problems.push('no signed note revisions');
  if (!revisions.some((r) => r.revision === 2 && r.correctionReason))
    problems.push('no amended note with a second revision and a reason');
  // The chain has to be intact in the demo data too, or the first thing anyone verifies fails.
  const byEncounter = new Map<string, typeof revisions>();
  for (const r of revisions) byEncounter.set(r.encounterId, [...(byEncounter.get(r.encounterId) ?? []), r]);
  for (const [encounterId, rows] of byEncounter) {
    if (rows[0]?.prevRowHash !== null) problems.push(`revision 1 of ${encounterId} has a predecessor`);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]!.prevRowHash !== rows[i - 1]!.rowHash)
        problems.push(`note chain broken at revision ${rows[i]!.revision} of ${encounterId}`);
    }
  }

  const dx = await prisma.diagnosis.findMany({ where: { tenantId: tenantAId } });
  if (!dx.some((d) => d.clinicalStatus === 'ENTERED_IN_ERROR' && d.voidReason))
    problems.push('no voided diagnosis with a reason');
  if (!dx.some((d) => d.replacesDiagnosisId)) problems.push('no replacement diagnosis');
  if (dx.some((d) => d.source !== 'doctor')) problems.push('a diagnosis was not sourced to a doctor');
  if ((await prisma.symptomObservation.count({ where: { tenantId: tenantAId } })) === 0)
    problems.push('no symptom observations');

  // DATABASE §4.4, restored in Stage 6: every completed serial has an encounter behind it.
  const orphans = await prisma.serial.count({
    where: { tenantId: tenantAId, status: 'COMPLETED', encounterId: null },
  });
  if (orphans > 0) problems.push(`${orphans} COMPLETED serials with no encounter`);
  return problems;
}
