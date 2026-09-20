import { type Clock, newId } from '@hmedic/kernel';
import type { Tx } from '@hmedic/database';
import type { OutboxPort } from '@hmedic/jobs';

/**
 * Scheduling outbox events (Stage 5 prompt §5; EVENT-ARCHITECTURE v1). Payloads carry ids, codes and
 * dates only; the outbox port enforces the PHI deny-list. Consumers arrive in later stages.
 */
export type SchedulingEventName =
  | 'ChamberCreated'
  | 'ChamberUpdated'
  | 'ScheduleRuleCreated'
  | 'ScheduleRuleEnded'
  | 'ChamberDayMaterialized'
  | 'ChamberDayOpened'
  | 'ChamberDayPaused'
  | 'ChamberDayClosed'
  | 'ChamberDayCancelled'
  | 'ChamberDelayRecorded'
  | 'ChamberDayPolicyChanged'
  | 'AppointmentBooked'
  | 'AppointmentCancelled'
  | 'AppointmentRescheduled'
  | 'AppointmentNoShow';

export interface SchedulingEventInput {
  tenantId: string;
  name: SchedulingEventName;
  aggregateType: 'chamber' | 'doctor_schedule_rule' | 'chamber_day' | 'appointment';
  aggregateId: string;
  payload: Record<string, string | number | boolean | null | string[]>;
  actorId: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
}

export class SchedulingEvents {
  constructor(
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async emit(tx: Tx, e: SchedulingEventInput): Promise<string> {
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
