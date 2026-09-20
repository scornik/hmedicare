import type { Tx } from '../tx';
import { LOCK_RANKING, recordLock } from './lock-ranking';

/**
 * Row locks (DATABASE-IMPLEMENTATION.md §1.4). The only place `FOR UPDATE` appears outside claims.
 * Table names come from a fixed allow-list (the lock ranking, audit C-46); values are always bound
 * parameters. Every lock is recorded on the transaction so an out-of-order lock fails fast.
 */
export const LOCKABLE_TABLES: ReadonlySet<string> = new Set(Object.keys(LOCK_RANKING));

function assertTable(table: string): void {
  if (!LOCKABLE_TABLES.has(table)) throw new Error(`lockRow: table ${table} is not lockable`);
}

/** Locks one row by id (and tenant when tenant-scoped). Returns false when the row does not exist. */
export async function lockRow(tx: Tx, table: string, id: string, tenantId?: string): Promise<boolean> {
  assertTable(table);
  recordLock(tx, table, id);
  const rows =
    tenantId === undefined
      ? await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`,
          id,
        )
      : await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM \`${table}\` WHERE id = ? AND tenant_id = ? FOR UPDATE`,
          id,
          tenantId,
        );
  return rows.length === 1;
}

/**
 * Locks one row by id and returns it in the same statement. Use this whenever the locked row's own columns
 * decide what is written next — an allocation counter, a version token — so there is no second statement
 * between the lock and the read that could observe a different snapshot.
 */
export async function lockRowAndRead<T extends Record<string, unknown>>(
  tx: Tx,
  table: string,
  id: string,
  tenantId: string,
): Promise<T | null> {
  assertTable(table);
  recordLock(tx, table, id);
  const rows = await tx.$queryRawUnsafe<T[]>(
    `SELECT * FROM \`${table}\` WHERE id = ? AND tenant_id = ? FOR UPDATE`,
    id,
    tenantId,
  );
  return rows[0] ?? null;
}

/**
 * Atomically consumes one value from an unsigned counter column and returns the value consumed. The
 * increment and the read are a single statement: MariaDB evaluates `LAST_INSERT_ID(expr)` while holding the
 * row's X lock, and `LAST_INSERT_ID()` then returns that value for this connection only. A read-then-write
 * pair cannot give the same guarantee, because the two statements carry separate snapshots — which is how
 * two receptionists can be handed the same serial number on a hot chamber day.
 */
export async function allocateCounter(
  tx: Tx,
  table: string,
  column: string,
  id: string,
  tenantId: string,
): Promise<number> {
  assertTable(table);
  if (!/^[a-z_]+$/.test(column)) throw new Error(`allocateCounter: invalid column ${column}`);
  recordLock(tx, table, id);
  const updated = await tx.$executeRawUnsafe(
    `UPDATE \`${table}\` SET \`${column}\` = LAST_INSERT_ID(\`${column}\`) + 1 WHERE id = ? AND tenant_id = ?`,
    id,
    tenantId,
  );
  if (updated !== 1) throw new Error(`allocateCounter: ${table} row not found`);
  const rows = await tx.$queryRawUnsafe<Array<{ value: bigint | number }>>(
    'SELECT LAST_INSERT_ID() AS value',
  );
  return Number(rows[0]?.value ?? 0);
}

/** Locks several rows in stable id order (deadlock prevention). Returns the ids that exist. */
export async function lockRows(
  tx: Tx,
  table: string,
  ids: readonly string[],
  tenantId?: string,
): Promise<string[]> {
  const locked: string[] = [];
  for (const id of [...ids].sort()) if (await lockRow(tx, table, id, tenantId)) locked.push(id);
  return locked;
}

/** Locks a row by a unique key column instead of id (e.g. refresh_tokens.token_hash). */
export async function lockRowBy<T extends Record<string, unknown>>(
  tx: Tx,
  table: string,
  column: 'token_hash' | 'chain_key' | 'id',
  value: string,
): Promise<T | null> {
  assertTable(table);
  recordLock(tx, table, `${column}=${value}`);
  const rows = await tx.$queryRawUnsafe<T[]>(
    `SELECT * FROM \`${table}\` WHERE \`${column}\` = ? FOR UPDATE`,
    value,
  );
  return rows[0] ?? null;
}
