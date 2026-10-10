import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VerifyAppendOnlyChains } from '@hmedic/audit';
import {
  type Database,
  type Prisma,
  deleteExpiredBatch,
  pendingTimelineEventIds,
  withTransaction,
} from '@hmedic/database';
import { FixedClock, newId } from '@hmedic/kernel';
import { QueueOutbox } from '@hmedic/queue';
import { QueueEventWriter } from '@hmedic/scheduling';
import {
  JobRegistry,
  JobRunner,
  JobPort,
  OutboxPort,
  OutboxPublisher,
  SubscriptionRegistry,
} from '@hmedic/jobs';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { createTimelineProjector, registerTimelineJobs } from '../../src/nest/worker-module';
import {
  TimelineProjector,
  timelineChainSource,
  timelineProjectionName,
  isTimelineEntryRedacted,
  type HistoryMetadataPort,
} from '../../src/public';

let db: Database;
let base: Awaited<ReturnType<typeof chamberWithCalledSerial>>;
let encounterId: string;
let projector: TimelineProjector;
const started = new Date('2026-01-01T01:00:00Z');
const later = new Date('2026-01-02T01:00:00Z');
const ttl = {
  jobRetentionSucceededDays: 14,
  jobRetentionFailedDays: 30,
  outboxRetentionDays: 14,
  timelineProjectionVersion: 1,
};
beforeAll(() => {
  db = openTestDatabase({ poolMax: 12 });
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await truncateAll();
  base = await chamberWithCalledSerial(db.prisma, 'timeline-projector');
  encounterId = newId();
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
      startedAt: started,
      createdAt: started,
      updatedAt: started,
    },
  });
  projector = createTimelineProjector(db.prisma, 1).projector;
});
async function emit(
  name = 'EncounterStarted',
  aggregateType = 'encounter',
  aggregateId = encounterId,
  payload: Record<string, string | number | boolean | null> = {},
  occurredAt = started,
  tenantId: string | null = base.tenantId,
) {
  return withTransaction(db.prisma, (tx) =>
    new OutboxPort().append(tx, {
      tenantId,
      eventName: name,
      eventVersion: 1,
      aggregateType,
      aggregateId,
      payload,
      occurredAt,
      correlationId: newId(),
      causationId: null,
      actorId: null,
      idempotencyKey: null,
    }),
  );
}
const rows = () =>
  db.prisma.timelineEvent.findMany({ where: { tenantId: base.tenantId }, orderBy: { seq: 'asc' } });
const checkpoint = () =>
  db.prisma.projectionCheckpoint.findUnique({
    where: {
      projectionName_tenantId: {
        projectionName: timelineProjectionName(1),
        tenantId: base.tenantId,
      },
    },
  });
async function signedNote(revision = 1, noteId?: string) {
  const id = noteId ?? newId();
  if (!noteId)
    await db.prisma.encounterNote.create({
      data: {
        id,
        tenantId: base.tenantId,
        encounterId,
        authorDoctorProfileId: base.doctorProfileId,
        status: 'DRAFT',
        chiefComplaint: 'SYNTHETIC private draft',
        sectionSources: {},
        createdAt: started,
        updatedAt: started,
      },
    });
  const version = await db.prisma.encounterNoteVersion.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      encounterId,
      noteId: id,
      revision,
      signedByDoctorProfileId: base.doctorProfileId,
      signedAt: later,
      chiefComplaint: 'SYNTHETIC private signed text',
      sectionSources: {},
      contentSha256: 'a'.repeat(64),
      rowHash: 'b'.repeat(64),
      createdAt: later,
      ...(revision > 1 ? { correctionReason: 'SYNTHETIC correction' } : {}),
    },
  });
  return { noteId: id, versionId: version.id };
}
async function prescription(clinicalStatus = 'APPROVED', revision = 1) {
  return db.prisma.prescription.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      patientId: base.patientId,
      encounterId,
      doctorProfileId: base.doctorProfileId,
      revision,
      clinicalStatus,
      ...(clinicalStatus === 'DRAFT'
        ? {}
        : {
            approvedAt: started,
            approvedByDoctorProfileId: base.doctorProfileId,
            approvedSnapshotSha256: 'a'.repeat(64),
          }),
      ...(clinicalStatus === 'VOID' ? { voidReason: 'SYNTHETIC reason', voidedAt: later } : {}),
      createdAt: started,
      updatedAt: later,
    },
  });
}
async function document(over: Partial<Prisma.DocumentUncheckedCreateInput> = {}, scanStatus = 'CLEAN') {
  const id = newId();
  await db.prisma.document.create({
    data: {
      id,
      tenantId: base.tenantId,
      patientId: base.patientId,
      encounterId,
      category: 'LAB_REPORT',
      status: 'AVAILABLE',
      accessPolicy: 'PATIENT_SHARED',
      currentRevision: 1,
      title: 'SYNTHETIC private lab title',
      createdAt: started,
      updatedAt: later,
      ...over,
    },
  });
  await db.prisma.documentVersion.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      documentId: id,
      revision: 1,
      storageAdapter: 'disk',
      storageKey: `${id}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 1n,
      sha256: 'a'.repeat(64),
      scanStatus,
      scanAdapter: 'synthetic-scanner',
      scannedAt: later,
      createdAt: started,
      updatedAt: later,
    },
  });
  return id;
}

describe('timeline projection, redaction, rebuild and retention', () => {
  it('projects concurrent duplicate deliveries atomically and verifies the registered chain', async () => {
    const id = await emit();
    await Promise.all(Array.from({ length: 6 }, () => projector.projectEvent(base.tenantId, id)));
    expect(await rows()).toHaveLength(1);
    expect(await db.prisma.timelineProjectionReceipt.count()).toBe(1);
    expect(await checkpoint()).toMatchObject({ lastEventId: id, lastOutboxOccurredAt: started });
    expect(
      await new VerifyAppendOnlyChains(db.prisma, [timelineChainSource]).run({ full: true }),
    ).toMatchObject([{ ok: true, rows: 1 }]);
  });
  it('projects immutable signed revisions while ignoring mutable drafts and clinical prose', async () => {
    const n = await signedNote();
    const amendment = await signedNote(2, n.noteId);
    await projector.projectEvent(
      base.tenantId,
      await emit('EncounterNoteDraftSaved', 'encounter_note', n.noteId),
    );
    await projector.projectEvent(
      base.tenantId,
      await emit('EncounterNoteSigned', 'encounter_note', n.noteId, {
        versionId: n.versionId,
        patientId: base.patientId,
      }),
    );
    await projector.projectEvent(
      base.tenantId,
      await emit('EncounterNoteAmended', 'encounter_note', n.noteId, { versionId: amendment.versionId }),
    );
    const result = await rows();
    expect(result.map((r) => r.sourceId)).toEqual([n.versionId, amendment.versionId]);
    expect(
      result.every((r) => r.visibility === 'CLINICAL' && r.occurredAt.getTime() === later.getTime()),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC private/);
    expect(await db.prisma.timelineProjectionReceipt.count({ where: { outcome: 'IGNORED' } })).toBe(1);
  });
  it('rejects foreign tenant, foreign aggregate and incorrect patient references without receipts', async () => {
    const n = await signedNote();
    const wrong = await emit('EncounterNoteSigned', 'encounter_note', newId(), { versionId: n.versionId });
    await expect(projector.projectEvent(base.tenantId, wrong)).rejects.toThrow('TIMELINE_SOURCE_MISMATCH');
    const badPatient = await emit('EncounterStarted', 'encounter', encounterId, { patientId: newId() });
    await expect(projector.projectEvent(base.tenantId, badPatient)).rejects.toThrow(
      'TIMELINE_PATIENT_MISMATCH',
    );
    const other = await chamberWithCalledSerial(db.prisma, 'timeline-other');
    const foreign = await emit('EncounterStarted', 'encounter', encounterId, {}, started, other.tenantId);
    await expect(projector.projectEvent(other.tenantId, foreign)).rejects.toThrow(
      'TIMELINE_SOURCE_NOT_FOUND',
    );
    await expect(projector.projectEvent(other.tenantId, wrong)).rejects.toThrow('TIMELINE_EVENT_NOT_FOUND');
    const missingDocument = await emit('DocumentScanCompleted', 'document', newId());
    await expect(projector.projectEvent(base.tenantId, missingDocument)).rejects.toThrow(
      'TIMELINE_SOURCE_NOT_FOUND',
    );
    expect(await db.prisma.timelineProjectionReceipt.count()).toBe(0);
    expect(await rows()).toHaveLength(0);
  });
  it('does not acknowledge an unsupported version of a supported event', async () => {
    const id = await emit();
    await db.prisma.outboxEvent.update({ where: { id }, data: { eventVersion: 2 } });
    await expect(projector.projectEvent(base.tenantId, id)).rejects.toThrow('JOB_PAYLOAD_UNSUPPORTED');
    expect(await pendingTimelineEventIds(db.prisma, base.tenantId, 1)).toHaveLength(1);
    expect(await checkpoint()).toBeNull();
  });
  it('retains an earlier gap even after later projection and purges only exact active-version receipts', async () => {
    const early = await emit();
    const late = await emit('OtherMetadataChanged', 'other', newId(), {}, later);
    await projector.projectEvent(base.tenantId, late);
    expect(await checkpoint()).toBeNull();
    const wrongVersion = await emit('OtherMetadataChanged', 'other', newId(), {}, later);
    await projector.projectEvent(base.tenantId, wrongVersion, 2);
    const global = await emit('OtherMetadataChanged', 'other', newId(), {}, started, null);
    await db.prisma.outboxEvent.updateMany({ data: { status: 'PUBLISHED', publishedAt: started } });
    expect(await deleteExpiredBatch(db.prisma, 'outbox_events', new Date('2026-03-01'), ttl)).toBe(2);
    expect(await db.prisma.outboxEvent.findUnique({ where: { id: early } })).not.toBeNull();
    expect(await db.prisma.outboxEvent.findUnique({ where: { id: wrongVersion } })).not.toBeNull();
    expect(await db.prisma.outboxEvent.findUnique({ where: { id: global } })).toBeNull();
    await expect(projector.projectEvent(base.tenantId, late)).resolves.toBeUndefined();
    await projector.projectEvent(base.tenantId, early);
    expect(await checkpoint()).toMatchObject({ lastEventId: late });
  });
  it('regresses the completed frontier when a late committed earlier event becomes visible', async () => {
    const late = await emit('OtherMetadataChanged', 'other', newId(), {}, later);
    await projector.projectEvent(base.tenantId, late);
    expect(await checkpoint()).toMatchObject({ lastEventId: late });
    const earlier = await emit();
    const latest = await emit('OtherMetadataChanged', 'other', newId(), {}, new Date('2026-01-03'));
    await projector.projectEvent(base.tenantId, latest);
    expect(await checkpoint()).toBeNull();
    await projector.projectEvent(base.tenantId, earlier);
    expect(await checkpoint()).toMatchObject({ lastEventId: latest });
  });
  it('withdrawal before original delivery appends one scoped marker and masks encounter descendants', async () => {
    const n = await signedNote();
    const originalEvent = await emit();
    await db.prisma.encounter.update({
      where: { id: encounterId },
      data: { status: 'ENTERED_IN_ERROR', enteredInErrorReason: 'SYNTHETIC reason', updatedAt: later },
    });
    await projector.projectEvent(base.tenantId, await emit('EncounterEnteredInError'));
    const original = (await rows())[0]!;
    await projector.projectEvent(base.tenantId, originalEvent);
    await projector.projectEvent(
      base.tenantId,
      await emit('EncounterNoteSigned', 'encounter_note', n.noteId, { versionId: n.versionId }),
    );
    const result = await rows();
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(original);
    const markers = result.filter((r) => r.eventType === 'REDACTED');
    expect(markers).toHaveLength(1);
    expect(isTimelineEntryRedacted(result[2]!, markers)).toBe(true);
    expect(isTimelineEntryRedacted({ ...result[2]!, patientId: newId() }, markers)).toBe(false);
    expect(isTimelineEntryRedacted({ ...result[2]!, projectionVersion: 2 }, markers)).toBe(false);
    expect(isTimelineEntryRedacted(markers[0]!, markers)).toBe(false);
    expect(await db.prisma.encounterNoteVersion.findUnique({ where: { id: n.versionId } })).toHaveProperty(
      'chiefComplaint',
      'SYNTHETIC private signed text',
    );
  });
  it('projects approved and withdrawn prescriptions, excludes drafts, and preserves patient visibility', async () => {
    await prescription('DRAFT');
    const rx = await prescription('VOID', 2);
    await projector.backfill(base.tenantId);
    const result = (await rows()).filter((r) => r.sourceType === 'prescription');
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.sourceId === rx.id && r.visibility === 'PATIENT_SHARED')).toBe(true);
    expect(isTimelineEntryRedacted(result[0]!, result)).toBe(true);
  });
  it('includes only clean accessible documents, then appends a document redaction', async () => {
    const good = await document();
    await document({ category: 'AI_RAW', accessPolicy: 'AUDIT_ONLY' });
    await document({ category: 'PRESCRIPTION_PDF' });
    await document({ status: 'SCANNING' }, 'PENDING');
    await document({}, 'REJECTED');
    await projector.backfill(base.tenantId);
    const original = (await rows()).find((r) => r.sourceType === 'document')!;
    expect(original).toMatchObject({ sourceId: good, visibility: 'PATIENT_SHARED' });
    await db.prisma.document.update({
      where: { id: good },
      data: { redactedAt: later, status: 'EXPIRED', accessPolicy: 'AUDIT_ONLY' },
    });
    await projector.projectEvent(base.tenantId, await emit('DocumentRedacted', 'document', good));
    const docs = (await rows()).filter((r) => r.sourceType === 'document');
    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual(original);
    expect(isTimelineEntryRedacted(original, docs)).toBe(true);
    expect(JSON.stringify(docs)).not.toContain('SYNTHETIC private lab title');
  });
  it('backfills history after outbox expiry, resumes pages safely, and rebuilds without modifying active rows', async () => {
    await signedNote();
    await projector.backfillPage(base.tenantId, 'encounter', null);
    await projector.backfill(base.tenantId);
    const active = await rows();
    expect(active).toHaveLength(2);
    expect(await db.prisma.outboxEvent.count()).toBe(0);
    const comparison = await projector.rebuild(base.tenantId, 2);
    expect(comparison).toMatchObject({
      activeVersion: 1,
      targetVersion: 2,
      matches: true,
      patients: [{ activeCount: 2, targetCount: 2, matches: true }],
    });
    expect((await rows()).filter((r) => r.projectionVersion === 1)).toEqual(active);
    await projector.rebuild(base.tenantId, 2);
    expect(await rows()).toHaveLength(4);
    expect(projector.version).toBe(1);
    await expect(projector.rebuild(base.tenantId, 1)).rejects.toThrow('TIMELINE_REBUILD_VERSION_INVALID');
  });
  it('detects equal-count but different-source rebuilds', async () => {
    await projector.backfill(base.tenantId);
    const drift: HistoryMetadataPort = {
      kinds: ['encounter'],
      ids: async () => [encounterId],
      read: async () => [
        {
          sourceType: 'encounter',
          sourceId: newId(),
          aggregateId: encounterId,
          patientId: base.patientId,
          eventName: 'EncounterStarted',
          occurredAt: started,
          visibility: 'CLINICAL',
          encounterId,
        },
      ],
    };
    const changed = new TimelineProjector(db.prisma, [drift]);
    expect(await changed.rebuild(base.tenantId, 2)).toMatchObject({
      matches: false,
      patients: [{ activeCount: 1, targetCount: 1, matches: false }],
    });
  });
  it('rolls back projection rows, chain allocation and receipts when source references are invalid', async () => {
    const id = await emit();
    const bad: HistoryMetadataPort = {
      kinds: ['encounter'],
      ids: async () => [],
      read: async () => [
        {
          sourceType: 'encounter',
          sourceId: encounterId,
          aggregateId: encounterId,
          patientId: base.patientId,
          eventName: 'EncounterStarted',
          occurredAt: started,
          visibility: 'CLINICAL',
        },
        {
          sourceType: 'encounter',
          sourceId: newId(),
          aggregateId: 'invalid',
          patientId: base.patientId,
          eventName: 'EncounterStarted',
          occurredAt: started,
          visibility: 'CLINICAL',
        },
      ],
    };
    await expect(new TimelineProjector(db.prisma, [bad]).projectEvent(base.tenantId, id)).rejects.toThrow();
    expect(await rows()).toHaveLength(0);
    expect(await db.prisma.timelineProjectionReceipt.count()).toBe(0);
    await projector.projectEvent(base.tenantId, id);
    expect((await rows())[0]?.seq).toBe(1);
  });
  it('publishes subscribed jobs and executes the registered timeline handler', async () => {
    const registry = new JobRegistry(),
      subs = new SubscriptionRegistry();
    const runner = new JobRunner(db.prisma, registry, { strategy: 'skip_locked', app: 'test' });
    expect(registerTimelineJobs(registry, runner, subs, { prisma: db.prisma, version: 1 })).toEqual([
      { type: 'ProjectTimelineBacklog', everyMs: 60_000 },
    ]);
    await emit();
    await new OutboxPublisher(db.prisma, registry, subs, { strategy: 'skip_locked' }).publishBatch();
    const jobs = await runner.claim('timeline', 10);
    expect(jobs).toHaveLength(1);
    expect(await runner.execute(jobs[0]!)).toBe('SUCCEEDED');
    expect(await rows()).toHaveLength(1);
  });
  it('projects queue ledger identities, including issuance batch rows, without duplicating backfill', async () => {
    const clock = new FixedClock(started);
    const ledger = new QueueEventWriter(clock);
    let eventId = '';
    await withTransaction(db.prisma, async (tx) => {
      const common = {
        tenantId: base.tenantId,
        chamberDayId: base.chamberDayId,
        serialId: base.serial.id,
        actor: { userId: base.userId, actorType: 'USER' as const },
      };
      await ledger.appendMany(
        tx,
        ['SERIAL_ISSUED', 'CHECKED_IN', 'WAITING'].map((eventType) => ({
          ...common,
          eventType: eventType as 'SERIAL_ISSUED' | 'CHECKED_IN' | 'WAITING',
        })),
      );
      eventId = await new QueueOutbox(new OutboxPort(clock), clock).emit(tx, {
        tenantId: base.tenantId,
        name: 'SerialIssued',
        aggregateType: 'serial',
        aggregateId: base.serial.id,
        payload: {},
        actorId: base.userId,
      });
    });
    const outbox = await db.prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(outbox.payload).toHaveProperty('queueEventId');
    await projector.projectEvent(base.tenantId, eventId);
    expect((await rows()).filter((r) => r.sourceType === 'queue_event')).toHaveLength(3);
    await projector.backfill(base.tenantId);
    expect((await rows()).filter((r) => r.sourceType === 'queue_event')).toHaveLength(3);
    expect(await projector.rebuild(base.tenantId, 2)).toMatchObject({ matches: true });
  });
  it('retains ambiguous legacy queue events rather than guessing an immutable source', async () => {
    const ledger = new QueueEventWriter(new FixedClock(started));
    await withTransaction(db.prisma, async (tx) => {
      const common = {
        tenantId: base.tenantId,
        chamberDayId: base.chamberDayId,
        serialId: base.serial.id,
        actor: { userId: base.userId, actorType: 'USER' as const },
        eventType: 'RECALLED' as const,
      };
      await ledger.appendMany(tx, [common, common]);
    });
    const id = await emit('SerialRecalled', 'serial', base.serial.id);
    await expect(projector.projectEvent(base.tenantId, id)).rejects.toThrow(
      'TIMELINE_QUEUE_SOURCE_AMBIGUOUS',
    );
    expect(await db.prisma.timelineProjectionReceipt.count()).toBe(0);
  });
  it('bootstraps source pages through the registered background jobs and acknowledges nonprojected events', async () => {
    await signedNote();
    const registry = new JobRegistry(),
      subs = new SubscriptionRegistry();
    const runner = new JobRunner(db.prisma, registry, { strategy: 'conditional_update', app: 'test' });
    registerTimelineJobs(registry, runner, subs, { prisma: db.prisma, version: 1 });
    const id = await emit('EncounterNoteDraftSaved', 'encounter_note', newId());
    await new JobPort(db.prisma, registry).enqueue({
      type: 'ProjectTimelineBacklog',
      payload: { v: 1, window: 1 },
      correlationId: newId(),
    });
    for (let page = 0; page < 15; page++) {
      const claimed = await runner.claim('timeline', 10);
      if (!claimed.length) break;
      for (const job of claimed) expect(await runner.execute(job)).toBe('SUCCEEDED');
    }
    expect(await rows()).toHaveLength(2);
    expect(
      await db.prisma.timelineProjectionReceipt.findFirst({ where: { sourceEventId: id } }),
    ).toMatchObject({ outcome: 'IGNORED' });
    expect(await db.prisma.job.count({ where: { status: 'QUEUED', queue: 'timeline' } })).toBe(0);
    expect(
      await db.prisma.job.count({ where: { type: 'BackfillTimelineSources', status: 'SUCCEEDED' } }),
    ).toBe(10);
  });
  it.each([{ outcome: 'UNSAFE' }, { projectionVersion: 0 }, { tenantId: newId() }])(
    'enforces durable receipt boundaries %j',
    async (over) => {
      await expect(
        db.prisma.timelineProjectionReceipt.create({
          data: {
            tenantId: base.tenantId,
            sourceEventId: newId(),
            projectionVersion: 1,
            occurredAt: started,
            processedAt: later,
            outcome: 'IGNORED',
            ...over,
          },
        }),
      ).rejects.toThrow();
    },
  );
});
