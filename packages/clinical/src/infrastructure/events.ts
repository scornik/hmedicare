import { type Clock, newId } from '@hmedic/kernel';
import type { OutboxPort } from '@hmedic/jobs';
import type { PrismaClient } from '@hmedic/database';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Clinical domain events (EVENT-ARCHITECTURE §3). These are the timeline projector's input in a later
 * stage, so the names match its catalogue exactly rather than reading naturally here.
 *
 * `EncounterNoteDraftSaved` is emitted but explicitly **not projected to the timeline**: a patient's
 * history should record that a note was signed, not that someone typed in it every few seconds.
 *
 * Payloads carry identifiers only. No note text, no diagnosis wording, nothing a subscriber could log or
 * forward that would turn an event bus into a second copy of the medical record.
 */
export type ClinicalEventName =
  | 'EncounterStarted'
  | 'EncounterInterrupted'
  | 'EncounterResumed'
  | 'EncounterCompleted'
  | 'EncounterEnteredInError'
  | 'EncounterNoteDraftSaved'
  | 'EncounterNoteSigned'
  | 'SymptomRecorded'
  | 'DiagnosisRecorded'
  | 'DiagnosisStatusChanged';

/** Emitted but never projected, per EVENT-ARCHITECTURE §3. */
export const NOT_PROJECTED: ReadonlySet<ClinicalEventName> = new Set<ClinicalEventName>([
  'EncounterNoteDraftSaved',
]);

export interface ClinicalOutboxInput {
  tenantId: string;
  name: ClinicalEventName;
  aggregateType: 'encounter' | 'encounter_note' | 'diagnosis' | 'symptom_observation';
  aggregateId: string;
  /** Identifiers, enums and counts only. */
  payload: Record<string, string | number | boolean | null>;
  actorId: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
}

export class ClinicalOutbox {
  constructor(
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async emit(tx: Tx, e: ClinicalOutboxInput): Promise<string> {
    return this.outbox.append(tx, {
      eventName: e.name,
      eventVersion: 1,
      tenantId: e.tenantId,
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      correlationId: e.correlationId ?? newId(),
      causationId: null,
      actorId: e.actorId,
      idempotencyKey: e.idempotencyKey ?? null,
      payload: e.payload,
      occurredAt: this.clock.now(),
    });
  }
}
