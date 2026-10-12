import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { RETRIEVAL_DEFAULTS, RetrievalService } from '../../src/public';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';

/**
 * Retrieval for AI jobs (AI-001, AI-IMPLEMENTATION §8).
 *
 * Every case here is about something that must **not** reach a prompt. A voided prescription, an
 * entered-in-error diagnosis, a redacted timeline entry and its original, a superseded note revision,
 * another encounter's draft, another patient's record. Each is something a doctor deliberately took
 * out of the chart or never put in it, and a prompt that carried it would undo that decision — then
 * present the result to a doctor as a draft built from their own record.
 *
 * The clamps and the stale-projection fallback are covered too, because both change what the model
 * sees and both are recorded on the draft so a thin result can be explained afterwards.
 */
let db: Database;
let service: RetrievalService;
const now = new Date('2026-10-13T12:00:00Z');
let seq = 0;

beforeAll(() => {
  db = openTestDatabase();
  service = new RetrievalService({ prisma: db.prisma, now: () => now });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

async function fixture() {
  const base = await chamberWithCalledSerial(db.prisma, `retr${++seq}`, now);
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
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { ...base, encounterId };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const request = (f: Fixture, over: Record<string, unknown> = {}) => ({
  tenantId: f.tenantId,
  patientId: f.patientId,
  encounterId: f.encounterId,
  ...over,
});

const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);

const diagnosis = (f: Fixture, over: Record<string, unknown> = {}) =>
  db.prisma.diagnosis.create({
    data: {
      id: newId(),
      tenantId: f.tenantId,
      encounterId: f.encounterId,
      patientId: f.patientId,
      authorDoctorProfileId: f.doctorProfileId,
      display: 'SYNTHETIC diagnosis',
      clinicalStatus: 'ACTIVE',
      certainty: 'CONFIRMED',
      source: 'doctor',
      createdAt: ago(10),
      updatedAt: ago(10),
      ...over,
    },
  });

/** A signed revision needs the note it belongs to, which the composite FK enforces. */
async function signedNote(f: Fixture, over: Record<string, unknown> = {}) {
  const noteId = (over.noteId as string | undefined) ?? newId();
  if (!(await db.prisma.encounterNote.count({ where: { tenantId: f.tenantId, id: noteId } }))) {
    await db.prisma.encounterNote.create({
      data: {
        id: noteId,
        tenantId: f.tenantId,
        encounterId: (over.encounterId as string | undefined) ?? f.encounterId,
        authorDoctorProfileId: f.doctorProfileId,
        status: 'SIGNED_LOCKED',
        sectionSources: {},
        createdAt: ago(21),
        updatedAt: ago(20),
      },
    });
  }
  return noteVersion(f, { ...over, noteId });
}

const noteVersion = (f: Fixture, over: Record<string, unknown> = {}) =>
  db.prisma.encounterNoteVersion.create({
    data: {
      id: newId(),
      tenantId: f.tenantId,
      encounterId: f.encounterId,
      // Overridden by `signedNote`, which creates the owning note first.
      noteId: newId(),
      revision: 1,
      signedByDoctorProfileId: f.doctorProfileId,
      signedAt: ago(20),
      history: 'SYNTHETIC signed history.',
      sectionSources: {},
      contentSha256: 'a'.repeat(64),
      rowHash: 'b'.repeat(64),
      createdAt: ago(20),
      ...over,
    },
  });

const timelineEvent = (f: Fixture, over: Record<string, unknown> = {}) =>
  db.prisma.timelineEvent.create({
    data: {
      id: newId(),
      tenantId: f.tenantId,
      patientId: f.patientId,
      seq: ++seq,
      eventType: 'diagnosis',
      occurredAt: ago(10),
      sourceType: 'diagnosis',
      sourceId: newId(),
      summary: 'SYNTHETIC timeline entry',
      visibility: 'CLINICAL',
      structuredRefs: {},
      projectionVersion: 1,
      sourceEventId: newId(),
      rowHash: 'c'.repeat(64),
      ...over,
    },
  });

describe('retrieval from the source tables', () => {
  it('returns nothing for a patient with no record', async () => {
    const f = await fixture();
    const result = await service.retrieve(request(f));
    expect(result.items).toEqual([]);
    // No projection for this patient, which is exactly when the source tables are the only place the
    // record exists.
    expect(result.effective.usedSourceFallback).toBe(true);
  });

  it('includes a diagnosis, a signed note and an approved follow-up', async () => {
    const f = await fixture();
    await diagnosis(f);
    await signedNote(f);
    await db.prisma.followUpPlan.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        patientId: f.patientId,
        sourceEncounterId: f.encounterId,
        doctorProfileId: f.doctorProfileId,
        dueStartDate: new Date('2026-11-01T00:00:00Z'),
        reason: 'SYNTHETIC review',
        status: 'PLANNED',
        createdAt: ago(5),
        updatedAt: ago(5),
      },
    });

    const result = await service.retrieve(request(f));
    expect(result.items.map((item) => item.sourceType).sort()).toEqual([
      'diagnosis',
      'encounter_note_version',
      'follow_up_plan',
    ]);
    // Newest first, so `s1` is the most recent thing that happened.
    expect(result.items[0]?.sourceType).toBe('follow_up_plan');
    expect(result.items.map((item) => item.ref)).toEqual(['s1', 's2', 's3']);
  });

  it('excludes an entered-in-error diagnosis', async () => {
    const f = await fixture();
    // Entered in error is the voided state on this table: a CHECK ties the status and the void fields
    // together, so a row claiming one without the other cannot exist.
    await diagnosis(f, {
      clinicalStatus: 'ENTERED_IN_ERROR',
      voidedAt: ago(1),
      voidReason: 'SYNTHETIC correction',
      voidedByDoctorProfileId: f.doctorProfileId,
    });
    // The doctor said this was wrong. Retrieving it would put it back in front of them as context.
    expect((await service.retrieve(request(f))).items).toEqual([]);
  });

  it('keeps a ruled-out diagnosis, which is context rather than a mistake', async () => {
    const f = await fixture();
    await diagnosis(f, { clinicalStatus: 'RULED_OUT' });
    // A diagnosis the doctor considered and excluded is worth knowing; it was never withdrawn.
    expect((await service.retrieve(request(f))).items).toHaveLength(1);
  });

  it('excludes anything outside the lookback window', async () => {
    const f = await fixture();
    await diagnosis(f, { createdAt: ago(900), updatedAt: ago(900) });
    const result = await service.retrieve(request(f, { lookbackDays: 365 }));
    expect(result.items).toEqual([]);
    expect(result.effective.lookbackDays).toBe(365);
  });

  it('keeps only the newest signed revision of a note', async () => {
    const f = await fixture();
    const noteId = newId();
    await signedNote(f, { noteId, revision: 1, history: 'SYNTHETIC first.' });
    await signedNote(f, {
      noteId,
      revision: 2,
      history: 'SYNTHETIC corrected.',
      supersedesRevision: 1,
      correctionReason: 'SYNTHETIC fix',
      signedAt: ago(19),
    });

    const result = await service.retrieve(request(f));
    const notes = result.items.filter((item) => item.sourceType === 'encounter_note_version');
    // Sending both revisions would show the model a contradiction it cannot resolve.
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toContain('corrected');
  });

  it('never returns another patient’s record', async () => {
    const f = await fixture();
    const other = await fixture();
    await diagnosis(other);
    expect((await service.retrieve(request(f))).items).toEqual([]);
  });
});

describe('retrieval of the current draft note', () => {
  const draft = (f: Fixture, over: Record<string, unknown> = {}) =>
    db.prisma.encounterNote.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        encounterId: f.encounterId,
        authorDoctorProfileId: f.doctorProfileId,
        status: 'DRAFT',
        history: 'SYNTHETIC draft history.',
        examination: 'SYNTHETIC draft examination.',
        sectionSources: {},
        createdAt: now,
        updatedAt: now,
        ...over,
      },
    });

  it('includes only the sections the doctor selected', async () => {
    const f = await fixture();
    await draft(f);
    const result = await service.retrieve(request(f, { draftSections: ['history'] }));
    const current = result.items.find((item) => item.sourceType === 'encounter_note_draft');
    expect(current?.text).toContain('draft history');
    // The doctor chose what to send. An unselected section is one they kept back.
    expect(current?.text).not.toContain('draft examination');
  });

  it('includes no draft when the doctor selected nothing', async () => {
    const f = await fixture();
    await draft(f);
    expect(
      (await service.retrieve(request(f))).items.some((item) => item.sourceType === 'encounter_note_draft'),
    ).toBe(false);
  });

  it('never reads another encounter’s draft', async () => {
    const f = await fixture();
    const otherEncounterId = newId();
    // Its own serial: an encounter without one is not a state the application can produce.
    const otherSerial = await db.prisma.serial.create({
      data: {
        id: newId(),
        tenantId: f.tenantId,
        chamberDayId: f.chamberDayId,
        patientId: f.patientId,
        serialNumber: 2,
        source: 'WALK_IN',
        careMode: 'PHYSICAL',
        // A terminal status: only one active serial per patient per day is allowed, and this stands
        // in for the earlier consultation whose draft must not be read.
        status: 'COMPLETED',
        createdAt: ago(2),
        updatedAt: ago(2),
      },
    });
    await db.prisma.encounter.create({
      data: {
        id: otherEncounterId,
        tenantId: f.tenantId,
        patientId: f.patientId,
        doctorProfileId: f.doctorProfileId,
        chamberId: f.chamberId,
        serialId: otherSerial.id,
        careMode: 'PHYSICAL',
        status: 'IN_PROGRESS',
        startedAt: ago(2),
        createdAt: ago(2),
        updatedAt: ago(2),
      },
    });
    await draft(f, { encounterId: otherEncounterId, history: 'SYNTHETIC other encounter draft.' });

    const result = await service.retrieve(request(f, { draftSections: ['history'] }));
    // An unsigned note from another consultation is work in progress its author has not finished.
    expect(result.items.some((item) => item.sourceType === 'encounter_note_draft')).toBe(false);
  });
});

describe('retrieval through the timeline projection', () => {
  it('uses the projection when it is current, and resolves each entry from its source', async () => {
    const f = await fixture();
    const d = await diagnosis(f);
    // The projection is ahead of the newest source change, so the lag is zero.
    await timelineEvent(f, { sourceId: d.id, occurredAt: now });

    const result = await service.retrieve(request(f));
    expect(result.effective.usedSourceFallback).toBe(false);
    expect(result.items.map((item) => item.sourceId)).toEqual([d.id]);
  });

  it('drops an entry whose source has since been voided', async () => {
    const f = await fixture();
    const d = await diagnosis(f, {
      clinicalStatus: 'ENTERED_IN_ERROR',
      voidedAt: ago(1),
      voidReason: 'SYNTHETIC correction',
      voidedByDoctorProfileId: f.doctorProfileId,
    });
    await timelineEvent(f, { sourceId: d.id, occurredAt: now });

    const result = await service.retrieve(request(f));
    // The source table is authoritative: a projection entry the chart no longer agrees with is a
    // stale claim, and sending it would present it as current.
    expect(result.items).toEqual([]);
    expect(result.effective.droppedByExclusion).toBeGreaterThan(0);
  });

  it('excludes a redacted entry and its original', async () => {
    const f = await fixture();
    const d = await diagnosis(f);
    const original = await timelineEvent(f, { sourceId: d.id, occurredAt: now });
    await timelineEvent(f, {
      eventType: 'REDACTED',
      sourceId: d.id,
      occurredAt: now,
      redactsTimelineEventId: original.id,
      redactionReasonCode: 'WRONG_PATIENT',
    });

    const result = await service.retrieve(request(f));
    // A redaction is a decision to take something out of the record. Retrieving the original would
    // put it back.
    expect(result.items).toEqual([]);
    expect(result.effective.droppedByExclusion).toBeGreaterThanOrEqual(2);
  });

  it('falls back to the source tables when the projection lags', async () => {
    const f = await fixture();
    const d = await diagnosis(f);
    // An entry from an hour ago, while the encounter was touched just now: the projection is behind.
    await timelineEvent(f, { sourceId: d.id, occurredAt: new Date(now.getTime() - 3600_000) });

    const result = await service.retrieve(request(f));
    expect(result.effective.usedSourceFallback).toBe(true);
    expect(result.effective.projectionLagSeconds).toBeGreaterThan(RETRIEVAL_DEFAULTS.maxProjectionLagSeconds);
    // A doctor who finished a consultation thirty seconds ago must not get a draft that omits it.
    expect(result.items.map((item) => item.sourceId)).toEqual([d.id]);
  });
});

describe('clamps, recorded on the result', () => {
  it('clamps a lookback above the maximum', async () => {
    const f = await fixture();
    const result = await service.retrieve(request(f, { lookbackDays: 99_999 }));
    expect(result.effective.lookbackDays).toBe(RETRIEVAL_DEFAULTS.maxLookbackDays);
  });

  it('clamps an item count above the maximum', async () => {
    const f = await fixture();
    const result = await service.retrieve(request(f, { maxItems: 5000 }));
    expect(result.effective.maxItems).toBe(RETRIEVAL_DEFAULTS.maxItemsHardLimit);
  });

  it('falls back to the defaults for a nonsensical request', async () => {
    const f = await fixture();
    const result = await service.retrieve(request(f, { lookbackDays: -1, maxItems: 0 }));
    expect(result.effective.lookbackDays).toBe(RETRIEVAL_DEFAULTS.lookbackDays);
    expect(result.effective.maxItems).toBe(RETRIEVAL_DEFAULTS.maxItems);
  });

  it('caps per source type and counts what it dropped', async () => {
    const f = await fixture();
    const capped = new RetrievalService({
      prisma: db.prisma,
      now: () => now,
      maxItemsPerSourceType: 2,
    });
    for (let i = 0; i < 4; i += 1) await diagnosis(f, { createdAt: ago(i + 1), updatedAt: ago(i + 1) });

    const result = await capped.retrieve(request(f));
    expect(result.items).toHaveLength(2);
    // Recorded so a thin draft is explainable rather than mysterious.
    expect(result.effective.droppedByCap).toBe(2);
    // The oldest are the ones dropped.
    expect(result.items[0]?.occurredAt.toISOString()).toBe(ago(1).toISOString());
  });
});
