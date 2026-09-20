import { type Clock, newId } from '@hmedic/kernel';
import type { Tx } from '@hmedic/database';
import type { OutboxPort } from '@hmedic/jobs';

/**
 * Queue outbox events (Stage 5 prompt §5). Ids, codes, numbers and dates only; consumers (notifications,
 * timeline) arrive in later stages. Distinct from `queue_events` (the hash-chained per-day ledger).
 */
export type QueueEventName =
  | 'SerialIssued'
  | 'SerialConfirmed'
  | 'SerialCheckedIn'
  | 'SerialWaiting'
  | 'SerialCalled'
  | 'SerialSkipped'
  | 'SerialRecalled'
  | 'SerialNoShow'
  | 'SerialCancelled'
  | 'SerialRescheduled'
  | 'SerialCompleted'
  | 'SerialRemoteReady'
  | 'QueueReordered';

export interface QueueOutboxInput {
  tenantId: string;
  name: QueueEventName;
  aggregateType: 'serial' | 'chamber_day';
  aggregateId: string;
  payload: Record<string, string | number | boolean | null | string[]>;
  actorId: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
}

export class QueueOutbox {
  constructor(
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async emit(tx: Tx, e: QueueOutboxInput): Promise<string> {
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
