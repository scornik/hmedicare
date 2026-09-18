import { type Tx, advanceChainHead, lockChainHead } from '@hmedic/database';
import { computeRowHash } from '../domain/chain-hash';

export interface ChainSlot {
  seq: bigint;
  /** null for the first row of a chain. */
  prevRowHash: string | null;
}

/**
 * ChainAppender (MODULE-BOUNDARIES.md): allocates the next sequence of a hash chain inside the writer
 * transaction and advances the checkpoint after the row is written. Used by every hash-chained table
 * (audit now; gate decisions, queue events, timeline, ledger later).
 */
export class ChainAppender {
  async append<T>(
    tx: Tx,
    checkpointKey: string,
    now: Date,
    build: (slot: ChainSlot) => unknown,
    write: (slot: ChainSlot, rowHash: string) => Promise<T>,
  ): Promise<{ slot: ChainSlot; rowHash: string; result: T }> {
    const head = await lockChainHead(tx, checkpointKey, now);
    const slot: ChainSlot = {
      seq: head.lastSeq + 1n,
      prevRowHash: head.lastSeq === 0n ? null : head.lastRowHash,
    };
    const rowHash = computeRowHash(slot.prevRowHash, build(slot));
    const result = await write(slot, rowHash);
    await advanceChainHead(tx, head, slot.seq, rowHash, now);
    return { slot, rowHash, result };
  }
}
