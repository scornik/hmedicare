import type { PrismaClient } from '../client';
import type { Tx } from '../tx';

/** Engine facts used by readiness, host probes and engine-contract tests (HOSTING-VERIFICATION.md §3). */
export interface EngineInfo {
  version: string;
  isMariaDb: boolean;
  majorMinor: string;
  characterSetServer: string;
  collationServer: string;
  timeZone: string;
  maxConnections: number;
  maxUserConnections: number;
  maxAllowedPacket: number;
  lockWaitTimeout: number;
}

export async function engineInfo(prisma: PrismaClient | Tx): Promise<EngineInfo> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT VERSION() AS version, @@character_set_server AS cs, @@collation_server AS coll, @@session.time_zone AS tz,
            @@max_connections AS maxc, @@max_user_connections AS maxu, @@max_allowed_packet AS pkt,
            @@session.innodb_lock_wait_timeout AS lwt`,
  );
  const r = rows[0] ?? {};
  const version = String(r.version ?? '');
  return {
    version,
    isMariaDb: /mariadb/i.test(version),
    majorMinor: version.split('.').slice(0, 2).join('.'),
    characterSetServer: String(r.cs ?? ''),
    collationServer: String(r.coll ?? ''),
    timeZone: String(r.tz ?? ''),
    maxConnections: Number(r.maxc ?? 0),
    maxUserConnections: Number(r.maxu ?? 0),
    maxAllowedPacket: Number(r.pkt ?? 0),
    lockWaitTimeout: Number(r.lwt ?? 0),
  };
}

/** EXPLAIN output rows (used to prove claim queries avoid filesort). */
export async function explain(prisma: PrismaClient | Tx, sql: string, ...params: unknown[]) {
  return prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`EXPLAIN ${sql}`, ...params);
}

/** Readiness ping with a hard deadline. */
export async function ping(prisma: PrismaClient, timeoutMs = 500): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const query = prisma.$queryRawUnsafe('SELECT 1').then(() => true as const);
    return await Promise.race([query, timeout]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
