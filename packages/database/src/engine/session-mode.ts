import type { PrismaClient } from '@prisma/client';

/**
 * Proof that ADR-014's per-connection session init actually took effect (Stage 6 DEPLOY-003).
 *
 * HOST-001 found the deployed server's global `sql_mode` is `NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION`
 * — not strict. Nothing about the server enforces strictness, so `sessionInitSql` is the only thing
 * standing between a too-long string or an out-of-range number and a silent truncation. That was a
 * tolerable risk while the tables held appointments; from Stage 6 they hold clinical records, where a
 * silently truncated examination note is a patient-safety problem rather than a bug.
 *
 * So the guarantee is checked rather than assumed, on a real connection, at readiness.
 */
export const REQUIRED_SQL_MODES = ['STRICT_TRANS_TABLES', 'ERROR_FOR_DIVISION_BY_ZERO'] as const;

export interface SessionModeReport {
  ok: boolean;
  sqlMode: string;
  timeZone: string;
  /** The required modes this connection is missing; empty when `ok`. */
  missing: string[];
}

/**
 * Reads the session settings of whichever pooled connection serves this query. A pool hands out any
 * free connection, so repeated calls sample different ones; the integration suite drives that
 * deliberately, including across a forced reconnect.
 */
export async function readSessionMode(prisma: PrismaClient): Promise<SessionModeReport> {
  const rows = await prisma.$queryRawUnsafe<Array<{ sql_mode: string; time_zone: string }>>(
    'SELECT @@session.sql_mode AS sql_mode, @@session.time_zone AS time_zone',
  );
  const sqlMode = rows[0]?.sql_mode ?? '';
  const timeZone = rows[0]?.time_zone ?? '';
  const present = new Set(sqlMode.split(',').map((m) => m.trim()));
  const missing: string[] = REQUIRED_SQL_MODES.filter((m) => !present.has(m));
  // `+00:00` is the other half of ADR-014: every timestamp we write is UTC, and a connection that
  // negotiated a local zone would shift them silently.
  if (timeZone !== '+00:00') missing.push(`time_zone=${timeZone || 'unset'}`);
  return { ok: missing.length === 0, sqlMode, timeZone, missing };
}

/** Throws when the connection is not in the mode ADR-014 requires. For startup and for tests. */
export async function assertStrictSession(prisma: PrismaClient): Promise<SessionModeReport> {
  const report = await readSessionMode(prisma);
  if (!report.ok) {
    throw new Error(
      `session is not in the mode ADR-014 requires (missing: ${report.missing.join(', ')}). ` +
        'The server default is not strict, so this means the per-connection init did not run.',
    );
  }
  return report;
}
