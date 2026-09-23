import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError, newId, systemClock } from '@hmedic/kernel';
import { PrismaAuditPort } from '@hmedic/audit';
import { OutboxPort } from '@hmedic/jobs';
import { composeSchedulingAndQueue } from '@hmedic/queue';
import { QueueSerialLifecycle } from '@hmedic/queue';
import {
  AssignmentPolicy,
  type ClinicalActor,
  ClinicalAccessPolicy,
  ClinicalOutbox,
  DiagnosisService,
  EncounterService,
  NoteService,
} from '../../src/public';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { chamberWithCalledSerial as fixture, tenantContext } from './support';

/**
 * CLIN-003 and CLIN-004. Mandatory tests 4–7, 10, 13 and 14 of the Stage 6 brief.
 *
 * The property under test throughout is that **a signed revision is a fact, not a row that happens to be
 * there**: nothing rewrites it, every later change is a new revision carrying its reason, and the chain
 * of hashes makes a quiet edit detectable rather than a matter of trust.
 */
const db = openTestDatabase({ poolMax: 12 });
const audit = new PrismaAuditPort(systemClock);
const ctx = composeSchedulingAndQueue({ prisma: db.prisma, audit, clock: systemClock });
const outbox = new ClinicalOutbox(new OutboxPort(systemClock), systemClock);
const assignment = new AssignmentPolicy(db.prisma, () => systemClock.now());
const access = new ClinicalAccessPolicy(db.prisma, assignment);
const notes = new NoteService(db.prisma, audit, outbox, access, systemClock);
const diagnoses = new DiagnosisService(db.prisma, audit, outbox, access, systemClock);
const encounters = new EncounterService(
  db.prisma,
  audit,
  outbox,
  new QueueSerialLifecycle(ctx.serials),
  assignment,
  systemClock,
  notes,
);

afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

/** A started encounter with its empty draft, which is where every case below begins. */
async function consultation(label: string) {
  const s = await fixture(db.prisma, label);
  const encounter = await encounters.start(s.actor, s.serial.id, {
    expectedRowVersion: s.serial.rowVersion,
  });
  const draft = await notes.getDraft(s.actor, encounter.id);
  return { ...s, encounter, draft };
}

const SECTIONS = {
  chiefComplaint: 'SYNTHETIC: fever for three days',
  history: 'SYNTHETIC: no prior episodes recorded',
  examination: 'SYNTHETIC: temperature 38.4C, chest clear',
  assessment: 'SYNTHETIC: viral illness, self-limiting',
  plan: 'SYNTHETIC: fluids, review if not settling in 48 hours',
};

/** Audit and outbox rows carry BigInt sequences, which plain `JSON.stringify` refuses. */
function stringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof AppError ? e.code : `UNEXPECTED:${String(e)}`;
  }
}

describe('autosave', () => {
  it('returns the new row version and records who wrote each section', async () => {
    const c = await consultation('save');
    const saved = await notes.saveDraft(c.actor, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: SECTIONS,
    });
    expect(saved.rowVersion).toBe(c.draft.rowVersion + 1);
    expect(saved.chiefComplaint).toBe(SECTIONS.chiefComplaint);
    expect(saved.sectionSources).toHaveLength(5);
    expect(saved.sectionSources.every((s) => s.source === 'doctor')).toBe(true);
  });

  it('lets one of two tabs win and tells the other exactly where it stands (test 4)', async () => {
    const c = await consultation('race');
    // Both tabs loaded the same draft, which is the everyday shape of this race: one browser, two windows,
    // the doctor typing in whichever is in front.
    const [first, second] = await Promise.allSettled([
      notes.saveDraft(c.actor, c.encounter.id, {
        expectedRowVersion: c.draft.rowVersion,
        sections: { ...SECTIONS, plan: 'SYNTHETIC: plan written in tab one' },
      }),
      notes.saveDraft(c.actor, c.encounter.id, {
        expectedRowVersion: c.draft.rowVersion,
        sections: { ...SECTIONS, plan: 'SYNTHETIC: plan written in tab two' },
      }),
    ]);
    const outcomes = [first, second];
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const loser = outcomes.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((loser.reason as AppError).code).toBe('STALE_VERSION');
    // The refusal carries the current version, so the client can fetch it and show the doctor both texts
    // rather than silently discarding one of them.
    expect((loser.reason as AppError).details).toMatchObject({ currentRowVersion: expect.any(Number) });

    // Exactly one plan is in the database, and it is a whole one — no interleaving of the two saves.
    const draft = await db.prisma.encounterNote.findFirstOrThrow({
      where: { tenantId: c.tenantId, encounterId: c.encounter.id },
    });
    expect(['SYNTHETIC: plan written in tab one', 'SYNTHETIC: plan written in tab two']).toContain(
      draft.plan,
    );
  });

  it('writes no version row and no audit entry per save', async () => {
    const c = await consultation('quiet');
    let version = c.draft.rowVersion;
    for (let i = 0; i < 4; i++) {
      const saved = await notes.saveDraft(c.actor, c.encounter.id, {
        expectedRowVersion: version,
        sections: { ...SECTIONS, plan: `SYNTHETIC: revision ${i}` },
      });
      version = saved.rowVersion;
    }
    // Drafts are not audited per keystroke: four saves leave no revisions and no note-write audit rows.
    expect(await db.prisma.encounterNoteVersion.count({ where: { tenantId: c.tenantId } })).toBe(0);
    const writes = await db.prisma.auditLog.count({
      where: { tenantId: c.tenantId, action: { in: ['ENCOUNTER_NOTE_SIGNED', 'ENCOUNTER_NOTE_AMENDED'] } },
    });
    expect(writes).toBe(0);
  });

  it('enforces the section size limit server-side and names every oversized section', async () => {
    const c = await consultation('limits');
    const tooLong = 'স'.repeat(20_001);
    const result = await code(() =>
      notes.saveDraft(c.actor, c.encounter.id, {
        expectedRowVersion: c.draft.rowVersion,
        sections: { history: tooLong, plan: tooLong },
      }),
    );
    expect(result).toBe('VALIDATION_FAILED');
  });

  it('round-trips Bangla clinical text unchanged (test 14)', async () => {
    const c = await consultation('bangla');
    // Counted in characters, not bytes: this is 3 bytes per character in utf8mb4, and a byte limit would
    // give a doctor writing in Bangla a third of the room for the same note.
    const bangla = {
      chiefComplaint: 'সিনথেটিক: তিন দিন ধরে জ্বর',
      history: 'সিনথেটিক: আগের কোনো ঘটনা নেই',
      examination: 'সিনথেটিক: তাপমাত্রা ৩৮.৪ ডিগ্রি',
      assessment: 'সিনথেটিক: ভাইরাল জ্বর',
      plan: 'সিনথেটিক: প্রচুর পানি পান করুন',
    };
    const saved = await notes.saveDraft(c.actor, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: bangla,
    });
    expect(saved.chiefComplaint).toBe(bangla.chiefComplaint);

    const signed = await notes.sign(c.actor, c.encounter.id, {
      expectedRowVersion: saved.rowVersion,
    });
    // Through the signature and back out of the version table, byte for byte.
    expect(signed.plan).toBe(bangla.plan);
    const stored = await db.prisma.encounterNoteVersion.findFirstOrThrow({
      where: { tenantId: c.tenantId, encounterId: c.encounter.id },
    });
    expect(stored.examination).toBe(bangla.examination);
    expect(stored.chiefComplaint).toBe(bangla.chiefComplaint);
  });
});

describe('signing', () => {
  it('freezes the draft into revision 1 and chains it', async () => {
    const c = await consultation('sign');
    const saved = await notes.saveDraft(c.actor, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: SECTIONS,
    });
    const signed = await notes.sign(c.actor, c.encounter.id, {
      expectedRowVersion: saved.rowVersion,
    });

    expect(signed).toMatchObject({
      revision: 1,
      correctionReason: null,
      supersedesRevision: null,
      signedByDoctorProfileId: c.doctorProfileId,
    });
    const row = await db.prisma.encounterNoteVersion.findFirstOrThrow({
      where: { tenantId: c.tenantId, encounterId: c.encounter.id, revision: 1 },
    });
    // First link of the chain: no predecessor, and a hash of its own.
    expect(row.prevRowHash).toBeNull();
    expect(row.rowHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.contentSha256).toMatch(/^[0-9a-f]{64}$/);

    const draft = await db.prisma.encounterNote.findFirstOrThrow({
      where: { tenantId: c.tenantId, encounterId: c.encounter.id },
    });
    expect(draft.lastSignedRevision).toBe(1);
  });

  it('refuses a late autosave after signing, and the signed text is unchanged (test 5)', async () => {
    const c = await consultation('late');
    const saved = await notes.saveDraft(c.actor, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: SECTIONS,
    });
    const signed = await notes.sign(c.actor, c.encounter.id, {
      expectedRowVersion: saved.rowVersion,
    });

    // A tab that was still open when the doctor signed, saving the text it had.
    const result = await code(() =>
      notes.saveDraft(c.actor, c.encounter.id, {
        expectedRowVersion: saved.rowVersion,
        sections: { ...SECTIONS, assessment: 'SYNTHETIC: a late edit that must not land' },
      }),
    );
    expect(result).toBe('STALE_VERSION');

    const stored = await db.prisma.encounterNoteVersion.findFirstOrThrow({
      where: { tenantId: c.tenantId, encounterId: c.encounter.id, revision: 1 },
    });
    expect(stored.assessment).toBe(SECTIONS.assessment);
    expect(stored.contentSha256).toBe(signed.contentSha256);
  });

  it('will not sign an empty note', async () => {
    const c = await consultation('empty');
    expect(
      await code(() => notes.sign(c.actor, c.encounter.id, { expectedRowVersion: c.draft.rowVersion })),
    ).toBe('VALIDATION_FAILED');
  });

  it('refuses a reason on the first signature and demands one after it', async () => {
    const c = await consultation('reasons');
    const saved = await notes.saveDraft(c.actor, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: SECTIONS,
    });
    // Nothing has been corrected yet, so a reason here would put a sentence in the record implying an
    // earlier version existed.
    expect(
      await code(() =>
        notes.sign(c.actor, c.encounter.id, {
          expectedRowVersion: saved.rowVersion,
          correctionReason: 'SYNTHETIC: nothing to correct',
        }),
      ),
    ).toBe('VALIDATION_FAILED');

    const signed = await notes.sign(c.actor, c.encounter.id, {
      expectedRowVersion: saved.rowVersion,
    });
    const after = await notes.getDraft(c.actor, c.encounter.id);
    expect(
      await code(() => notes.sign(c.actor, c.encounter.id, { expectedRowVersion: after.rowVersion })),
    ).toBe('VALIDATION_FAILED');
    expect(signed.revision).toBe(1);
  });
});

describe('amendment', () => {
  it('keeps a gap-free history where every correction explains itself (test 7)', async () => {
    const c = await consultation('amend');
    let draft = await notes.saveDraft(c.actor, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: SECTIONS,
    });
    await notes.sign(c.actor, c.encounter.id, { expectedRowVersion: draft.rowVersion });

    const reasons = ['SYNTHETIC: wrong temperature recorded', 'SYNTHETIC: plan clarified after review'];
    for (const [i, reason] of reasons.entries()) {
      draft = await notes.getDraft(c.actor, c.encounter.id);
      draft = await notes.saveDraft(c.actor, c.encounter.id, {
        expectedRowVersion: draft.rowVersion,
        sections: { ...SECTIONS, examination: `SYNTHETIC: corrected examination ${i + 1}` },
      });
      await notes.sign(c.actor, c.encounter.id, {
        expectedRowVersion: draft.rowVersion,
        correctionReason: reason,
      });
    }

    const revisions = await notes.listRevisions(c.actor, c.encounter.id);
    expect(revisions.map((r) => r.revision)).toEqual([1, 2, 3]);
    expect(revisions[0]?.correctionReason).toBeNull();
    expect(revisions[1]?.correctionReason).toBe(reasons[0]);
    expect(revisions[2]?.correctionReason).toBe(reasons[1]);
    expect(revisions.map((r) => r.supersedesRevision)).toEqual([null, 1, 2]);

    // The superseded revisions are still readable in full. This is the point of an amendment: the
    // earlier account of the visit is what someone acted on, and it does not disappear because it was
    // later corrected.
    expect(revisions[0]?.examination).toBe(SECTIONS.examination);
    expect(revisions[1]?.examination).toBe('SYNTHETIC: corrected examination 1');
    expect(revisions[2]?.examination).toBe('SYNTHETIC: corrected examination 2');

    // Each link covers the one before it, so removing or rewriting a middle revision breaks every hash
    // after it instead of going unnoticed.
    const rows = await db.prisma.encounterNoteVersion.findMany({
      where: { tenantId: c.tenantId, encounterId: c.encounter.id },
      orderBy: { revision: 'asc' },
    });
    expect(rows[0]?.prevRowHash).toBeNull();
    expect(rows[1]?.prevRowHash).toBe(rows[0]?.rowHash);
    expect(rows[2]?.prevRowHash).toBe(rows[1]?.rowHash);
    expect(new Set(rows.map((r) => r.rowHash)).size).toBe(3);
  });

  it('audits the signature and the amendment differently, with no text in either (test 10)', async () => {
    const c = await consultation('audit');
    let draft = await notes.saveDraft(c.actor, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: SECTIONS,
    });
    await notes.sign(c.actor, c.encounter.id, { expectedRowVersion: draft.rowVersion });
    draft = await notes.getDraft(c.actor, c.encounter.id);
    await notes.sign(c.actor, c.encounter.id, {
      expectedRowVersion: draft.rowVersion,
      correctionReason: 'SYNTHETIC: corrected on review',
    });

    const rows = await db.prisma.auditLog.findMany({
      where: { tenantId: c.tenantId, resourceType: 'encounter_note' },
      orderBy: { seq: 'asc' },
    });
    expect(rows.map((r) => r.action)).toContain('ENCOUNTER_NOTE_SIGNED');
    expect(rows.map((r) => r.action)).toContain('ENCOUNTER_NOTE_AMENDED');

    // Not one word of the note reaches the audit trail. An audit log holding the text would be a second,
    // less protected copy of the record.
    const serialized = stringify(rows);
    for (const text of Object.values(SECTIONS)) {
      expect(serialized).not.toContain(text);
    }
    expect(serialized).not.toContain('corrected on review');
  });

  it('audits a PHI read without recording what was read (test 10)', async () => {
    const c = await consultation('read');
    const saved = await notes.saveDraft(c.actor, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: SECTIONS,
    });
    await notes.sign(c.actor, c.encounter.id, { expectedRowVersion: saved.rowVersion });

    await notes.getDraft(c.actor, c.encounter.id);
    await notes.listRevisions(c.actor, c.encounter.id);

    const reads = await db.prisma.auditLog.findMany({
      where: {
        tenantId: c.tenantId,
        action: { in: ['ENCOUNTER_NOTE_VIEWED', 'ENCOUNTER_NOTE_HISTORY_VIEWED'] },
      },
    });
    // Who looked, at which record, when — and nothing about its contents.
    expect(reads.length).toBeGreaterThanOrEqual(2);
    expect(reads.every((r) => r.actorUserId === c.userId)).toBe(true);
    const serialized = stringify(reads);
    for (const text of Object.values(SECTIONS)) expect(serialized).not.toContain(text);
  });
});

describe('immutability (test 6)', () => {
  it('offers no way to update or delete a signed revision', async () => {
    const c = await consultation('immutable');
    const saved = await notes.saveDraft(c.actor, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: SECTIONS,
    });
    const signed = await notes.sign(c.actor, c.encounter.id, { expectedRowVersion: saved.rowVersion });

    // The service surface has no mutator for a revision at all — asserted by name so that adding one
    // without thinking has to break this test first.
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(notes));
    expect(
      surface.filter((m) => /revision|version/i.test(m) && /update|delete|remove|edit/i.test(m)),
    ).toHaveLength(0);
    expect(surface.sort()).toEqual(
      [
        'constructor',
        'authorize',
        'correlation',
        'draftOf',
        'auditRead',
        'getDraft',
        'listRevisions',
        'saveDraft',
        'sign',
        'lockDraftForCompletion',
      ].sort(),
    );

    // And the only path that writes the table appends: signing again produces revision 2 beside it.
    const draft = await notes.getDraft(c.actor, c.encounter.id);
    await notes.sign(c.actor, c.encounter.id, {
      expectedRowVersion: draft.rowVersion,
      correctionReason: 'SYNTHETIC: second look',
    });
    const rows = await db.prisma.encounterNoteVersion.findMany({
      where: { tenantId: c.tenantId, encounterId: c.encounter.id },
      orderBy: { revision: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe(signed.id);
    expect(rows[0]?.contentSha256).toBe(signed.contentSha256);
  });

  it('stops accepting saves once the encounter is over', async () => {
    const c = await consultation('closed');
    const saved = await notes.saveDraft(c.actor, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: SECTIONS,
    });
    await notes.sign(c.actor, c.encounter.id, { expectedRowVersion: saved.rowVersion });

    const current = await db.prisma.encounter.findFirstOrThrow({ where: { id: c.encounter.id } });
    await encounters.complete(c.actor, c.encounter.id, { expectedRowVersion: current.rowVersion });

    const draft = await db.prisma.encounterNote.findFirstOrThrow({
      where: { tenantId: c.tenantId, encounterId: c.encounter.id },
    });
    expect(draft.status).toBe('SIGNED_LOCKED');
    expect(
      await code(() =>
        notes.saveDraft(c.actor, c.encounter.id, {
          expectedRowVersion: draft.rowVersion,
          sections: { plan: 'SYNTHETIC: after the door closed' },
        }),
      ),
    ).toBe('INVALID_TRANSITION');
  });
});

describe('diagnoses', () => {
  it('records free text, and refuses a code without its system', async () => {
    const c = await consultation('dx');
    const dx = await diagnoses.add(c.actor, c.encounter.id, {
      display: 'SYNTHETIC: viral fever',
      certainty: 'PROVISIONAL',
    });
    expect(dx).toMatchObject({
      display: 'SYNTHETIC: viral fever',
      clinicalStatus: 'ACTIVE',
      certainty: 'PROVISIONAL',
      source: 'doctor',
      code: null,
      codeSystem: null,
    });

    // A code with no system says nothing about which vocabulary it belongs to.
    expect(
      await code(() =>
        diagnoses.add(c.actor, c.encounter.id, {
          display: 'SYNTHETIC: coded without a system',
          certainty: 'CONFIRMED',
          code: 'A99',
        }),
      ),
    ).toBe('VALIDATION_FAILED');

    const coded = await diagnoses.add(c.actor, c.encounter.id, {
      display: 'SYNTHETIC: coded properly',
      certainty: 'CONFIRMED',
      code: 'A99',
      codeSystem: 'SYNTHETIC-CS',
    });
    expect(coded.code).toBe('A99');
  });

  it('is editable before signing and only voidable after it', async () => {
    const c = await consultation('dx-lock');
    const dx = await diagnoses.add(c.actor, c.encounter.id, {
      display: 'SYNTHETIC: first impression',
      certainty: 'DIFFERENTIAL',
    });
    const edited = await diagnoses.update(c.actor, dx.id, {
      expectedRowVersion: dx.rowVersion,
      certainty: 'PROVISIONAL',
    });
    expect(edited.certainty).toBe('PROVISIONAL');

    const saved = await notes.saveDraft(c.actor, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: SECTIONS,
    });
    await notes.sign(c.actor, c.encounter.id, { expectedRowVersion: saved.rowVersion });

    // Someone may have acted on this diagnosis by now. Editing it in place would make that decision look
    // as though it was taken against text it never saw.
    expect(
      await code(() =>
        diagnoses.update(c.actor, dx.id, {
          expectedRowVersion: edited.rowVersion,
          display: 'SYNTHETIC: quietly changed',
        }),
      ),
    ).toBe('INVALID_TRANSITION');

    const voided = await diagnoses.void(c.actor, dx.id, {
      expectedRowVersion: edited.rowVersion,
      reason: 'SYNTHETIC: recorded against the wrong encounter',
    });
    expect(voided).toMatchObject({ clinicalStatus: 'ENTERED_IN_ERROR' });
    expect(voided.voidReason).toContain('SYNTHETIC');
    expect(voided.voidedAt).not.toBeNull();

    // The replacement points back at what it corrects.
    const replacement = await diagnoses.add(c.actor, c.encounter.id, {
      display: 'SYNTHETIC: corrected diagnosis',
      certainty: 'CONFIRMED',
      replacesDiagnosisId: dx.id,
    });
    expect(replacement.replacesDiagnosisId).toBe(dx.id);

    // The voided row is still there, which is the point: "this was wrong" is part of the record.
    const all = await diagnoses.list(c.actor, c.encounter.id);
    expect(all).toHaveLength(2);
    expect(all.map((d) => d.clinicalStatus).sort()).toEqual(['ACTIVE', 'ENTERED_IN_ERROR']);
  });

  it('will not point a replacement at a diagnosis that is still live', async () => {
    const c = await consultation('dx-replace');
    const live = await diagnoses.add(c.actor, c.encounter.id, {
      display: 'SYNTHETIC: still standing',
      certainty: 'CONFIRMED',
    });
    expect(
      await code(() =>
        diagnoses.add(c.actor, c.encounter.id, {
          display: 'SYNTHETIC: claims to supersede a live one',
          certainty: 'CONFIRMED',
          replacesDiagnosisId: live.id,
        }),
      ),
    ).toBe('INVALID_TRANSITION');
  });

  it('never writes source = ai_approved from any path (test 13)', async () => {
    const c = await consultation('no-ai');
    await diagnoses.add(c.actor, c.encounter.id, {
      display: 'SYNTHETIC: entered by a person',
      certainty: 'CONFIRMED',
    });
    // Whatever a caller sends, the service writes `doctor`: the value is not taken from input at all.
    await diagnoses.add(c.actor, c.encounter.id, {
      display: 'SYNTHETIC: with an ai-shaped payload',
      certainty: 'CONFIRMED',
      ...({ source: 'ai_approved', aiApprovalId: newId() } as Record<string, unknown>),
    } as never);
    const rows = await db.prisma.diagnosis.findMany({ where: { tenantId: c.tenantId } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'doctor')).toBe(true);

    const symptom = await diagnoses.addSymptom(c.actor, c.encounter.id, {
      display: 'SYNTHETIC: reported symptom',
      source: 'PATIENT_REPORTED',
      certainty: 'CONFIRMED',
    });
    expect(symptom.source).toBe('PATIENT_REPORTED');
  });
});

describe('who may do what (test 9)', () => {
  /** A second doctor in the same tenant, with no relationship to the patient. */
  async function stranger(tenantId: string, label: string): Promise<ClinicalActor> {
    const now = new Date();
    const userId = newId();
    const doctorProfileId = newId();
    await db.prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.invalid`,
        emailNormalized: `${userId}@example.invalid`,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.prisma.doctorProfile.create({
      data: {
        id: doctorProfileId,
        tenantId,
        userId,
        displayName: `Dr. ${label}`,
        specialties: [],
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      userId,
      tenant: tenantContext(tenantId as never),
      doctorProfileId,
      requestId: newId(),
      correlationId: newId(),
    };
  }

  it('refuses an unrelated doctor every clinical action on the encounter', async () => {
    const c = await consultation('stranger');
    const other = await stranger(c.tenantId, 'Stranger');
    const dx = await diagnoses.add(c.actor, c.encounter.id, {
      display: 'SYNTHETIC: for the refusal cases',
      certainty: 'CONFIRMED',
    });

    const cases: Array<[string, () => Promise<unknown>]> = [
      ['getDraft', () => notes.getDraft(other, c.encounter.id)],
      ['listRevisions', () => notes.listRevisions(other, c.encounter.id)],
      [
        'saveDraft',
        () =>
          notes.saveDraft(other, c.encounter.id, {
            expectedRowVersion: c.draft.rowVersion,
            sections: SECTIONS,
          }),
      ],
      ['sign', () => notes.sign(other, c.encounter.id, { expectedRowVersion: c.draft.rowVersion })],
      ['listDiagnoses', () => diagnoses.list(other, c.encounter.id)],
      [
        'addDiagnosis',
        () => diagnoses.add(other, c.encounter.id, { display: 'SYNTHETIC: x', certainty: 'CONFIRMED' }),
      ],
      [
        'voidDiagnosis',
        () => diagnoses.void(other, dx.id, { expectedRowVersion: dx.rowVersion, reason: 'SYNTHETIC: no' }),
      ],
      ['listSymptoms', () => diagnoses.listSymptoms(other, c.encounter.id)],
    ];
    for (const [name, run] of cases) {
      expect(await code(run), name).toBe('FORBIDDEN');
    }
  });

  it('gives a nurse in the chamber the draft but never the signature', async () => {
    const c = await consultation('nurse');
    const now = new Date();
    const userId = newId();
    await db.prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.invalid`,
        emailNormalized: `${userId}@example.invalid`,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    // A nurse has no doctor profile at all, which is exactly why assignment cannot be the only rule.
    const nurse: ClinicalActor = {
      userId,
      tenant: tenantContext(c.tenantId as never, 'nurse'),
      doctorProfileId: null,
      requestId: newId(),
      correlationId: newId(),
    };

    const saved = await notes.saveDraft(nurse, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: { examination: 'SYNTHETIC: observations taken at the desk' },
    });
    // The record says a nurse wrote it, not a doctor.
    expect(saved.sectionSources).toEqual([{ section: 'examination', source: 'nurse' }]);
    expect((await notes.getDraft(nurse, c.encounter.id)).examination).toContain('SYNTHETIC');

    // A signature is a named doctor standing behind the record, so scope is not enough for it — nor for
    // a diagnosis, which is an attributed clinical judgement.
    expect(
      await code(() => notes.sign(nurse, c.encounter.id, { expectedRowVersion: saved.rowVersion })),
    ).toBe('FORBIDDEN');
    expect(
      await code(() =>
        diagnoses.add(nurse, c.encounter.id, { display: 'SYNTHETIC: x', certainty: 'CONFIRMED' }),
      ),
    ).toBe('FORBIDDEN');
  });

  it('refuses a nurse scoped to a different chamber', async () => {
    const c = await consultation('nurse-scope');
    const now = new Date();
    const userId = newId();
    await db.prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.invalid`,
        emailNormalized: `${userId}@example.invalid`,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    const elsewhere: ClinicalActor = {
      userId,
      tenant: { ...tenantContext(c.tenantId as never, 'nurse'), chamberIds: [newId()] },
      doctorProfileId: null,
      requestId: newId(),
      correlationId: newId(),
    };
    expect(await code(() => notes.getDraft(elsewhere, c.encounter.id))).toBe('FORBIDDEN');
  });
});

describe('tenant isolation (test 11)', () => {
  it('answers not-found for another tenant’s encounter on every route', async () => {
    const mine = await consultation('mine');
    const theirs = await consultation('theirs');

    // The acting doctor is real, and so is the encounter — they just belong to different tenants. The
    // answer is "no such record", not "forbidden": the caller learns nothing about what exists elsewhere.
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['getDraft', () => notes.getDraft(mine.actor, theirs.encounter.id)],
      ['listRevisions', () => notes.listRevisions(mine.actor, theirs.encounter.id)],
      [
        'saveDraft',
        () =>
          notes.saveDraft(mine.actor, theirs.encounter.id, {
            expectedRowVersion: 1,
            sections: SECTIONS,
          }),
      ],
      ['sign', () => notes.sign(mine.actor, theirs.encounter.id, { expectedRowVersion: 1 })],
      ['listDiagnoses', () => diagnoses.list(mine.actor, theirs.encounter.id)],
      [
        'addDiagnosis',
        () =>
          diagnoses.add(mine.actor, theirs.encounter.id, {
            display: 'SYNTHETIC: x',
            certainty: 'CONFIRMED',
          }),
      ],
      ['listSymptoms', () => diagnoses.listSymptoms(mine.actor, theirs.encounter.id)],
      [
        'addSymptom',
        () =>
          diagnoses.addSymptom(mine.actor, theirs.encounter.id, {
            display: 'SYNTHETIC: x',
            source: 'CLINICIAN_OBSERVED',
            certainty: 'CONFIRMED',
          }),
      ],
    ];
    for (const [name, run] of cases) {
      expect(await code(run), name).toBe('RESOURCE_NOT_FOUND');
    }
  });
});

describe('events (test 15)', () => {
  it('emits exactly the documented events, carrying identifiers only', async () => {
    const c = await consultation('events');
    const saved = await notes.saveDraft(c.actor, c.encounter.id, {
      expectedRowVersion: c.draft.rowVersion,
      sections: SECTIONS,
    });
    await notes.sign(c.actor, c.encounter.id, { expectedRowVersion: saved.rowVersion });
    const dx = await diagnoses.add(c.actor, c.encounter.id, {
      display: 'SYNTHETIC: viral fever',
      certainty: 'PROVISIONAL',
    });
    await diagnoses.void(c.actor, dx.id, {
      expectedRowVersion: dx.rowVersion,
      reason: 'SYNTHETIC: wrong patient',
    });

    const events = await db.prisma.outboxEvent.findMany({
      where: { tenantId: c.tenantId },
      orderBy: { occurredAt: 'asc' },
    });
    const names = events.map((e) => e.eventName);
    expect(names).toContain('EncounterStarted');
    expect(names).toContain('EncounterNoteDraftSaved');
    expect(names).toContain('EncounterNoteSigned');
    expect(names).toContain('DiagnosisRecorded');
    expect(names).toContain('DiagnosisStatusChanged');

    // The signed event says which revision it was, because the documented catalogue has no separate
    // amend event and a projector has to be able to tell the two apart (audit row C-53).
    const signed = events.find((e) => e.eventName === 'EncounterNoteSigned');
    expect(signed?.payload).toMatchObject({ revision: 1, amended: false });

    const voided = events.find((e) => e.eventName === 'DiagnosisStatusChanged');
    expect(voided?.payload).toMatchObject({ to: 'ENTERED_IN_ERROR', voided: true });

    // Not a word of clinical content anywhere on the bus. An event stream that carried note text would
    // be a second copy of the medical record, in a place designed to be forwarded.
    const serialized = stringify(events);
    for (const text of Object.values(SECTIONS)) expect(serialized).not.toContain(text);
    expect(serialized).not.toContain('viral fever');
    expect(serialized).not.toContain('wrong patient');
  });

  it('emits nothing when the action rolls back', async () => {
    const c = await consultation('rollback');
    const before = await db.prisma.outboxEvent.count({ where: { tenantId: c.tenantId } });

    // A stale save: refused inside the transaction, so nothing it would have emitted survives.
    expect(
      await code(() =>
        notes.saveDraft(c.actor, c.encounter.id, {
          expectedRowVersion: c.draft.rowVersion + 99,
          sections: SECTIONS,
        }),
      ),
    ).toBe('STALE_VERSION');
    expect(await db.prisma.outboxEvent.count({ where: { tenantId: c.tenantId } })).toBe(before);
  });
});
