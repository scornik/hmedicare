import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Database,
  REQUIRED_SQL_MODES,
  assertStrictSession,
  createDatabase,
  readSessionMode,
} from '../../src';
import { testDatabaseUrl } from '../../../../tests/support/db';

/**
 * DEPLOY-003. ADR-014 applies the session settings through the adapter's `initSql`, which runs once per
 * connection. That is only a guarantee if it runs on *every* connection — including ones the pool opens
 * later under load, and ones it re-opens after the server drops an idle connection.
 *
 * The deployed server's global `sql_mode` is `NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION` (HOST-001):
 * not strict. So a connection that missed the init would not error, it would silently truncate — and
 * from Stage 6 these tables hold clinical notes.
 */
const POOL = 6;
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: testDatabaseUrl(), poolMax: POOL, minIdle: 1 });
});
afterAll(async () => {
  await db?.close();
});

/** Forces the pool to hold `n` connections at once by keeping `n` queries in flight together. */
async function sampleConcurrently(n: number) {
  const barrier = new Promise<void>((resolve) => setTimeout(resolve, 150));
  return Promise.all(
    Array.from({ length: n }, async () => {
      const report = await readSessionMode(db.prisma);
      await barrier; // hold the connection so the pool cannot serve the next query with it
      return report;
    }),
  );
}

describe('ADR-014 session init (DEPLOY-003)', () => {
  it('applies strict mode and UTC to every connection the pool opens', async () => {
    const reports = await sampleConcurrently(POOL);
    expect(reports).toHaveLength(POOL);
    for (const r of reports) {
      expect(r.missing).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.timeZone).toBe('+00:00');
      for (const mode of REQUIRED_SQL_MODES) expect(r.sqlMode).toContain(mode);
    }
  });

  it('re-applies it after the server drops the connections', async () => {
    await sampleConcurrently(POOL);
    const before = await readSessionMode(db.prisma);
    expect(before.ok).toBe(true);

    // Kill every other connection this user holds, which is what an idle timeout does to a pool that
    // has been sitting overnight. The pool notices and dials again; the question is whether initSql
    // runs on the replacements.
    const rows = await db.prisma.$queryRawUnsafe<Array<{ id: bigint | number }>>(
      'SELECT ID AS id FROM information_schema.PROCESSLIST WHERE USER = SUBSTRING_INDEX(CURRENT_USER(), "@", 1) AND ID <> CONNECTION_ID()',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // A connection may already have gone; killing it twice is not a failure of this test.
      await db.prisma.$executeRawUnsafe(`KILL ${Number(row.id)}`).catch(() => undefined);
    }

    const after = await sampleConcurrently(POOL);
    for (const r of after) {
      expect(r.missing).toEqual([]);
      expect(r.timeZone).toBe('+00:00');
    }
  });

  it('strict mode actually refuses over-long text rather than truncating it', async () => {
    // The point of the guarantee, stated as behaviour rather than as a setting. A real table, not a
    // TEMPORARY one: temporary tables belong to the connection that made them, and the pool serves the
    // next statement from whichever connection is free.
    const table = `strictness_probe_${Date.now()}`;
    await db.prisma.$executeRawUnsafe(`CREATE TABLE ${table} (v VARCHAR(8) NOT NULL) ENGINE=InnoDB`);
    try {
      await expect(
        db.prisma.$executeRawUnsafe(`INSERT INTO ${table} (v) VALUES ('123456789')`),
      ).rejects.toThrow();
      const rows = await db.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*) AS n FROM ${table}`,
      );
      // Not merely refused on one connection: nothing was written, so no connection truncated it.
      expect(Number(rows[0]?.n ?? -1)).toBe(0);
    } finally {
      await db.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table}`);
    }
  });

  it('assertStrictSession names what is missing', async () => {
    await expect(assertStrictSession(db.prisma)).resolves.toMatchObject({ ok: true });
  });
});
