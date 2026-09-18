import { spawn } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import * as mariadb from 'mariadb';
import { parseDatabaseUrl } from '../../src/index';

// T13 (SECURITY-IMPLEMENTATION.md): two deploys running the guarded migration concurrently.
const script = path.resolve(__dirname, '../../scripts/migrate-guarded.mjs');
const dbName = `hmedic_mig_${Date.now()}`;
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

beforeAll(async () => {
  const conn = await rootConn();
  try {
    await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`);
    await conn.query(`GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO 'hmedic_app'@'%'`);
  } finally {
    await conn.end();
  }
  const p = parseDatabaseUrl(inject('databaseUrl'));
  url = `mariadb://${p.user}:${encodeURIComponent(p.password)}@${p.host}:${p.port}/${dbName}`;
});

afterAll(async () => {
  const conn = await rootConn();
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  } finally {
    await conn.end();
  }
});

describe('migrate-guarded (DEPLOYMENT.md §4.1)', () => {
  it('requires a confirmed pre-migration dump in staging when migrations are pending', async () => {
    const r = await run({ DATABASE_URL: url, APP_ENV: 'staging', APP_VERSION: 'abc123' });
    expect(r.code).toBe(4);
    expect(r.out).toContain('PRE_MIGRATION_DUMP_REQUIRED');
  });

  it('applies migrations exactly once when two deploys race (T13)', async () => {
    const env = {
      DATABASE_URL: url,
      APP_ENV: 'staging',
      APP_VERSION: 'abc123',
      PRE_MIGRATION_DUMP_CONFIRMED: 'abc123',
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
    expect(r.code).toBe(0);
    expect(r.out).toContain('MIGRATION_UP_TO_DATE');
  });
});
