import { computeRowHash, type ChainSource } from '@hmedic/audit';
import { DB_ENUMS, type Prisma, type Tx, lockChainHead, advanceChainHead } from '@hmedic/database';
import { AppError, newId, type TenantContext } from '@hmedic/kernel';

export type TimelineEventType = (typeof DB_ENUMS)['timeline_events.event_type'][number];
export type TimelineVisibility = (typeof DB_ENUMS)['timeline_events.visibility'][number];
export interface TimelineAppendInput {
  patientId: string;
  eventType: TimelineEventType;
  occurredAt: Date;
  sourceType: string;
  sourceId: string;
  sourceEventId: string;
  visibility: TimelineVisibility;
  projectionVersion: number;
  structuredRefs: Record<string, string>;
  redactsTimelineEventId?: string;
  redactionReasonCode?: 'ENTERED_IN_ERROR' | 'DOCUMENT_REDACTED' | 'VOIDED' | 'CORRECTED';
}

const SUMMARIES: Record<TimelineEventType, string> = {
  appointment: 'Appointment updated',
  serial: 'Serial updated',
  queue_change: 'Queue updated',
  encounter_started: 'Encounter started',
  encounter_completed: 'Encounter completed',
  symptom: 'Symptom recorded',
  diagnosis: 'Diagnosis recorded',
  prescription_finalized: 'Prescription approved',
  lab_report: 'Lab report updated',
  document: 'Document updated',
  follow_up: 'Follow-up updated',
  communication: 'Communication updated',
  call: 'Remote session updated',
  ai_approved_note: 'Doctor approved note',
  doctor_note: 'Note signed',
  REDACTED: 'Entry removed',
};
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = ['ENTERED_IN_ERROR', 'DOCUMENT_REDACTED', 'VOIDED', 'CORRECTED'];
export const timelineChainKey = (tenantId: string, patientId: string) => `timeline:${tenantId}:${patientId}`;

/** Hashes all stored content, including source links and visibility, but not the hashes themselves. */
export function timelineHashInput(row: {
  prevRowHash: string | null;
  rowHash: string;
  [key: string]: unknown;
}) {
  const { prevRowHash: _prev, rowHash: _hash, ...content } = row;
  return content;
}

/** No update/delete API: a correction or removal appends another row (ADR-014). */
export class TimelineRepository {
  async append(tx: Tx, tenant: TenantContext, input: TimelineAppendInput, now: Date) {
    if (
      ![tenant.tenantId, input.patientId, input.sourceId, input.sourceEventId].every((id) => ID.test(id)) ||
      !DB_ENUMS['timeline_events.event_type'].includes(input.eventType) ||
      !DB_ENUMS['timeline_events.visibility'].includes(input.visibility) ||
      !Number.isInteger(input.projectionVersion) ||
      input.projectionVersion < 1 ||
      input.projectionVersion > 32767 ||
      !Number.isFinite(input.occurredAt.getTime()) ||
      !/^[a-z_]{1,48}$/.test(input.sourceType) ||
      Object.entries(input.structuredRefs).some(
        ([key, value]) => !/^[a-zA-Z]+Id$/.test(key) || !ID.test(value),
      )
    ) {
      throw new AppError('VALIDATION_FAILED');
    }
    if (input.eventType === 'REDACTED') {
      if (
        !input.redactsTimelineEventId ||
        !ID.test(input.redactsTimelineEventId) ||
        !REASONS.includes(input.redactionReasonCode ?? '')
      )
        throw new AppError('VALIDATION_FAILED');
      const original = await tx.timelineEvent.findFirst({
        where: {
          tenantId: tenant.tenantId,
          patientId: input.patientId,
          id: input.redactsTimelineEventId,
          projectionVersion: input.projectionVersion,
          eventType: { not: 'REDACTED' },
        },
      });
      if (!original) throw new AppError('RESOURCE_NOT_FOUND');
    } else if (input.redactsTimelineEventId || input.redactionReasonCode) {
      throw new AppError('VALIDATION_FAILED');
    }
    // Serialize before checking the deduplication key: concurrent deliveries cannot allocate a gap.
    const head = await lockChainHead(tx, timelineChainKey(tenant.tenantId, input.patientId), now);
    const existing = await tx.timelineEvent.findFirst({
      where: {
        tenantId: tenant.tenantId,
        sourceEventId: input.sourceEventId,
        eventType: input.eventType,
        projectionVersion: input.projectionVersion,
      },
    });
    if (existing) {
      if (
        existing.patientId !== input.patientId ||
        existing.sourceId !== input.sourceId ||
        existing.sourceType !== input.sourceType ||
        existing.redactsTimelineEventId !== (input.redactsTimelineEventId ?? null)
      ) {
        throw new AppError('VALIDATION_FAILED');
      }
      return existing;
    }
    const seq = Number(head.lastSeq + 1n);
    if (seq > 4294967295) throw new AppError('VALIDATION_FAILED');
    const content = {
      id: newId(),
      tenantId: tenant.tenantId,
      patientId: input.patientId,
      seq,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceEventId: input.sourceEventId,
      summary: SUMMARIES[input.eventType],
      visibility: input.visibility,
      structuredRefs: input.structuredRefs as Prisma.InputJsonObject,
      projectionVersion: input.projectionVersion,
      redactsTimelineEventId: input.redactsTimelineEventId ?? null,
      redactionReasonCode: input.redactionReasonCode ?? null,
    };
    const prevRowHash = head.lastSeq === 0n ? null : head.lastRowHash;
    const rowHash = computeRowHash(prevRowHash, content);
    const row = await tx.timelineEvent.create({ data: { ...content, prevRowHash, rowHash } });
    await advanceChainHead(tx, head, BigInt(seq), rowHash, now);
    return row;
  }
}

function stream(key: string) {
  const [prefix, tenantId, patientId] = key.split(':');
  if (
    prefix !== 'timeline' ||
    !tenantId ||
    !patientId ||
    !ID.test(tenantId) ||
    !ID.test(patientId) ||
    key.split(':').length !== 3
  )
    throw new AppError('VALIDATION_FAILED');
  return { tenantId, patientId };
}
export const timelineChainSource: ChainSource = {
  prefix: 'timeline:',
  chainType: 'timeline',
  async rowHashAt(prisma, key, seq) {
    const row = await prisma.timelineEvent.findFirst({
      where: { ...stream(key), seq: Number(seq) },
      select: { rowHash: true },
    });
    return row?.rowHash ?? null;
  },
  async rows(prisma, key, afterSeq, throughSeq, limit) {
    const rows = await prisma.timelineEvent.findMany({
      where: { ...stream(key), seq: { gt: Number(afterSeq), lte: Number(throughSeq) } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map((row) => ({
      seq: BigInt(row.seq),
      prevRowHash: row.prevRowHash,
      rowHash: row.rowHash,
      hashInput: timelineHashInput(row),
    }));
  },
};
