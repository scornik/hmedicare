import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { text } from 'node:stream/consumers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as mariadb from 'mariadb';
import { type Database, countTables, dumpDatabase, literal, parseDatabaseUrl, prismaReader } from '../../src';
import { openTestDatabase, rawConnection, testDatabaseUrl } from '../../../../tests/support/db';

/**
 * DEPLOY-002. The prompt asks the dump to be verified by "a checksum plus a table-count check", which
 * proves a file exists and is the right size. It does not prove the file can be read back — and a backup
 * nobody has restored is not a backup (gate condition G-4).
 *
 * So this restores the dump into a second, empty schema on the same server and compares it with the
 * original: every table present, every row count equal, and a row of Bangla clinical-shaped text
 * identical byte for byte. The checksum and table count are asserted too, because the deploy path uses
 * them, but the restore is the real test.
 */
let db: Database;
let outDir: string;
let root: mariadb.Connection;
const RESTORE_SCHEMA = `hm_restore_probe_${Date.now()}`;

beforeAll(async () => {
  db = openTestDatabase();
  outDir = await mkdtemp(path.join(os.tmpdir(), 'hm-dump-'));
  root = await rawConnection(true);
  await root.query(
    `CREATE DATABASE \`${RESTORE_SCHEMA}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`,
  );
});

afterAll(async () => {
  await root?.query(`DROP DATABASE IF EXISTS \`${RESTORE_SCHEMA}\``).catch(() => undefined);
  await root?.end().catch(() => undefined);
  await db?.close();
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

async function readDump(file: string): Promise<string> {
  return text(createReadStream(file).pipe(createGunzip()));
}

describe('pre-migration dump (DEPLOY-002)', () => {
  it('writes a gzipped dump covering every table, and reports a checksum over it', async () => {
    const live = await countTables(prismaReader(db.prisma));
    const result = await dumpDatabase(prismaReader(db.prisma), { outDir, label: 'probe' });

    expect(result.tableCount).toBe(live);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.path.startsWith(outDir)).toBe(true);

    // The checksum is of the artefact on disk, so recomputing it from the file must agree.
    const { createHash } = await import('node:crypto');
    expect(
      createHash('sha256')
        .update(await readFile(result.path))
        .digest('hex'),
    ).toBe(result.sha256);

    const sql = await readDump(result.path);
    expect(sql).toContain('SET FOREIGN_KEY_CHECKS = 0;');
    expect(sql.trimEnd().endsWith('SET FOREIGN_KEY_CHECKS = 1;')).toBe(true);
    expect((sql.match(/^CREATE TABLE /gm) ?? []).length).toBe(live);
  });

  it('restores into an empty schema with identical tables, row counts and text', async () => {
    // Something with a generated column, Bangla text and a NULL, so the restore has to get all three
    // right. `tenants` has `slug` unique and no generated column; `clinics` has `active_name_key`.
    const tenantId = `t-${Date.now()}`;
    const bangla = 'SYNTHETIC পরীক্ষা: রোগীর বিবরণ — আপাতত কিছু নেই';
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
       VALUES (${literal(tenantId)}, ${literal(bangla)}, ${literal(tenantId)}, 'ACTIVE', NOW(3), NOW(3))`,
    );

    const result = await dumpDatabase(prismaReader(db.prisma), { outDir, label: 'restore' });
    const sql = await readDump(result.path);

    // Restore as a client would: statement by statement, into a schema that starts empty.
    await root.query(`USE \`${RESTORE_SCHEMA}\``);
    for (const statement of sql.split(/;\s*\n/).map((s) => s.trim())) {
      if (!statement || statement.startsWith('--')) continue;
      await root.query(statement);
    }

    const source = parseDatabaseUrl(testDatabaseUrl()).database;
    const tablesOf = async (schema: string) =>
      (
        await root.query(
          `SELECT TABLE_NAME AS name FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
          [schema],
        )
      ).map((r: { name: string }) => r.name);

    const before = await tablesOf(source);
    const after = await tablesOf(RESTORE_SCHEMA);
    expect(after).toEqual(before);
    expect(after.length).toBeGreaterThan(20);

    // Row counts per table, not just overall: a dump that lost one table's rows would still total wrong
    // in a way a single number could hide.
    for (const table of before) {
      const [{ n: expected }] = await root.query(`SELECT COUNT(*) AS n FROM \`${source}\`.\`${table}\``);
      const [{ n: actual }] = await root.query(
        `SELECT COUNT(*) AS n FROM \`${RESTORE_SCHEMA}\`.\`${table}\``,
      );
      expect(Number(actual), `row count for ${table}`).toBe(Number(expected));
    }

    const [restored] = await root.query(`SELECT name FROM \`${RESTORE_SCHEMA}\`.tenants WHERE id = ?`, [
      tenantId,
    ]);
    expect(restored.name).toBe(bangla);

    // The generated column was recomputed by the engine, not inserted from the dump.
    const [generated] = await root.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND GENERATION_EXPRESSION <> ''`,
      [RESTORE_SCHEMA],
    );
    expect(Number(generated.n)).toBeGreaterThan(0);

    await db.prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ${literal(tenantId)}`);
  });

  it('escapes the characters that would otherwise break or truncate a restore', () => {
    expect(literal(null)).toBe('NULL');
    expect(literal(true)).toBe('1');
    expect(literal(12n)).toBe('12');
    expect(literal("it's")).toBe("'it\\'s'");
    expect(literal('a\\b')).toBe("'a\\\\b'");
    expect(literal('line\nbreak')).toBe("'line\\nbreak'");
    // \x1a ends input on some clients; \0 truncates a C string.
    expect(literal('a\x1ab')).toBe("'a\\Zb'");
    expect(literal('a\0b')).toBe("'a\\0b'");
    expect(literal(new Date(Date.UTC(2026, 8, 22, 13, 4, 5, 6)))).toBe("'2026-09-22 13:04:05.006'");
    expect(literal(Buffer.from([0xde, 0xad]))).toBe('0xdead');
  });
});
