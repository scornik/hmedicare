import { createHash } from 'node:crypto';
import { canonicalJson } from '@hmedic/audit';
import {
  type PrismaClient,
  type Tx,
  lockRow,
  withTransaction,
  pendingTimelineEventIds,
} from '@hmedic/database';
import { type Clock, type TenantId, isUuid, systemClock } from '@hmedic/kernel';
import { NonRetryableJobError } from '@hmedic/jobs';
import type { HistoryMetadataPort, HistoryReference } from '../application/history-port';
import { TimelineRepository, type TimelineEventType } from './timeline-repository';

const TYPES: Readonly<Record<string, TimelineEventType>> = {
  EncounterStarted: 'encounter_started',
  EncounterCompleted: 'encounter_completed',
  EncounterNoteSigned: 'doctor_note',
  EncounterNoteAmended: 'doctor_note',
  DiagnosisRecorded: 'diagnosis',
  SymptomRecorded: 'symptom',
  PrescriptionApproved: 'prescription_finalized',
  AppointmentBooked: 'appointment',
  QueueRecord: 'serial',
  DocumentScanCompleted: 'document',
};
const ALIASES: Readonly<Record<string, string>> = {
  EncounterInterrupted: 'EncounterStarted',
  EncounterResumed: 'EncounterStarted',
  EncounterEnteredInError: 'EncounterStarted',
  DiagnosisStatusChanged: 'DiagnosisRecorded',
  DiagnosisVoided: 'DiagnosisRecorded',
  PrescriptionVoided: 'PrescriptionApproved',
  AppointmentCancelled: 'AppointmentBooked',
  AppointmentRescheduled: 'AppointmentBooked',
  DocumentRedacted: 'DocumentScanCompleted',
};
const SERIAL_CODES: Readonly<Record<string, string>> = {
  SerialIssued: 'SERIAL_ISSUED',
  SerialConfirmed: 'CONFIRMED',
  SerialCheckedIn: 'CHECKED_IN',
  SerialRemoteReady: 'REMOTE_READY',
  SerialWaiting: 'WAITING',
  SerialCalled: 'CALLED',
  SerialSkipped: 'SKIPPED',
  SerialRecalled: 'RECALLED',
  SerialNoShow: 'NO_SHOW',
  SerialCancelled: 'CANCELLED',
  SerialRescheduled: 'RESCHEDULED',
  SerialCompleted: 'COMPLETED',
};
export const TIMELINE_EVENT_NAMES = [
  ...Object.keys(TYPES).filter((n) => n !== 'QueueRecord'),
  ...Object.keys(ALIASES),
  ...Object.keys(SERIAL_CODES),
];
export const timelineProjectionName = (version: number) => `timeline:v${version}`;

/** Deterministic UUIDv7 at the source timestamp; stable across retries and projection versions. */
function sourceEventId(tenantId: string, ref: HistoryReference, redaction = false) {
  const bytes = createHash('sha256')
    .update(canonicalJson([tenantId, ref.sourceType, ref.sourceId, redaction ? 'REDACTED' : ref.eventName]))
    .digest()
    .subarray(0, 16);
  bytes.writeUIntBE((redaction ? ref.redactedAt! : ref.occurredAt).getTime(), 0, 6);
  bytes[6] = (bytes[6]! & 15) | 0x70;
  bytes[8] = (bytes[8]! & 63) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class TimelineProjector {
  private readonly repository = new TimelineRepository();
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sources: readonly HistoryMetadataPort[],
    readonly version = 1,
    private readonly clock: Clock = systemClock,
  ) {
    if (!Number.isInteger(version) || version < 1 || version > 32767)
      throw new Error('invalid timeline version');
  }
  private port(kind: string) {
    const ports = this.sources.filter((p) => p.kinds.includes(kind));
    if (ports.length !== 1) throw new NonRetryableJobError('TIMELINE_SOURCE_UNSUPPORTED');
    return ports[0]!;
  }
  private async ensure(
    tx: Tx,
    tenantId: string,
    version: number,
    ref: HistoryReference,
    eventId?: string,
    markerEventId?: string,
  ) {
    const eventType = TYPES[ref.eventName];
    if (!eventType) throw new NonRetryableJobError('TIMELINE_REFERENCE_UNSUPPORTED');
    const where = {
      tenantId,
      patientId: ref.patientId,
      sourceType: ref.sourceType,
      sourceId: ref.sourceId,
      projectionVersion: version,
    };
    let row = await tx.timelineEvent.findFirst({ where: { ...where, eventType } });
    const structuredRefs = {
      sourceAggregateId: ref.aggregateId,
      ...(ref.encounterId ? { encounterId: ref.encounterId } : {}),
    };
    if (!row)
      row = await this.repository.append(
        tx,
        { tenantId: tenantId as TenantId },
        {
          patientId: ref.patientId,
          eventType,
          occurredAt: ref.occurredAt,
          sourceType: ref.sourceType,
          sourceId: ref.sourceId,
          sourceEventId: eventId ?? sourceEventId(tenantId, ref),
          visibility: ref.visibility,
          structuredRefs,
          projectionVersion: version,
        },
        this.clock.now(),
      );
    if (ref.redactedAt) {
      const marker = await tx.timelineEvent.findFirst({ where: { ...where, eventType: 'REDACTED' } });
      if (!marker)
        await this.repository.append(
          tx,
          { tenantId: tenantId as TenantId },
          {
            patientId: ref.patientId,
            eventType: 'REDACTED',
            occurredAt: ref.redactedAt,
            sourceType: ref.sourceType,
            sourceId: ref.sourceId,
            sourceEventId: markerEventId ?? sourceEventId(tenantId, ref, true),
            visibility: ref.visibility,
            structuredRefs,
            projectionVersion: version,
            redactsTimelineEventId: row.id,
            redactionReasonCode: ref.redactionReason ?? 'VOIDED',
          },
          this.clock.now(),
        );
    }
  }
  private async checkpoint(tx: Tx, tenantId: string, version: number) {
    const gap = (await pendingTimelineEventIds(tx, tenantId, version, 1))[0];
    const beforeGap = gap
      ? {
          OR: [
            { occurredAt: { lt: gap.occurredAt } },
            { occurredAt: gap.occurredAt, sourceEventId: { lt: gap.id } },
          ],
        }
      : {};
    const last = await tx.timelineProjectionReceipt.findFirst({
      where: { tenantId, projectionVersion: version, ...beforeGap },
      orderBy: [{ occurredAt: 'desc' }, { sourceEventId: 'desc' }],
    });
    const projectionName = timelineProjectionName(version);
    if (!last) {
      await tx.projectionCheckpoint.deleteMany({ where: { tenantId, projectionName } });
      return;
    }
    const data = {
      projectionVersion: version,
      lastOutboxOccurredAt: last.occurredAt,
      lastEventId: last.sourceEventId,
      updatedAt: this.clock.now(),
    };
    await tx.projectionCheckpoint.upsert({
      where: { projectionName_tenantId: { projectionName, tenantId } },
      create: { tenantId, projectionName, ...data },
      update: data,
    });
  }
  async projectEvent(tenantId: string, eventId: string, version = this.version) {
    if (!isUuid(tenantId) || !isUuid(eventId) || !Number.isInteger(version) || version < 1 || version > 32767)
      throw new NonRetryableJobError('TIMELINE_INPUT_INVALID');
    const key = { tenantId, sourceEventId: eventId, projectionVersion: version };
    // A completed event may already have been purged. Its durable receipt still makes a job replay safe.
    if (
      await this.prisma.timelineProjectionReceipt.findUnique({
        where: { tenantId_sourceEventId_projectionVersion: key },
      })
    )
      return;
    const event = await this.prisma.outboxEvent.findFirst({ where: { tenantId, id: eventId } });
    if (!event) throw new NonRetryableJobError('TIMELINE_EVENT_NOT_FOUND');
    let refs: HistoryReference[] = [];
    let primaryId = event.aggregateId;
    let wanted = ALIASES[event.eventName] ?? event.eventName;
    const serialCode = SERIAL_CODES[event.eventName];
    if (TIMELINE_EVENT_NAMES.includes(event.eventName)) {
      if (event.eventVersion !== 1) throw new NonRetryableJobError('JOB_PAYLOAD_UNSUPPORTED');
      const payload =
        event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
          ? event.payload
          : {};
      let kind = event.aggregateType;
      if (serialCode) {
        if (kind !== 'serial') throw new NonRetryableJobError('TIMELINE_SOURCE_MISMATCH');
        kind = 'queue_event';
        const port = this.port(kind);
        const id =
          'queueEventId' in payload
            ? payload.queueEventId
            : await port.legacyQueueId?.(tenantId, event.aggregateId, event.eventName, event.occurredAt);
        if (!isUuid(id)) throw new NonRetryableJobError('TIMELINE_QUEUE_SOURCE_AMBIGUOUS');
        primaryId = id;
        wanted = 'QueueRecord';
      } else if (kind === 'encounter_note') {
        kind = 'encounter_note_version';
        const id = 'versionId' in payload ? payload.versionId : null;
        if (!isUuid(id)) throw new NonRetryableJobError('TIMELINE_VERSION_REFERENCE_INVALID');
        primaryId = id;
      }
      refs = await this.port(kind).read(tenantId, kind, primaryId);
      const primary = refs.find((r) => r.sourceId === primaryId && r.eventName === wanted);
      if (!primary && !(kind === 'document' && (await this.port(kind).exists?.(tenantId, kind, primaryId))))
        throw new NonRetryableJobError('TIMELINE_SOURCE_NOT_FOUND');
      if (
        primary &&
        (primary.aggregateId !== event.aggregateId || (serialCode && primary.eventCode !== serialCode))
      )
        throw new NonRetryableJobError('TIMELINE_SOURCE_MISMATCH');
      if ('patientId' in payload && refs.some((r) => r.patientId !== payload.patientId))
        throw new NonRetryableJobError('TIMELINE_PATIENT_MISMATCH');
    }
    await withTransaction(
      this.prisma,
      async (tx) => {
        // One tenant writer at a time; the receipt, chain, marker and checkpoint commit atomically.
        if (!(await lockRow(tx, 'tenants', tenantId)))
          throw new NonRetryableJobError('TIMELINE_TENANT_NOT_FOUND');
        if (
          await tx.timelineProjectionReceipt.findUnique({
            where: { tenantId_sourceEventId_projectionVersion: key },
          })
        )
          return;
        const withdrawal = [
          'EncounterEnteredInError',
          'DiagnosisVoided',
          'PrescriptionVoided',
          'DocumentRedacted',
        ].includes(event.eventName);
        for (const ref of refs) {
          const isPrimary = ref.sourceId === primaryId && ref.eventName === wanted;
          await this.ensure(
            tx,
            tenantId,
            version,
            ref,
            isPrimary && !withdrawal ? eventId : undefined,
            isPrimary && withdrawal ? eventId : undefined,
          );
        }
        await tx.timelineProjectionReceipt.create({
          data: {
            ...key,
            occurredAt: event.occurredAt,
            processedAt: this.clock.now(),
            outcome: refs.length ? 'PROJECTED' : 'IGNORED',
          },
        });
        await this.checkpoint(tx, tenantId, version);
      },
      { context: 'timeline:project' },
    );
  }
  async catchUp(tenantId: string, limit = 100, version = this.version, signal?: AbortSignal) {
    const pending = await pendingTimelineEventIds(this.prisma, tenantId, version, limit);
    for (const event of pending) {
      signal?.throwIfAborted();
      await this.projectEvent(tenantId, event.id, version);
    }
    return pending.length;
  }
  async backfillPage(
    tenantId: string,
    kind: string,
    afterId: string | null,
    version = this.version,
    signal?: AbortSignal,
  ) {
    if (!isUuid(tenantId) || !Number.isInteger(version) || version < 1 || version > 32767)
      throw new NonRetryableJobError('TIMELINE_INPUT_INVALID');
    const source = this.port(kind);
    const ids = await source.ids(tenantId, kind, afterId, 25);
    const deadline = Date.now() + 10_000;
    let lastId: string | null = null;
    for (const id of ids) {
      signal?.throwIfAborted();
      const refs = await source.read(tenantId, kind, id);
      await withTransaction(
        this.prisma,
        async (tx) => {
          if (!(await lockRow(tx, 'tenants', tenantId)))
            throw new NonRetryableJobError('TIMELINE_TENANT_NOT_FOUND');
          for (const ref of refs) await this.ensure(tx, tenantId, version, ref);
        },
        { context: 'timeline:backfill-page' },
      );
      lastId = id;
      if (Date.now() > deadline) break;
    }
    return { nextCursor: lastId && (lastId !== ids[ids.length - 1] || ids.length === 25) ? lastId : null };
  }
  async backfill(tenantId: string, version = this.version, signal?: AbortSignal) {
    if (!isUuid(tenantId) || !Number.isInteger(version) || version < 1 || version > 32767)
      throw new NonRetryableJobError('TIMELINE_INPUT_INVALID');
    for (const source of this.sources)
      for (const kind of source.kinds) {
        let cursor: string | null = null;
        for (;;) {
          signal?.throwIfAborted();
          const ids = await source.ids(tenantId, kind, cursor, 100);
          for (const id of ids) {
            signal?.throwIfAborted();
            const refs = await source.read(tenantId, kind, id);
            await withTransaction(
              this.prisma,
              async (tx) => {
                if (!(await lockRow(tx, 'tenants', tenantId)))
                  throw new NonRetryableJobError('TIMELINE_TENANT_NOT_FOUND');
                for (const ref of refs) await this.ensure(tx, tenantId, version, ref);
              },
              { context: 'timeline:backfill' },
            );
          }
          if (ids.length < 100) break;
          cursor = ids[ids.length - 1]!;
        }
      }
  }
  async rebuild(tenantId: string, targetVersion: number, signal?: AbortSignal) {
    if (
      !isUuid(tenantId) ||
      !Number.isInteger(targetVersion) ||
      targetVersion <= this.version ||
      targetVersion > 32767
    )
      throw new NonRetryableJobError('TIMELINE_REBUILD_VERSION_INVALID');
    while ((await this.catchUp(tenantId, 100, targetVersion, signal)) === 100) signal?.throwIfAborted();
    await this.backfill(tenantId, targetVersion, signal);
    return this.compare(tenantId, targetVersion);
  }
  async compare(tenantId: string, targetVersion: number) {
    const rows = await this.prisma.timelineEvent.findMany({
      where: { tenantId, projectionVersion: { in: [this.version, targetVersion] } },
    });
    const summarize = (version: number) => {
      const patients = new Map<string, string[]>();
      for (const r of rows.filter((r) => r.projectionVersion === version)) {
        const fingerprints = patients.get(r.patientId) ?? [];
        fingerprints.push(
          canonicalJson([
            r.sourceType,
            r.sourceId,
            r.eventType,
            r.occurredAt,
            r.visibility,
            r.structuredRefs,
            r.redactionReasonCode,
          ]),
        );
        patients.set(r.patientId, fingerprints);
      }
      return patients;
    };
    const active = summarize(this.version),
      target = summarize(targetVersion);
    const patients = [...new Set([...active.keys(), ...target.keys()])].sort().map((patientId) => {
      const a = (active.get(patientId) ?? []).sort(),
        b = (target.get(patientId) ?? []).sort();
      return {
        patientId,
        activeCount: a.length,
        targetCount: b.length,
        matches: canonicalJson(a) === canonicalJson(b),
      };
    });
    return {
      activeVersion: this.version,
      targetVersion,
      matches: patients.every((p) => p.matches),
      patients,
    };
  }
}
