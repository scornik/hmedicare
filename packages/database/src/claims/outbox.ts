import type { PrismaClient } from '../client';
import { type Tx, withTransaction } from '../tx';

/**
 * Outbox claim (ADR-015 §5, EVENT-ARCHITECTURE.md §3). Pending events are claimed in occurred_at order
 * (`ix_outbox_claim (status, occurred_at)`), mapped to jobs and marked PUBLISHED in the same transaction,
 * so each event is published exactly once even if the publisher restarts.
 */
export interface OutboxRow {
  id: string;
  tenantId: string | null;
  eventName: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  occurredAt: Date;
  correlationId: string;
  causationId: string | null;
  actorUserId: string | null;
}

export const OUTBOX_CLAIM_SQL =
  "SELECT id FROM outbox_events WHERE status = 'PENDING' ORDER BY occurred_at LIMIT ?";

async function loadEvents(tx: Tx, ids: string[]): Promise<OutboxRow[]> {
  if (ids.length === 0) return [];
  const rows = await tx.outboxEvent.findMany({
    where: { id: { in: ids } },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    eventName: r.eventName,
    eventVersion: r.eventVersion,
    aggregateType: r.aggregateType,
    aggregateId: r.aggregateId,
    payload: r.payload,
    occurredAt: r.occurredAt,
    correlationId: r.correlationId,
    causationId: r.causationId,
    actorUserId: r.actorUserId,
  }));
}

/**
 * Claims up to `limit` pending events with SKIP LOCKED and runs `publish` for them in the same
 * transaction; `publish` inserts jobs. Events are then marked PUBLISHED. Returns the number published.
 */
export async function publishOutboxBatch(
  prisma: PrismaClient,
  limit: number,
  now: Date,
  publish: (tx: Tx, events: OutboxRow[]) => Promise<void>,
  strategy: 'skip_locked' | 'conditional_update' = 'skip_locked',
): Promise<number> {
  return withTransaction(
    prisma,
    async (tx) => {
      let ids: string[];
      if (strategy === 'skip_locked') {
        ids = (
          await tx.$queryRawUnsafe<Array<{ id: string }>>(`${OUTBOX_CLAIM_SQL} FOR UPDATE SKIP LOCKED`, limit)
        ).map((r) => r.id);
      } else {
        // Plain FOR UPDATE: concurrent publishers serialize on the head rows instead of skipping them.
        ids = (await tx.$queryRawUnsafe<Array<{ id: string }>>(`${OUTBOX_CLAIM_SQL} FOR UPDATE`, limit)).map(
          (r) => r.id,
        );
      }
      if (ids.length === 0) return 0;
      const events = await loadEvents(tx, ids);
      await publish(tx, events);
      await tx.$executeRawUnsafe(
        `UPDATE outbox_events SET status = 'PUBLISHED', published_at = ?, attempts = attempts + 1 WHERE id IN (${ids
          .map(() => '?')
          .join(', ')}) AND status = 'PENDING'`,
        now,
        ...ids,
      );
      return ids.length;
    },
    { context: 'outbox-publish' },
  );
}

/** Age in seconds of the oldest pending event (outbox_publish_lag_seconds). */
export async function outboxLagSeconds(prisma: PrismaClient, now: Date): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ oldest: Date | null }>>(
    "SELECT MIN(occurred_at) AS oldest FROM outbox_events WHERE status = 'PENDING'",
  );
  const oldest = rows[0]?.oldest;
  return oldest ? Math.max(0, (now.getTime() - new Date(oldest).getTime()) / 1000) : 0;
}
