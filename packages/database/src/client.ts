import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from './generated/prisma/client';

export { Prisma, PrismaClient } from './generated/prisma/client';

export interface DatabaseOptions {
  /** mariadb://user:pass@host:port/db (mysql:// accepted). */
  url: string;
  poolMax?: number;
  minIdle?: number;
  connectTimeoutMs?: number;
  acquireTimeoutMs?: number;
  lockWaitTimeoutSeconds?: number;
}

export interface ConnectionParts {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function parseDatabaseUrl(url: string): ConnectionParts {
  const u = new URL(url.replace(/^mysql:/, 'mariadb:'));
  if (u.protocol !== 'mariadb:') throw new Error('DATABASE_URL must use mariadb:// or mysql://');
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

/** Prisma CLI needs the mysql:// scheme. */
export function toPrismaCliUrl(url: string): string {
  return url.replace(/^mariadb:/, 'mysql:');
}

/**
 * Session settings applied to every pooled connection (ADR-014): UTC, strict mode, bounded lock waits,
 * READ COMMITTED default isolation for short transactions.
 */
export function sessionInitSql(lockWaitTimeoutSeconds = 5): string[] {
  return [
    "SET time_zone = '+00:00'",
    "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
    `SET SESSION innodb_lock_wait_timeout = ${Math.trunc(lockWaitTimeoutSeconds)}`,
  ];
}

export interface Database {
  prisma: PrismaClient;
  options: DatabaseOptions;
  close(): Promise<void>;
}

export function createDatabase(options: DatabaseOptions): Database {
  const parts = parseDatabaseUrl(options.url);
  const adapter = new PrismaMariaDb({
    ...parts,
    connectionLimit: options.poolMax ?? 10,
    minimumIdle: options.minIdle ?? 1,
    connectTimeout: options.connectTimeoutMs ?? 10_000,
    acquireTimeout: options.acquireTimeoutMs ?? 5_000,
    timezone: '+00:00',
    initSql: sessionInitSql(options.lockWaitTimeoutSeconds),
    bigIntAsNumber: false,
    insertIdAsNumber: true,
  });
  const prisma = new PrismaClient({ adapter });
  return {
    prisma,
    options,
    close: () => prisma.$disconnect(),
  };
}
