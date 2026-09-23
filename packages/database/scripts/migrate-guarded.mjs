#!/usr/bin/env node
// Guarded migration (DEPLOYMENT.md §4.1). Used by `hostinger:build:api`, local `pnpm db:migrate`,
// and the worker-startup fallback (MIGRATE_ON_STARTUP, DEPLOYMENT.md §4.3).
//
// 1. Take GET_LOCK('hmedic:migrate:<APP_ENV>') on a dedicated connection (exit 3 MIGRATION_LOCKED on timeout).
// 2. Compute pending migrations; nothing pending → exit 0.
// 3. Staging/production: take a pre-migration dump automatically and verify it, refusing to migrate if it
//    fails (DEPLOY-002). `-- contract` migrations still need ALLOW_CONTRACT_MIGRATION=<APP_VERSION>, because
//    dropping a column is a decision, not an accident a backup should make painless.
// 4. `prisma migrate deploy`, verify nothing is pending, release the lock, print a JSON summary line.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mariadb from 'mariadb';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'prisma/migrations');

function fail(code, message) {
  console.error(JSON.stringify({ event: 'MIGRATION_FAILED', code, message }));
  process.exit(code === 'MIGRATION_LOCKED' ? 3 : code === 'PRE_MIGRATION_DUMP_FAILED' ? 4 : 1);
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

/**
 * Where the dump goes. It must survive the deploy that triggers it: on this host the application lives
 * under `hbuilds/current/`, a symlink into a release directory that is replaced wholesale, so a dump
 * written beside the code is gone the moment it might be needed. Refuse such a path rather than write a
 * backup into a directory that is about to be deleted.
 */
function resolveDumpDir() {
  const configured = process.env.PRE_MIGRATION_DUMP_DIR;
  const dir = path.resolve(configured ?? path.join(os.homedir(), 'hmedic-db-dumps'));
  const appRoot = path.resolve(root, '../..');
  const rel = path.relative(appRoot, dir);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error(
      `PRE_MIGRATION_DUMP_DIR (${dir}) is inside the application directory (${appRoot}), which the next ` +
        'deploy replaces. Point it somewhere that outlives a release.',
    );
  }
  return dir;
}

/**
 * Takes the dump and checks it before letting the migration proceed: a file with bytes in it, a table
 * count matching the live database, and a checksum recorded for the manifest. A dump that cannot be
 * verified is treated as no dump at all.
 */
async function takeVerifiedDump(conn, { appEnv, version, pending }) {
  const outDir = resolveDumpDir();
  const { countTables, dumpDatabase } = await import('../dist/index.js');
  // Over the connection this script already holds. Building a Prisma client here opened a second pool and
  // the query-engine process with it, which on a constrained host exhausted connections and timed out
  // after the migration had already run — a backup step must not be able to break the deploy it protects.
  const reader = { rows: (sql, params = []) => conn.query(sql, params) };
  {
    const live = await countTables(reader);
    // A first deploy migrates an empty database. There is nothing to lose and therefore nothing to back
    // up, and refusing on that would block every new installation. Say so in the log rather than
    // inventing an empty artefact that would later look like a real backup.
    if (live === 0) return { skipped: 'no_tables', tables: 0 };
    const result = await dumpDatabase(reader, { outDir, label: `${appEnv}-${version}` });
    if (result.bytes === 0) throw new Error(`${result.path} is empty`);
    if (result.tableCount !== live) {
      throw new Error(`dump covered ${result.tableCount} tables but the database has ${live}`);
    }
    await writeFile(
      `${result.path}.json`,
      `${JSON.stringify({ ...result, appEnv, version, pendingMigrations: pending }, null, 2)}
`,
      { mode: 0o600 },
    );
    return {
      path: result.path,
      bytes: result.bytes,
      sha256: result.sha256,
      tables: result.tableCount,
      rows: result.rowCount,
    };
  }
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
    if (deployed) {
      // DEPLOY-002. The dump used to be a manual step (D-01) and it cost an outage: the Stage 5 merge
      // added three migrations, this guard refused, and Passenger restart-looped on a 503 until someone
      // set a variable by hand. Now the deploy takes it, verifies it, and refuses to migrate if it fails.
      try {
        const dump = await takeVerifiedDump(conn, { appEnv, version, pending });
        const event = dump.skipped ? 'PRE_MIGRATION_DUMP_SKIPPED' : 'PRE_MIGRATION_DUMP_TAKEN';
        console.log(JSON.stringify({ event, ...dump }));
      } catch (error) {
        fail('PRE_MIGRATION_DUMP_FAILED', error instanceof Error ? error.message : String(error));
      }
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

/**
 * Everything the failure actually said, with any connection string scrubbed out.
 *
 * `prisma migrate deploy` runs with its output piped, so its diagnosis lands on the thrown error rather
 * than on this process's stderr. Reporting only `e.code` threw that away and printed "see stderr" pointing
 * at a stream nothing had written: a deploy died with `EACCES` on the schema engine and the operator was
 * told nothing at all. The detail is worth more than the tidiness of a one-line failure.
 */
function describe(e) {
  if (!e) return 'unknown error';
  const parts = [e.code ? String(e.code) : null, e.message ? String(e.message) : String(e)];
  for (const stream of ['stderr', 'stdout']) {
    const v = e[stream];
    if (v && v.length) parts.push(`${stream}: ${Buffer.isBuffer(v) ? v.toString('utf8') : String(v)}`);
  }
  return parts
    .filter(Boolean)
    .join(' | ')
    .replace(/\b(mysql|mariadb):\/\/[^\s"']+/gi, '$1://<redacted>')
    .slice(0, 4000);
}

main().catch((e) => fail('MIGRATION_ERROR', describe(e)));
