import * as mariadb from 'mariadb';
import { parseDatabaseUrl, sessionInitSql } from '../client';

/**
 * Session-scoped named locks (GET_LOCK) held on a dedicated connection (ADR-015 §7). Used for the job
 * runner singleton and the migration guard. Fallback when GET_LOCK is unavailable: singleton_locks
 * lease rows (see singleton-lease.ts).
 */
export interface NamedLock {
  readonly name: string;
  release(): Promise<void>;
  /** True while the dedicated connection is alive and still holds the lock. */
  isHeld(): Promise<boolean>;
}

export async function openLockConnection(url: string): Promise<mariadb.Connection> {
  const parts = parseDatabaseUrl(url);
  const conn = await mariadb.createConnection({ ...parts, timezone: '+00:00', connectTimeout: 10_000 });
  for (const stmt of sessionInitSql()) await conn.query(stmt);
  return conn;
}

/**
 * Tries to take `name` within `timeoutSeconds` (0 = no wait). Returns null when another session holds it.
 * The caller owns `conn`; releasing the lock does not close it.
 */
export async function acquireNamedLock(
  conn: mariadb.Connection,
  name: string,
  timeoutSeconds = 0,
): Promise<NamedLock | null> {
  if (name.length > 64) throw new Error('named lock names are limited to 64 characters');
  const rows = await conn.query<Array<{ acquired: number | bigint | null }>>(
    'SELECT GET_LOCK(?, ?) AS acquired',
    [name, timeoutSeconds],
  );
  if (Number(rows[0]?.acquired ?? 0) !== 1) return null;
  return {
    name,
    release: async () => {
      await conn.query('SELECT RELEASE_LOCK(?)', [name]);
    },
    isHeld: async () => {
      try {
        const r = await conn.query<Array<{ held: number | bigint | null }>>(
          'SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS held',
          [name],
        );
        return Number(r[0]?.held ?? 0) === 1;
      } catch {
        return false;
      }
    },
  };
}
