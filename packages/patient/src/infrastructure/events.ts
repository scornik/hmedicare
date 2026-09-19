import { type Clock, newId } from '@hmedic/kernel';
import type { Tx } from '@hmedic/database';
import type { OutboxPort } from '@hmedic/jobs';

/**
 * Patient-context outbox events (EVENT-ARCHITECTURE §4, v1). Payloads carry ids and codes only; the outbox
 * port enforces the deny-list (`event-payload-phi.spec`).
 */
export type PatientEventName =
  | 'PatientCreated'
  | 'PatientUpdated'
  | 'PatientMergeRequested'
  | 'PatientMergeApproved'
  | 'PatientAccountLinked'
  | 'GuardianshipRequested'
  | 'GuardianshipActivated'
  | 'GuardianshipEnded'
  | 'CareTeamMemberAdded'
  | 'CareTeamMemberEnded'
  | 'ConsentGranted'
  | 'ConsentWithdrawn';

export interface PatientEventInput {
  tenantId: string;
  name: PatientEventName;
  aggregateType:
    | 'patient'
    | 'patient_merge_case'
    | 'patient_account'
    | 'patient_guardianship'
    | 'care_team_member'
    | 'patient_consent';
  aggregateId: string;
  payload: Record<string, string | number | boolean | null | string[]>;
  actorId: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
}

export class PatientEvents {
  constructor(
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async emit(tx: Tx, e: PatientEventInput): Promise<string> {
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
