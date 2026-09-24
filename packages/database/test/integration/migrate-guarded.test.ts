import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import * as mariadb from 'mariadb';
import { parseDatabaseUrl } from '../../src/index';

// T13 (SECURITY-IMPLEMENTATION.md): two deploys running the guarded migration concurrently.
const script = path.resolve(__dirname, '../../scripts/migrate-guarded.mjs');
const dbName = `hmedic_mig_${Date.now()}`;
// Outside the repository: the guard refuses a dump directory inside the application tree, and rightly so.
const dumpDir = mkdtempSync(path.join(os.tmpdir(), 'hm-migdump-'));
let url: string;

async function rootConn() {
  return mariadb.createConnection({ ...parseDatabaseUrl(inject('rootDatabaseUrl')), database: undefined });
}

function run(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (out += String(d)));
    child.on('close', (code) => resolve({ code, out }));
  });
}

const extraDatabases: string[] = [];

/** A fresh, empty database plus a URL for it, so a test can start from a known state. */
async function freshDatabase(name: string): Promise<string> {
  const conn = await rootConn();
  try {
    await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`);
    await conn.query(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO 'hmedic_app'@'%'`);
  } finally {
    await conn.end();
  }
  const p = parseDatabaseUrl(inject('databaseUrl'));
  return `mariadb://${p.user}:${encodeURIComponent(p.password)}@${p.host}:${p.port}/${name}`;
}

beforeAll(async () => {
  url = await freshDatabase(dbName);
});

afterAll(async () => {
  const conn = await rootConn();
  try {
    for (const name of [dbName, ...extraDatabases]) {
      await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
    }
  } finally {
    await conn.end();
    rmSync(dumpDir, { recursive: true, force: true });
  }
});

/**
 * These are the slowest tests in the suite and the timeout has to say so.
 *
 * Each one spawns the real guarded-migration script, which runs `mysqldump` over the whole schema,
 * verifies the dump and then applies migrations through the Prisma migration engine — 31 s and 40 s on an
 * idle machine. Against the project default of 60 s that is barely 1.5x of headroom, and a full
 * `checkpoint-verify` run has two MariaDB containers, a Playwright browser and the mobile toolchain
 * competing for the same cores. The result was a gate that failed on a different test in this file each
 * time while every one of them passed when run alone.
 *
 * Three minutes is not a looser assertion — nothing about what these tests check has changed. It is the
 * difference between a timeout that measures the machine's spare capacity and one that measures whether
 * the script finished.
 */
const SLOW_MIGRATION_TIMEOUT_MS = 180_000;

describe('migrate-guarded (DEPLOYMENT.md §4.1)', { timeout: SLOW_MIGRATION_TIMEOUT_MS }, () => {
  it('takes and verifies a pre-migration dump itself in staging (DEPLOY-002)', async () => {
    // A database with something in it and migrations pending — the case the dump exists for. A first
    // deploy migrates an empty schema, which is the other case and is covered below.
    const name = `hmedic_mig_data_${Date.now()}`;
    extraDatabases.push(name);
    const populated = await freshDatabase(name);
    const conn = await mariadb.createConnection(parseDatabaseUrl(populated));
    try {
      await conn.query('CREATE TABLE existing_data (id INT PRIMARY KEY, note VARCHAR(64) NOT NULL)');
      await conn.query("INSERT INTO existing_data VALUES (1, 'SYNTHETIC row that must survive')");
      // Any real installation holding data already has this table, because a migration created the data.
      // Without it `migrate deploy` refuses a non-empty schema (P3005), so leaving it out would test a
      // database that cannot exist.
      await conn.query(`CREATE TABLE _prisma_migrations (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        checksum VARCHAR(64) NOT NULL,
        finished_at DATETIME(3) NULL,
        migration_name VARCHAR(255) NOT NULL,
        logs TEXT NULL,
        rolled_back_at DATETIME(3) NULL,
        started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        applied_steps_count INTEGER UNSIGNED NOT NULL DEFAULT 0
      )`);
    } finally {
      await conn.end();
    }

    const r = await run({
      DATABASE_URL: populated,
      APP_ENV: 'staging',
      APP_VERSION: 'abc123',
      PRE_MIGRATION_DUMP_DIR: dumpDir,
    });
    expect(r.out).toContain('PRE_MIGRATION_DUMP_TAKEN');
    expect(r.code, r.out).toBe(0);

    // The deploy log is where an operator looks afterwards, so the artefact has to be identified there.
    const taken = JSON.parse(
      r.out.split(/\r?\n/).find((l) => l.includes('PRE_MIGRATION_DUMP_TAKEN')) ?? '{}',
    );
    expect(taken.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(taken.bytes).toBeGreaterThan(0);
    expect(taken.tables).toBeGreaterThan(0);
    expect(existsSync(taken.path)).toBe(true);
    expect(existsSync(`${taken.path}.json`)).toBe(true);
    // Taken before the migration ran, so it holds the schema as it was.
    expect(r.out.indexOf('PRE_MIGRATION_DUMP_TAKEN')).toBeLessThan(r.out.indexOf('MIGRATION_APPLIED'));
  });

  it('skips the dump on a first deploy, where the database is empty (DEPLOY-002)', async () => {
    // Nothing to lose means nothing to back up. Refusing here would block every new installation, and
    // writing an empty file would leave something that later looks like a real backup.
    const name = `hmedic_mig_empty_${Date.now()}`;
    extraDatabases.push(name);
    const r = await run({
      DATABASE_URL: await freshDatabase(name),
      APP_ENV: 'staging',
      APP_VERSION: 'abc125',
      PRE_MIGRATION_DUMP_DIR: dumpDir,
    });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('PRE_MIGRATION_DUMP_SKIPPED');
    expect(r.out).toContain('no_tables');
    expect(r.out).toContain('MIGRATION_APPLIED');
  });

  it('refuses to migrate when the dump cannot be written (DEPLOY-002)', async () => {
    // A directory inside the application tree is refused outright: the deploy that triggers the dump is
    // the same deploy that replaces that tree, so the backup would be gone exactly when it was needed.
    const r = await run({
      DATABASE_URL: url,
      APP_ENV: 'staging',
      APP_VERSION: 'abc124',
      PRE_MIGRATION_DUMP_DIR: path.resolve(__dirname, '../../dumps-here'),
    });
    expect(r.code).toBe(4);
    expect(r.out).toContain('PRE_MIGRATION_DUMP_FAILED');
    expect(r.out).toContain('inside the application directory');
    expect(r.out).not.toContain('MIGRATION_APPLIED');
  });

  it('applies migrations exactly once when two deploys race (T13)', async () => {
    const env = {
      DATABASE_URL: url,
      APP_ENV: 'staging',
      APP_VERSION: 'abc123',
      PRE_MIGRATION_DUMP_DIR: dumpDir,
    };
    const [a, b] = await Promise.all([run(env), run(env)]);
    expect([a.code, b.code]).toEqual([0, 0]);
    const events = [a.out, b.out].map((o) =>
      o.includes('MIGRATION_APPLIED') ? 'applied' : o.includes('MIGRATION_UP_TO_DATE') ? 'noop' : 'other',
    );
    expect(events.sort()).toEqual(['applied', 'noop']);
    const conn = await mariadb.createConnection(parseDatabaseUrl(url));
    try {
      const rows = await conn.query(
        'SELECT COUNT(*) AS n, COUNT(DISTINCT migration_name) AS d FROM _prisma_migrations',
      );
      expect(Number(rows[0].n)).toBe(Number(rows[0].d));
    } finally {
      await conn.end();
    }
  });

  it('is a no-op once up to date', async () => {
    const r = await run({ DATABASE_URL: url, APP_ENV: 'staging', APP_VERSION: 'def456' });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('MIGRATION_UP_TO_DATE');
  });
});
