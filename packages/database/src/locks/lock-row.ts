import type { Tx } from '../tx';

/**
 * Row locks (DATABASE-IMPLEMENTATION.md §1.4). The only place `FOR UPDATE` appears outside claims.
 * Table names come from a fixed allow-list; values are always bound parameters.
 */
export const LOCKABLE_TABLES = new Set([
  'tenants',
  'users',
  'tenant_memberships',
  'clinics',
  'doctor_profiles',
  'staff_profiles',
  'doctor_coverages',
  'sessions',
  'refresh_tokens',
  'otp_challenges',
  'password_reset_tokens',
  'email_verification_tokens',
  'idempotency_records',
  'integrity_chain_checkpoints',
  'platform_operators',
  'provider_credentials',
  'jobs',
  'outbox_events',
  'singleton_locks',
]);

function assertTable(table: string): void {
  if (!LOCKABLE_TABLES.has(table)) throw new Error(`lockRow: table ${table} is not lockable`);
}

/** Locks one row by id (and tenant when tenant-scoped). Returns false when the row does not exist. */
export async function lockRow(tx: Tx, table: string, id: string, tenantId?: string): Promise<boolean> {
  assertTable(table);
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
  const rows = await tx.$queryRawUnsafe<T[]>(
    `SELECT * FROM \`${table}\` WHERE \`${column}\` = ? FOR UPDATE`,
    value,
  );
  return rows[0] ?? null;
}
