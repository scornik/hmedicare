import { type Clock, newId } from '@hmedic/kernel';
import { type PrismaClient, type Tx, advanceChainHead, lockChainHead } from '@hmedic/database';
import { ChainAppender, type ChainSource, computeRowHash } from '@hmedic/audit';
import type { QueueActorRef } from '../application/ports';

/**
 * `queue_events` (DATABASE §3.6): append-only, hash-chained per chamber day under the checkpoint key
 * `queue:chamber_day:<id>`. Every queue mutation writes its event through this writer inside the same
 * transaction as the state change (QUEUE §3, Stage 5 prompt §3.4). Ranked after every lockable table, so
 * the chain checkpoint lock (rank 80) is always the last lock a queue transaction takes.
 */
export const QUEUE_CHAIN_PREFIX = 'queue:chamber_day:';
export const queueChainKey = (chamberDayId: string): string => `${QUEUE_CHAIN_PREFIX}${chamberDayId}`;

export type QueueEventType =
  | 'SERIAL_ISSUED'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'REMOTE_READY'
  | 'WAITING'
  | 'CALLED'
  | 'SKIPPED'
  | 'RECALLED'
  | 'NO_SHOW'
  | 'CANCELLED'
  | 'RESCHEDULED'
  | 'CONSULTATION_STARTED'
  | 'COMPLETED'
  | 'QUEUE_REORDERED'
  | 'DELAY_RECORDED'
  | 'DAY_OPENED'
  | 'DAY_PAUSED'
  | 'DAY_CLOSED'
  | 'DAY_CANCELLED'
  | 'POLICY_CHANGED'
  | 'DUPLICATE_OVERRIDE';

export interface QueueEventInput {
  tenantId: string;
  chamberDayId: string;
  serialId?: string | null;
  eventType: QueueEventType;
  fromStatus?: string | null;
  toStatus?: string | null;
  positionBefore?: number | null;
  positionAfter?: number | null;
  /** Ids, codes and numbers only (never names or phones). */
  details?: Record<string, unknown>;
  reason?: string | null;
  actor: QueueActorRef;
  idempotencyKey?: string | null;
}

export interface QueueEventRow {
  id: string;
  tenantId: string;
  chamberDayId: string;
  serialId: string | null;
  seq: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  positionBefore: number | null;
  positionAfter: number | null;
  details: unknown;
  reason: string | null;
  actorUserId: string | null;
  actorType: string;
  idempotencyKey: string | null;
  occurredAt: Date;
  prevRowHash: string | null;
  rowHash: string;
}

/** The hashed projection of a row (stable field order; `canonicalJson` sorts keys). */
export function queueHashInput(r: Omit<QueueEventRow, 'prevRowHash' | 'rowHash'>) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    chamberDayId: r.chamberDayId,
    serialId: r.serialId,
    seq: r.seq,
    eventType: r.eventType,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    positionBefore: r.positionBefore,
    positionAfter: r.positionAfter,
    details: r.details,
    reason: r.reason,
    actorUserId: r.actorUserId,
    actorType: r.actorType,
    idempotencyKey: r.idempotencyKey,
    occurredAt: r.occurredAt,
  };
}

export class QueueEventWriter {
  private readonly chain = new ChainAppender();

  constructor(private readonly clock: Clock) {}

  async append(tx: Tx, e: QueueEventInput): Promise<{ id: string; seq: number }> {
    const now = this.clock.now();
    const id = newId();
    const base = {
      id,
      tenantId: e.tenantId,
      chamberDayId: e.chamberDayId,
      serialId: e.serialId ?? null,
      eventType: e.eventType,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      positionBefore: e.positionBefore ?? null,
      positionAfter: e.positionAfter ?? null,
      details: e.details ?? {},
      reason: e.reason ?? null,
      actorUserId: e.actor.userId,
      actorType: e.actor.actorType,
      idempotencyKey: e.idempotencyKey ?? null,
      occurredAt: now,
    };
    const { slot } = await this.chain.append(
      tx,
      queueChainKey(e.chamberDayId),
      now,
      (s) => queueHashInput({ ...base, seq: Number(s.seq) }),
      async (s, rowHash) =>
        tx.queueEvent.create({
          data: {
            ...base,
            seq: Number(s.seq),
            details: base.details as never,
            prevRowHash: s.prevRowHash,
            rowHash,
          },
        }),
    );
    return { id, seq: Number(slot.seq) };
  }

  /**
   * Appends several events to the same chamber-day chain in one pass: the chain head is locked once, the
   * hashes are computed in sequence in memory, the rows go in as one insert, and the head advances once.
   *
   * A walk-in emits three events (SERIAL_ISSUED, CHECKED_IN, WAITING). Appending them one at a time costs
   * nine statements and takes the chain lock three times; this costs three and takes it once. Statement
   * count is what dominates the transaction (profiling R-01: ~7.4 ms per statement round trip).
   */
  async appendMany(tx: Tx, events: readonly QueueEventInput[]): Promise<Array<{ id: string; seq: number }>> {
    if (events.length === 0) return [];
    if (events.length === 1) return [await this.append(tx, events[0]!)];
    const chainKey = queueChainKey(events[0]!.chamberDayId);
    if (events.some((e) => queueChainKey(e.chamberDayId) !== chainKey)) {
      throw new Error('appendMany: every event must belong to one chamber day chain');
    }
    const now = this.clock.now();
    const head = await lockChainHead(tx, chainKey, now);
    let prevRowHash = head.lastSeq === 0n ? null : head.lastRowHash;
    const rows: Array<Record<string, unknown>> = [];
    const result: Array<{ id: string; seq: number }> = [];
    for (const [i, e] of events.entries()) {
      const seq = Number(head.lastSeq) + i + 1;
      const base = {
        id: newId(),
        tenantId: e.tenantId,
        chamberDayId: e.chamberDayId,
        serialId: e.serialId ?? null,
        eventType: e.eventType,
        fromStatus: e.fromStatus ?? null,
        toStatus: e.toStatus ?? null,
        positionBefore: e.positionBefore ?? null,
        positionAfter: e.positionAfter ?? null,
        details: e.details ?? {},
        reason: e.reason ?? null,
        actorUserId: e.actor.userId,
        actorType: e.actor.actorType,
        idempotencyKey: e.idempotencyKey ?? null,
        occurredAt: now,
        seq,
      };
      const rowHash = computeRowHash(prevRowHash, queueHashInput(base));
      rows.push({ ...base, prevRowHash, rowHash });
      result.push({ id: base.id, seq });
      prevRowHash = rowHash;
    }
    await tx.queueEvent.createMany({ data: rows as never });
    await advanceChainHead(tx, head, BigInt(Number(head.lastSeq) + events.length), prevRowHash!, now);
    return result;
  }
}

/** Chain verification source for `VerifyAppendOnlyChains` (one chain per chamber day). */
export const queueChainSource: ChainSource = {
  prefix: QUEUE_CHAIN_PREFIX,
  chainType: 'queue',
  async rowHashAt(prisma: PrismaClient, checkpointKey: string, seq: bigint) {
    const chamberDayId = checkpointKey.slice(QUEUE_CHAIN_PREFIX.length);
    const row = await prisma.queueEvent.findFirst({
      where: { chamberDayId, seq: Number(seq) },
      select: { rowHash: true },
    });
    return row?.rowHash ?? null;
  },
  async rows(
    prisma: PrismaClient,
    checkpointKey: string,
    afterSeq: bigint,
    throughSeq: bigint,
    limit: number,
  ) {
    const chamberDayId = checkpointKey.slice(QUEUE_CHAIN_PREFIX.length);
    const rows = await prisma.queueEvent.findMany({
      where: { chamberDayId, seq: { gt: Number(afterSeq), lte: Number(throughSeq) } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      seq: BigInt(r.seq),
      prevRowHash: r.prevRowHash,
      rowHash: r.rowHash,
      hashInput: queueHashInput(r),
    }));
  },
};
