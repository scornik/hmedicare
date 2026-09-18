import type { Tx } from '../tx';
import { lockRowBy } from './lock-row';

/**
 * Hash-chain head allocation (DATABASE-IMPLEMENTATION.md §3.14 `integrity_chain_checkpoints`).
 * The checkpoint row is created if missing and locked `FOR UPDATE` inside the writer transaction, so
 * sequence numbers per chain are gap-free and serialized. Lock waits are local to one chain.
 */
export const GENESIS_ROW_HASH = '0'.repeat(64);

export interface ChainHead {
  chainKey: string;
  lastSeq: bigint;
  lastRowHash: string;
}

interface CheckpointRow {
  chain_key: string;
  last_seq: bigint | number | string;
  last_row_hash: string;
}

export async function lockChainHead(tx: Tx, chainKey: string, now: Date): Promise<ChainHead> {
  let row = await lockRowBy<CheckpointRow & Record<string, unknown>>(
    tx,
    'integrity_chain_checkpoints',
    'chain_key',
    chainKey,
  );
  if (!row) {
    // First writer of this chain. A concurrent first writer may deadlock here; withTransaction retries 1213.
    await tx.$executeRawUnsafe(
      'INSERT IGNORE INTO integrity_chain_checkpoints (chain_key, last_seq, last_row_hash, verified_through_seq, updated_at) VALUES (?, 0, ?, 0, ?)',
      chainKey,
      GENESIS_ROW_HASH,
      now,
    );
    row = await lockRowBy<CheckpointRow & Record<string, unknown>>(
      tx,
      'integrity_chain_checkpoints',
      'chain_key',
      chainKey,
    );
    if (!row) throw new Error('chain head could not be created');
  }
  return { chainKey, lastSeq: BigInt(row.last_seq), lastRowHash: row.last_row_hash };
}

/** Advances a locked chain head; the caller must hold the lock from `lockChainHead` in the same tx. */
export async function advanceChainHead(
  tx: Tx,
  head: ChainHead,
  seq: bigint,
  rowHash: string,
  now: Date,
): Promise<void> {
  const n = await tx.$executeRawUnsafe(
    'UPDATE integrity_chain_checkpoints SET last_seq = ?, last_row_hash = ?, updated_at = ? WHERE chain_key = ? AND last_seq = ?',
    seq,
    rowHash,
    now,
    head.chainKey,
    head.lastSeq,
  );
  if (n !== 1) throw new Error('chain head moved while locked');
}
