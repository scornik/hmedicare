import { type Clock, newId } from '@hmedic/kernel';
import type { OutboxPort } from '@hmedic/jobs';
import type { PrismaClient } from '@hmedic/database';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Prescription domain events (EVENT-ARCHITECTURE §3, §4).
 *
 * Payloads carry identifiers, counts and enums only — no medication name, no dose, no instruction text.
 * An event bus that quoted a prescription would be a second copy of the medical record in a system with
 * different access rules, which is the failure the outbox deny-list exists to prevent.
 *
 * A correction emits `PrescriptionVoided` then `PrescriptionApproved` and needs no third name, because
 * it genuinely is both: the old revision was withdrawn and a new one became the patient's prescription.
 * A consumer that had to notice a flag to tell a correction from an original would eventually not, and
 * for a clinical record that is close to the worst failure available (ADR-024).
 */
export type PrescriptionEventName =
  'PrescriptionDraftCreated' | 'PrescriptionReviewed' | 'PrescriptionApproved' | 'PrescriptionVoided';

export interface PrescriptionOutboxInput {
  tenantId: string;
  name: PrescriptionEventName;
  aggregateId: string;
  /** Identifiers, enums and counts only. */
  payload: Record<string, string | number | boolean | null>;
  actorId: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
}

export class PrescriptionOutbox {
  constructor(
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async emit(tx: Tx, e: PrescriptionOutboxInput): Promise<string> {
    return this.outbox.append(tx, {
      eventName: e.name,
      eventVersion: 1,
      tenantId: e.tenantId,
      aggregateType: 'prescription',
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
