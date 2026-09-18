import { createHash } from 'node:crypto';

/**
 * Hash-chain rule (DATABASE-IMPLEMENTATION.md §3.14):
 *   row_hash = sha256(prev_row_hash ‖ "\n" ‖ canonical_json(row))
 * The first row of a chain uses the genesis hash (64 zeros) as `prev` and stores `prev_row_hash = NULL`.
 * Canonical JSON: object keys sorted, dates as ISO-8601 UTC, bigints as decimal strings, `undefined` dropped.
 */
export const GENESIS_HASH = '0'.repeat(64);

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] !== undefined) out[key] = canonicalize(obj[key]);
    }
    return out;
  }
  return value;
}

export function computeRowHash(prevRowHash: string | null, row: unknown): string {
  return createHash('sha256')
    .update(prevRowHash ?? GENESIS_HASH)
    .update('\n')
    .update(canonicalJson(row))
    .digest('hex');
}
