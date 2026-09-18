#!/usr/bin/env node
// Guarded migration (DEPLOYMENT.md §4.1). Used by `hostinger:build:api`, local `pnpm db:migrate`,
// and the worker-startup fallback (MIGRATE_ON_STARTUP, DEPLOYMENT.md §4.3).
//
// 1. Take GET_LOCK('hmedic:migrate:<APP_ENV>') on a dedicated connection (exit 3 MIGRATION_LOCKED on timeout).
// 2. Compute pending migrations; nothing pending → exit 0.
// 3. Staging/production: a pre-migration dump must be confirmed. Until OPS-002 ships EncryptedDatabaseDump,
//    the operator takes the dump manually and sets PRE_MIGRATION_DUMP_CONFIRMED=<APP_VERSION> (Stage 4
//    deviation, IMPLEMENTATION-STATUS.md). `-- contract` migrations also need ALLOW_CONTRACT_MIGRATION=<APP_VERSION>.
// 4. `prisma migrate deploy`, verify nothing is pending, release the lock, print a JSON summary line.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mariadb from 'mariadb';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'prisma/migrations');

function fail(code, message) {
  console.error(JSON.stringify({ event: 'MIGRATION_FAILED', code, message }));
  process.exit(code === 'MIGRATION_LOCKED' ? 3 : code === 'PRE_MIGRATION_DUMP_REQUIRED' ? 4 : 1);
}

function parse(url) {
  const u = new URL(url.replace(/^mysql:/, 'mariadb:'));
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

async function appliedMigrations(conn) {
  try {
    const rows = await conn.query(
      'SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    return new Set(rows.map((r) => r.name));
  } catch (e) {
    if (e && e.errno === 1146) return new Set(); // table does not exist yet
    throw e;
  }
}

function migrationDirs() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

async function main() {
  if (process.env.HOSTINGER_BUILD_SKIP_MIGRATIONS === 'true') {
    console.log(JSON.stringify({ event: 'MIGRATION_SKIPPED', reason: 'HOSTINGER_BUILD_SKIP_MIGRATIONS' }));
    return;
  }
  const url = process.env.DATABASE_URL;
  const appEnv = process.env.APP_ENV ?? 'development';
  const version = process.env.APP_VERSION ?? 'dev';
  const lockTimeout = Number(process.env.MIGRATION_LOCK_TIMEOUT_SECONDS ?? 600);
  if (!url) fail('CONFIG', 'DATABASE_URL is not set');
  const conn = await mariadb.createConnection({ ...parse(url), timezone: '+00:00', connectTimeout: 10_000 });
  const lockName = `hmedic:migrate:${appEnv}`;
  try {
    const got = await conn.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, lockTimeout]);
    if (Number(got[0]?.acquired ?? 0) !== 1)
      fail('MIGRATION_LOCKED', `could not acquire ${lockName} within ${lockTimeout}s`);

    const applied = await appliedMigrations(conn);
    const pending = migrationDirs().filter((m) => !applied.has(m));
    if (pending.length === 0) {
      console.log(JSON.stringify({ event: 'MIGRATION_UP_TO_DATE', environment: appEnv }));
      return;
    }
    const deployed = appEnv === 'staging' || appEnv === 'production';
    if (deployed && process.env.PRE_MIGRATION_DUMP_CONFIRMED !== version) {
      fail(
        'PRE_MIGRATION_DUMP_REQUIRED',
        `pending: ${pending.join(', ')}. Take a pre-migration dump (runbook STAGING-DEPLOY-RUNBOOK.md) and set PRE_MIGRATION_DUMP_CONFIRMED=${version}`,
      );
    }
    const contract = pending.filter((m) =>
      readFileSync(path.join(migrationsDir, m, 'migration.sql'), 'utf8').includes('-- contract'),
    );
    if (contract.length && process.env.ALLOW_CONTRACT_MIGRATION !== version) {
      fail(
        'CONTRACT_MIGRATION_NOT_APPROVED',
        `contract migrations need ALLOW_CONTRACT_MIGRATION=${version}: ${contract.join(', ')}`,
      );
    }

    const cli = createRequire(path.join(root, 'package.json')).resolve('prisma/build/index.js');
    execFileSync(process.execPath, [cli, 'migrate', 'deploy'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DATABASE_URL: url.replace(/^mariadb:/, 'mysql:'),
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
    });
    const after = await appliedMigrations(conn);
    const still = migrationDirs().filter((m) => !after.has(m));
    if (still.length) fail('MIGRATION_INCOMPLETE', `still pending after deploy: ${still.join(', ')}`);
    console.log(
      JSON.stringify({ event: 'MIGRATION_APPLIED', environment: appEnv, version, migrations: pending }),
    );
  } finally {
    try {
      await conn.query('SELECT RELEASE_LOCK(?)', [lockName]);
    } catch {
      /* connection may already be gone; the lock dies with the session */
    }
    await conn.end();
  }
}

main().catch((e) => fail('MIGRATION_ERROR', e && e.code ? String(e.code) : 'unexpected error (see stderr)'));
