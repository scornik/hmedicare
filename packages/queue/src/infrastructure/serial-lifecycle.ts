import { AppError } from '@hmedic/kernel';
import { type ChamberDayFacts, type QueueActorRef, dayFacts } from '@hmedic/scheduling';
import type { PrismaClient } from '@hmedic/database';
import { lockRow } from '@hmedic/database';
import type { SerialService } from './serial-service';

/**
 * The seam the clinical context moves serials through (MODULE-BOUNDARIES §3, Stage 6 CLIN-002).
 *
 * Every method runs **inside a transaction the caller already owns**, because the invariant these exist
 * to protect spans two contexts: a serial is `IN_CONSULTATION` if and only if exactly one live encounter
 * references it. Two transactions cannot hold that. `clinical.StartEncounter` opens the transaction,
 * writes the encounter, and calls in here to move the serial; if either half fails, neither happened.
 *
 * Only the queue writes to `serials`, which is why this is a port rather than clinical reaching in.
 */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface SerialLifecycleActor {
  actor: QueueActorRef;
  correlationId: string;
  requestId: string | null;
  /** The caller's Idempotency-Key, so a retry replays rather than repeating. */
  idempotencyKey?: string | null;
}

export interface SerialLifecyclePort {
  /** CALLED → IN_CONSULTATION as an encounter starts. Returns the day, which the caller needs anyway. */
  markInConsultation(
    tx: Tx,
    tenantId: string,
    serialId: string,
    who: SerialLifecycleActor,
  ): Promise<ChamberDayFacts>;
  /** IN_CONSULTATION → COMPLETED as an encounter completes. */
  markCompleted(tx: Tx, tenantId: string, serialId: string, who: SerialLifecycleActor): Promise<void>;
  /** Links the serial to the encounter that now owns it. */
  linkEncounter(tx: Tx, tenantId: string, serialId: string, encounterId: string | null): Promise<void>;
  /**
   * Takes the chamber-day and serial locks without transitioning anything, so a caller that must also
   * lock a clinical row can do so in rank order.
   *
   * This exists because of where the chain head sits. Every queue transition ends by appending to the
   * day's hash chain, which locks `integrity_chain_checkpoints` at rank 80 — last, by design. Anything
   * ranked below that has to be locked *before* the transition runs, so a caller that will touch
   * `encounters` (50) locks this path first, then the encounter, and only then asks for the transition.
   * Re-locking rows already held is exempt from the ranking (C-46), so the second pass is free.
   */
  lockSerialPath(tx: Tx, tenantId: string, serialId: string): Promise<ChamberDayFacts>;
}

export class QueueSerialLifecycle implements SerialLifecyclePort {
  constructor(private readonly serials: SerialService) {}

  private async lockSerialAndDay(tx: Tx, tenantId: string, serialId: string) {
    const before = await tx.serial.findFirst({ where: { tenantId, id: serialId } });
    if (!before) throw new AppError('RESOURCE_NOT_FOUND');
    // Chamber day first, then the serial: the Stage 5 ranking (C-46) is 40 then 44, and clinical rows are
    // ranked above both, so an encounter written afterwards cannot invert the order.
    await lockRow(tx, 'chamber_days', before.chamberDayId, tenantId);
    const dayRow = await tx.chamberDay.findFirstOrThrow({
      where: { tenantId, id: before.chamberDayId },
    });
    await lockRow(tx, 'serials', serialId, tenantId);
    const serial = await tx.serial.findFirstOrThrow({ where: { tenantId, id: serialId } });
    return { serial, day: dayFacts(dayRow) };
  }

  async lockSerialPath(tx: Tx, tenantId: string, serialId: string): Promise<ChamberDayFacts> {
    const { day } = await this.lockSerialAndDay(tx, tenantId, serialId);
    return day;
  }

  async markInConsultation(
    tx: Tx,
    tenantId: string,
    serialId: string,
    who: SerialLifecycleActor,
  ): Promise<ChamberDayFacts> {
    const { serial, day } = await this.lockSerialAndDay(tx, tenantId, serialId);
    await this.serials.applyTransition(tx, day, serial, 'start_consultation', {
      actor: who.actor,
      reason: null,
      correlationId: who.correlationId,
      requestId: who.requestId,
      idempotencyKey: who.idempotencyKey ?? null,
    });
    return day;
  }

  async markCompleted(tx: Tx, tenantId: string, serialId: string, who: SerialLifecycleActor): Promise<void> {
    const { serial, day } = await this.lockSerialAndDay(tx, tenantId, serialId);
    await this.serials.applyTransition(tx, day, serial, 'complete', {
      actor: who.actor,
      reason: null,
      correlationId: who.correlationId,
      requestId: who.requestId,
      idempotencyKey: who.idempotencyKey ?? null,
    });
  }

  async linkEncounter(tx: Tx, tenantId: string, serialId: string, encounterId: string | null): Promise<void> {
    await tx.serial.updateMany({ where: { tenantId, id: serialId }, data: { encounterId } });
  }
}

/**
 * The other direction: cancelling a serial that is mid-consultation has to interrupt the encounter, in the
 * same transaction (DOMAIN-SERVICE-CONTRACTS `CancelSerial`). The queue declares what it needs and the
 * composition root supplies clinical's implementation, so neither package imports the other.
 *
 * Absent — before Stage 6, and in any composition without the clinical context — cancelling behaves as it
 * did in Stage 5.
 */
export interface EncounterInterruptionPort {
  /**
   * Interrupts the live encounter on this serial, if there is one. Returns its id when it interrupted
   * one, so the caller can record it, or null when the serial had no encounter.
   */
  interruptForSerial(
    tx: Tx,
    tenantId: string,
    serialId: string,
    input: { reason: string; actor: QueueActorRef; correlationId: string },
  ): Promise<string | null>;
}
