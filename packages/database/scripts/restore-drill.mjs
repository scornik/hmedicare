#!/usr/bin/env node
// `pnpm ops:restore-drill --dump <file.sql.gz>` (OPS-002, gate G-4).
//
// Restores a DEPLOY-002 dump into a throwaway database and checks that what comes back matches what the
// manifest said went in.
//
// A backup nobody has restored is not a backup. DEPLOY-002 automated taking the dump, which removed the
// step people forget; it did nothing about the step people never do. This closes that: the dump is read
// back, the schema is checked against the migration state, and the table and row counts are compared with
// the manifest written beside the artefact.
//
// It never touches the source database. The restore target is created fresh, used, and dropped, and the
// script refuses a target name that does not look disposable — restoring a dump over a live database is
// exactly the accident this is supposed to prevent, not cause.
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mariadb = require('mariadb');

const { values } = parseArgs({
  options: {
    dump: { type: 'string' },
    target: { type: 'string' },
    keep: { type: 'boolean' },
  },
});

function fail(code, message) {
  console.error(JSON.stringify({ event: 'RESTORE_DRILL_FAILED', code, message }));
  process.exit(1);
}

function parse(url) {
  const u = new URL(url.replace(/^mysql:/, 'mariadb:'));
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

/** The dump's own manifest, written beside it by the guarded migration. */
async function readManifest(dumpPath) {
  try {
    return JSON.parse(await readFile(`${dumpPath}.json`, 'utf8'));
  } catch {
    return null;
  }
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Feeds the dump to the server one statement at a time.
 *
 * The dump is written one statement per line by `dumpDatabase`, which is what makes this possible without
 * a SQL parser. A multi-line statement would break it, so the line count is reported: a restore that
 * executed far fewer statements than the file has lines is a restore that silently skipped something.
 */
async function restore(conn, dumpPath) {
  const rl = createInterface({
    input: createReadStream(dumpPath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let statements = 0;
  let lines = 0;
  let buffer = '';
  for await (const line of rl) {
    lines += 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    buffer += `${buffer ? '\n' : ''}${line}`;
    if (!trimmed.endsWith(';')) continue;
    await conn.query(buffer);
    statements += 1;
    buffer = '';
  }
  if (buffer.trim()) fail('RESTORE_TRUNCATED', 'the dump ended mid-statement');
  return { statements, lines };
}

async function main() {
  // The application user cannot CREATE DATABASE, and should not be able to: least privilege is why the
  // app account exists at all. A drill is an operator task and needs an operator credential, so it is
  // asked for separately rather than by quietly widening the one the application runs as.
  const url = process.env.RESTORE_DRILL_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url || !values.dump) {
    process.stderr.write(
      'usage: restore-drill --dump <file.sql.gz> [--target <database>] [--keep]\n' +
        'RESTORE_DRILL_DATABASE_URL (preferred) or DATABASE_URL names the server. The credential must be\n' +
        'able to CREATE and DROP a database; the application user deliberately cannot.\n',
    );
    process.exit(2);
  }

  const dumpPath = path.resolve(values.dump);
  const info = await stat(dumpPath).catch(() => null);
  if (!info?.isFile()) fail('DUMP_NOT_FOUND', `no dump at ${dumpPath}`);

  const cfg = parse(url);
  const target = values.target ?? `restore_drill_${Date.now()}`;
  // A target that does not look disposable is refused. Restoring over a live database is the accident
  // this script exists to prevent, and a typo should not be able to cause it.
  if (!/^restore_drill_/.test(target)) {
    fail('UNSAFE_TARGET', `refusing target "${target}": a drill database must be named restore_drill_*`);
  }
  if (target === cfg.database) fail('UNSAFE_TARGET', 'the drill target is the source database');

  const manifest = await readManifest(dumpPath);
  const digest = await sha256(dumpPath);
  if (manifest?.sha256 && manifest.sha256 !== digest) {
    fail('CHECKSUM_MISMATCH', 'the dump does not match the sha256 in its manifest');
  }

  const conn = await mariadb.createConnection({ ...cfg, database: undefined, multipleStatements: false });
  const started = Date.now();
  try {
    try {
      await conn.query(`CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`);
    } catch (e) {
      if (e?.errno === 1044 || e?.errno === 1045) {
        fail(
          'INSUFFICIENT_PRIVILEGE',
          'this credential cannot CREATE DATABASE. Set RESTORE_DRILL_DATABASE_URL to one that can; ' +
            'the application user is not meant to.',
        );
      }
      throw e;
    }
    await conn.query(`USE \`${target}\``);
    const { statements, lines } = await restore(conn, dumpPath);

    const [{ tables }] = await conn.query(
      'SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema = ? AND table_type = ?',
      [target, 'BASE TABLE'],
    );
    const tableRows = await conn.query(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = ? ORDER BY table_name',
      [target, 'BASE TABLE'],
    );
    let rows = 0;
    for (const t of tableRows) {
      const [{ n }] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t.name}\``);
      rows += Number(n);
    }

    // The migration state has to come back too. A restore that loses `_prisma_migrations` looks healthy
    // until the next deploy tries to re-apply every migration onto a full database.
    let migrations = 0;
    try {
      const [{ n }] = await conn.query(
        'SELECT COUNT(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
      );
      migrations = Number(n);
    } catch {
      fail('MIGRATION_STATE_MISSING', '_prisma_migrations did not survive the restore');
    }

    const problems = [];
    if (manifest) {
      if (Number(tables) !== manifest.tableCount) {
        problems.push(`restored ${tables} tables, manifest says ${manifest.tableCount}`);
      }
      if (rows !== manifest.rowCount) {
        problems.push(`restored ${rows} rows, manifest says ${manifest.rowCount}`);
      }
    }
    if (migrations === 0) problems.push('no applied migrations in the restored database');

    const report = {
      event: problems.length ? 'RESTORE_DRILL_FAILED' : 'RESTORE_DRILL_PASSED',
      dump: path.basename(dumpPath),
      sha256: digest,
      manifest: manifest ? { tables: manifest.tableCount, rows: manifest.rowCount } : null,
      restored: { tables: Number(tables), rows, migrations, statements, lines },
      seconds: Math.round((Date.now() - started) / 1000),
      problems,
    };
    console.log(JSON.stringify(report, null, 2));
    if (problems.length) process.exit(1);
  } finally {
    if (!values.keep) {
      await conn.query(`DROP DATABASE IF EXISTS \`${target}\``).catch(() => {});
    } else {
      console.log(JSON.stringify({ event: 'RESTORE_DRILL_KEPT', database: target }));
    }
    await conn.end();
  }
}

main().catch((e) => fail('RESTORE_DRILL_ERROR', String(e?.message ?? e).slice(0, 300)));
