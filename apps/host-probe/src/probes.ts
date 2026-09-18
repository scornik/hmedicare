import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import * as mariadb from 'mariadb';

/**
 * HOST verification probes (HOSTING-VERIFICATION.md §5). Every DB probe runs against the dedicated probe
 * database (`HOST_PROBE_DATABASE_URL`) and only touches `probe_*` scratch tables, which are dropped after
 * each run. Results are plain JSON for `pnpm host:record-results`.
 */
export interface ProbeConfig {
  databaseUrl: string;
  storageDir: string;
  appEnv: string;
  egressTargets: string[];
}

function parseUrl(url: string) {
  const u = new URL(url.replace(/^mysql:/, 'mariadb:'));
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    timezone: '+00:00',
    connectTimeout: 10_000,
  };
}

async function connect(cfg: ProbeConfig) {
  return mariadb.createConnection(parseUrl(cfg.databaseUrl));
}

async function scalar<T>(conn: mariadb.Connection, sql: string, params: unknown[] = []): Promise<T> {
  const rows = (await conn.query(sql, params)) as Array<Record<string, T>>;
  return Object.values(rows[0] ?? {})[0] as T;
}

/** HOST-001: engine version, limits, collation, sql_mode, size, 30 concurrent connections. */
export async function probeDb(cfg: ProbeConfig) {
  const conn = await connect(cfg);
  try {
    const version = await scalar<string>(conn, 'SELECT VERSION()');
    const [major, minor] = version.split('.').map(Number) as [number, number];
    const result = {
      version,
      isMariaDb: /mariadb/i.test(version),
      atLeast106: major > 10 || (major === 10 && minor >= 6),
      maxUserConnections: Number(await scalar(conn, 'SELECT @@max_user_connections')),
      maxConnections: Number(await scalar(conn, 'SELECT @@max_connections')),
      collationAvailable:
        ((await conn.query("SHOW COLLATION LIKE 'utf8mb4_unicode_520_ci'")) as unknown[]).length === 1,
      sqlMode: String(await scalar(conn, 'SELECT @@sql_mode')),
      databaseSizeMb: Number(
        await scalar(
          conn,
          'SELECT ROUND(COALESCE(SUM(data_length + index_length), 0) / 1048576, 2) FROM information_schema.TABLES WHERE table_schema = DATABASE()',
        ),
      ),
      concurrentConnections: 0,
    };
    const extra: mariadb.Connection[] = [];
    try {
      for (let i = 0; i < 30; i++) extra.push(await connect(cfg));
    } catch {
      /* the count reached is the result */
    } finally {
      result.concurrentConnections = extra.length + 1;
      await Promise.all(extra.map((c) => c.end().catch(() => undefined)));
    }
    return {
      ...result,
      pass: result.atLeast106 && result.collationAvailable && result.concurrentConnections >= 30,
    };
  } finally {
    await conn.end();
  }
}

/** HOST-002: runtime, heap budget (NODE_OPTIONS honoured), native module loading. */
export function probeRuntime() {
  const require = createRequire(__filename);
  const native = (name: string) => {
    try {
      require(name);
      return 'loaded';
    } catch (error) {
      return (error as { code?: string }).code === 'MODULE_NOT_FOUND' ? 'not-installed' : 'failed';
    }
  };
  const node = process.version;
  return {
    node,
    node24: node.startsWith('v24.'),
    platform: `${process.platform}/${process.arch}`,
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    heapSizeLimitMb: Math.round(v8.getHeapStatistics().heap_size_limit / 1048576),
    memory: Object.fromEntries(
      Object.entries(process.memoryUsage()).map(([k, v]) => [k, Math.round(v / 1048576)]),
    ),
    cpus: os.cpus().length,
    totalMemMb: Math.round(os.totalmem() / 1048576),
    modules: { argon2: native('argon2'), sharp: native('sharp') },
  };
}

/** HOST-003 subset: engine contract on scratch tables (SKIP LOCKED, conditional claim, CHECK, generated unique, JSON, lock wait). */
export async function probeEngine(cfg: ProbeConfig) {
  const a = await connect(cfg);
  const b = await connect(cfg);
  const checks: Record<string, boolean | string> = {};
  try {
    await a.query('DROP TABLE IF EXISTS probe_jobs');
    await a.query(
      `CREATE TABLE probe_jobs (
         id INT PRIMARY KEY, status VARCHAR(16) NOT NULL, owner VARCHAR(16) NULL, doc JSON NULL,
         active_key VARCHAR(20) AS (IF(status = 'ACTIVE', 'k', NULL)) PERSISTENT,
         CONSTRAINT chk_probe_status CHECK (status IN ('QUEUED','RUNNING','ACTIVE','DONE')),
         UNIQUE KEY uq_probe_active (active_key), KEY ix_probe_status (status, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci`,
    );
    await a.query(
      "INSERT INTO probe_jobs (id, status) VALUES (1,'QUEUED'),(2,'QUEUED'),(3,'QUEUED'),(4,'QUEUED')",
    );
    // SKIP LOCKED: two transactions claim disjoint rows.
    await a.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await b.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await a.beginTransaction();
    await b.beginTransaction();
    const ra = (await a.query(
      "SELECT id FROM probe_jobs WHERE status='QUEUED' ORDER BY id LIMIT 2 FOR UPDATE SKIP LOCKED",
    )) as Array<{ id: number }>;
    const rb = (await b.query(
      "SELECT id FROM probe_jobs WHERE status='QUEUED' ORDER BY id LIMIT 2 FOR UPDATE SKIP LOCKED",
    )) as Array<{ id: number }>;
    checks.skipLocked = ra.length === 2 && rb.length === 2 && !ra.some((x) => rb.some((y) => y.id === x.id));
    await a.commit();
    await b.commit();
    // Conditional update claim: only one of two racing UPDATEs wins.
    const u1 = await a.query(
      "UPDATE probe_jobs SET status='RUNNING', owner='a' WHERE id=1 AND status='QUEUED'",
    );
    const u2 = await b.query(
      "UPDATE probe_jobs SET status='RUNNING', owner='b' WHERE id=1 AND status='QUEUED'",
    );
    checks.conditionalClaim =
      (u1 as { affectedRows: number }).affectedRows + (u2 as { affectedRows: number }).affectedRows === 1;
    // CHECK enforced.
    checks.checkConstraint = await a
      .query("INSERT INTO probe_jobs (id, status) VALUES (9, 'BOGUS')")
      .then(() => false)
      .catch((e: { errno?: number }) => e.errno === 4025);
    // Generated-column unique.
    await a.query("UPDATE probe_jobs SET status='ACTIVE' WHERE id=2");
    checks.generatedUnique = await a
      .query("UPDATE probe_jobs SET status='ACTIVE' WHERE id=3")
      .then(() => false)
      .catch((e: { errno?: number }) => e.errno === 1062);
    // JSON round trip.
    await a.query('UPDATE probe_jobs SET doc = ? WHERE id = 4', [JSON.stringify({ n: 'বাংলা', v: 1 })]);
    const doc = await scalar<string>(a, "SELECT JSON_VALUE(doc, '$.n') FROM probe_jobs WHERE id = 4");
    checks.jsonAndBangla = doc === 'বাংলা';
    // Lock wait timeout surfaces as 1205.
    await b.query('SET SESSION innodb_lock_wait_timeout = 1');
    await a.beginTransaction();
    await a.query('SELECT id FROM probe_jobs WHERE id = 4 FOR UPDATE');
    checks.lockWaitTimeout = await b
      .query('UPDATE probe_jobs SET owner = ? WHERE id = 4', ['b'])
      .then(() => false)
      .catch((e: { errno?: number }) => e.errno === 1205);
    await a.rollback();
    // `transaction_isolation` exists from MariaDB 11.1; 10.6 only has `tx_isolation`.
    checks.isolation = String(
      await scalar(a, 'SELECT @@transaction_isolation').catch(() => scalar(a, 'SELECT @@tx_isolation')),
    );
  } finally {
    await a.query('DROP TABLE IF EXISTS probe_jobs').catch(() => undefined);
    await a.end();
    await b.end();
  }
  const pass = Object.entries(checks).every(([k, v]) => k === 'isolation' || v === true);
  return { checks, pass };
}

/** HOST-004: GET_LOCK exclusivity, charset DDL and trigger permission (informational). */
export async function probeLocks(cfg: ProbeConfig) {
  const a = await connect(cfg);
  const b = await connect(cfg);
  try {
    const name = `hmedic:probe:${randomBytes(4).toString('hex')}`;
    const first = Number(await scalar(a, 'SELECT GET_LOCK(?, 0)', [name]));
    const second = Number(await scalar(b, 'SELECT GET_LOCK(?, 0)', [name]));
    await a.query('SELECT RELEASE_LOCK(?)', [name]);
    const alter = await a
      .query('ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci')
      .then(() => 'permitted')
      .catch((e: { code?: string }) => `denied:${e.code ?? 'error'}`);
    await a.query('CREATE TABLE IF NOT EXISTS probe_trigger (id INT PRIMARY KEY) ENGINE=InnoDB');
    const trigger = await a
      .query('CREATE TRIGGER probe_trg BEFORE INSERT ON probe_trigger FOR EACH ROW SET NEW.id = NEW.id')
      .then(() => 'permitted')
      .catch((e: { code?: string }) => `denied:${e.code ?? 'error'}`);
    await a.query('DROP TRIGGER IF EXISTS probe_trg').catch(() => undefined);
    await a.query('DROP TABLE IF EXISTS probe_trigger');
    const getLockExclusive = first === 1 && second === 0;
    return { getLockExclusive, alterDatabase: alter, createTrigger: trigger, pass: getLockExclusive };
  } finally {
    await a.end();
    await b.end();
  }
}

/** HOST-007: persistent private directory (write once, verify after redeploys). */
export async function probeStorage(cfg: ProbeConfig, mode: 'write' | 'verify') {
  const dir = path.join(cfg.storageDir, cfg.appEnv);
  const file = path.join(dir, 'probe.bin');
  const meta = path.join(dir, 'probe.sha256');
  if (mode === 'write') {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const data = randomBytes(1_048_576);
    const sha = createHash('sha256').update(data).digest('hex');
    await writeFile(file, data, { mode: 0o600 });
    await writeFile(meta, sha, { mode: 0o600 });
    return { written: true, sha256: sha, path: file };
  }
  try {
    const [data, expected] = await Promise.all([readFile(file), readFile(meta, 'utf8')]);
    const sha = createHash('sha256').update(data).digest('hex');
    return { exists: true, sha256: sha, matches: sha === expected.trim(), pass: sha === expected.trim() };
  } catch {
    return { exists: false, matches: false, pass: false };
  }
}

/** HOST-009: HTTPS HEAD reachability of allow-listed egress hosts only (no arbitrary URLs: no SSRF). */
export async function probeEgress(cfg: ProbeConfig) {
  const results: Record<string, string> = {};
  for (const target of cfg.egressTargets) {
    const started = Date.now();
    try {
      const res = await fetch(target, {
        method: 'HEAD',
        signal: AbortSignal.timeout(8_000),
        redirect: 'manual',
      });
      results[new URL(target).host] = `HTTP ${res.status} in ${Date.now() - started} ms`;
    } catch (error) {
      results[new URL(target).host] =
        `unreachable (${(error as { cause?: { code?: string } }).cause?.code ?? 'error'})`;
    }
  }
  return { results };
}
