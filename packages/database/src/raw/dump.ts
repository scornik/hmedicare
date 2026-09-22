import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import type { PrismaClient } from '@prisma/client';

/**
 * The little the dumper needs from a database, so it can run over whatever connection the caller already
 * has. The migration guard holds one raw connection and nothing else: making it construct a Prisma client
 * spawned a second pool and the query-engine process beside it, and on a constrained host that was enough
 * to exhaust connections and time out *after* the migration had already run.
 */
export interface SqlReader {
  rows<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** A reader backed by a Prisma client, for callers that already have one. */
export function prismaReader(prisma: PrismaClient): SqlReader {
  return {
    rows: <T>(sql: string, params: unknown[] = []) =>
      prisma.$queryRawUnsafe<T[]>(sql, ...params) as Promise<T[]>,
  };
}

/**
 * Pre-migration dump (Stage 6 DEPLOY-002), written in SQL rather than by shelling out to `mysqldump`.
 *
 * Deviation D-01 made the dump a manual step, and it cost a production outage: the Stage 5 merge added
 * three migrations, the guard refused to run without a confirmed dump, and Passenger restart-looped on a
 * 503 until someone set an environment variable. The fix is for the deploy to take the dump itself.
 *
 * It does not call `mysqldump`, for two reasons. Migrations run in-process at startup
 * (`MIGRATE_ON_STARTUP`) inside a Passenger-managed process on shared hosting, and spawning external
 * binaries there has already failed twice this project — turbo and the Prisma query engine both arrived
 * without their execute bit. And `mysqldump` is simply absent on some machines we must work on, which
 * would leave the safety net untestable in exactly the environments that most need it.
 *
 * The schema this dumps has no BLOB or BINARY columns (checked), so every value is text, numeric or a
 * date. Buffers are still handled, defensively, so a future binary column cannot corrupt a dump silently.
 */
export interface DumpResult {
  /** Absolute path of the gzipped SQL file. */
  path: string;
  bytes: number;
  /** Of the compressed file, so the manifest identifies this exact artefact. */
  sha256: string;
  tableCount: number;
  rowCount: number;
  startedAt: Date;
  finishedAt: Date;
}

export class DumpFailed extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DumpFailed';
  }
}

const ROW_BATCH = 500;

function quoteIdent(name: string): string {
  return `\`${name.replaceAll('`', '``')}\``;
}

/** MariaDB string literal escaping. `\0` and `\x1a` matter on restore, not only quotes. */
function quoteString(value: string): string {
  let out = '';
  for (const ch of value) {
    switch (ch) {
      case '\0':
        out += '\\0';
        break;
      case '\b':
        out += '\\b';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      case '\x1a':
        out += '\\Z';
        break;
      case '\\':
        out += '\\\\';
        break;
      case "'":
        out += "\\'";
        break;
      default:
        out += ch;
    }
  }
  return `'${out}'`;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** UTC, because every timestamp we store is UTC (ADR-014) and the restore session sets `+00:00`. */
function quoteDate(d: Date): string {
  const s =
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
  return `'${s}'`;
}

export function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (value instanceof Date) return quoteDate(value);
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;
  if (typeof value === 'object') return quoteString(JSON.stringify(value));
  return quoteString(String(value));
}

interface TableInfo {
  name: string;
  /** Columns that can be inserted: generated ones are computed by the engine and must be omitted. */
  columns: string[];
  primaryKey: string[];
}

async function describeTables(reader: SqlReader): Promise<TableInfo[]> {
  const tables = await reader.rows<{ name: string }>(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
  );
  const out: TableInfo[] = [];
  for (const { name } of tables) {
    const columns = await reader.rows<{ column_name: string; generated: number }>(
      `SELECT COLUMN_NAME AS column_name,
              CASE WHEN GENERATION_EXPRESSION IS NULL OR GENERATION_EXPRESSION = '' THEN 0 ELSE 1 END AS generated
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [name],
    );
    const primaryKey = (
      await reader.rows<{ column_name: string }>(
        `SELECT COLUMN_NAME AS column_name FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY'
         ORDER BY SEQ_IN_INDEX`,
        [name],
      )
    ).map((r) => r.column_name);
    out.push({
      name,
      columns: columns.filter((c) => Number(c.generated) === 0).map((c) => c.column_name),
      primaryKey,
    });
  }
  return out;
}

async function* statements(reader: SqlReader, tables: TableInfo[]): AsyncGenerator<string> {
  yield '-- HMedicare pre-migration dump (DEPLOY-002). Restore into an empty schema.\n';
  yield 'SET NAMES utf8mb4;\n';
  yield "SET SESSION time_zone = '+00:00';\n";
  yield "SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO';\n";
  // Off for the whole file: tables are written alphabetically, not in dependency order, so a child can
  // precede its parent. Restored data is already consistent — it came from a live database.
  yield 'SET FOREIGN_KEY_CHECKS = 0;\n\n';

  for (const table of tables) {
    const created = await reader.rows<Record<string, string>>(`SHOW CREATE TABLE ${quoteIdent(table.name)}`);
    const ddl = Object.values(created[0] ?? {})[1];
    if (!ddl) throw new DumpFailed(`SHOW CREATE TABLE returned nothing for ${table.name}`);
    yield `DROP TABLE IF EXISTS ${quoteIdent(table.name)};\n${ddl};\n`;

    if (table.columns.length === 0) {
      yield '\n';
      continue;
    }
    const cols = table.columns.map(quoteIdent).join(', ');
    // OFFSET paging needs a total order, which the primary key gives. A table without one is dumped in
    // one statement rather than paged, because paging it could repeat or drop rows.
    const order = table.primaryKey.length ? ` ORDER BY ${table.primaryKey.map(quoteIdent).join(', ')}` : '';
    let offset = 0;
    for (;;) {
      const limit = table.primaryKey.length ? ROW_BATCH : Number.MAX_SAFE_INTEGER;
      const rows = await reader.rows<Record<string, unknown>>(
        `SELECT ${cols} FROM ${quoteIdent(table.name)}${order} LIMIT ${limit} OFFSET ${offset}`,
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        const values = table.columns.map((c) => literal(row[c])).join(', ');
        yield `INSERT INTO ${quoteIdent(table.name)} (${cols}) VALUES (${values});\n`;
      }
      offset += rows.length;
      if (!table.primaryKey.length || rows.length < ROW_BATCH) break;
    }
    yield '\n';
  }
  yield 'SET FOREIGN_KEY_CHECKS = 1;\n';
}

/**
 * Writes a gzipped SQL dump of the current database to `outDir` and returns what it wrote.
 *
 * `rowCount` counts rows written, so a caller can compare it with the live totals. The sha256 is of the
 * compressed file, so the manifest identifies the artefact on disk rather than its contents in theory.
 */
export async function dumpDatabase(
  reader: SqlReader,
  options: { outDir: string; label: string },
): Promise<DumpResult> {
  const startedAt = new Date();
  await mkdir(options.outDir, { recursive: true });
  const safeLabel = options.label.replace(/[^A-Za-z0-9._-]/g, '-');
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const file = path.join(options.outDir, `pre-migration-${safeLabel}-${stamp}.sql.gz`);

  const tables = await describeTables(reader);
  if (tables.length === 0)
    throw new DumpFailed('database reports no base tables; refusing to call this a dump');

  let rowCount = 0;
  const hash = createHash('sha256');
  const gzip = createGzip();
  gzip.on('data', (chunk: Buffer) => hash.update(chunk));

  async function* source() {
    for await (const chunk of statements(reader, tables)) {
      if (chunk.startsWith('INSERT INTO')) rowCount += 1;
      yield chunk;
    }
  }

  try {
    await pipeline(source(), gzip, createWriteStream(file, { mode: 0o600 }));
  } catch (error) {
    throw new DumpFailed(`writing ${file} failed`, { cause: error });
  }

  const { size } = await stat(file);
  return {
    path: file,
    bytes: size,
    sha256: hash.digest('hex'),
    tableCount: tables.length,
    rowCount,
    startedAt,
    finishedAt: new Date(),
  };
}

/** Live table count, for the caller to check the dump covered everything. */
export async function countTables(reader: SqlReader): Promise<number> {
  const rows = await reader.rows<{ n: bigint | number }>(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
  );
  return Number(rows[0]?.n ?? 0);
}
