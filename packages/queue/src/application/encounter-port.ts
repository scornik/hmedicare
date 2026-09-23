import type { QueueActorRef } from '@hmedic/scheduling';

/**
 * What the queue needs from the clinical context, declared here and implemented there.
 *
 * It lives in its own module, importing nothing from the queue's services, so that `serial-service` can
 * depend on it without `serial-lifecycle` and `serial-service` importing each other. Both directions were
 * type-only and harmless at runtime, but a cycle in the module graph is a cycle.
 *
 * Generic over the transaction type for the same reason the scheduling ports are: an application-layer
 * contract may not reach for the database client, or the layering rule is a comment rather than a rule.
 */
export interface EncounterInterruptionPort<TTx = unknown> {
  /**
   * Interrupts the live encounter on this serial, if there is one. Returns its id when it interrupted
   * one, or null when the serial had no encounter.
   *
   * Called inside the queue's own transaction, **before** the transition writes the day's chain event:
   * the chain head is locked at rank 80 (last, by design) and encounters are rank 50, so the other order
   * trips the runtime lock ranking (C-46).
   */
  interruptForSerial(
    tx: TTx,
    tenantId: string,
    serialId: string,
    input: { reason: string; actor: QueueActorRef; correlationId: string },
  ): Promise<string | null>;
}
