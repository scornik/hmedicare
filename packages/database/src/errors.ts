/**
 * Engine error mapping (DATABASE-IMPLEMENTATION.md §1.4). Prisma with the MariaDB driver adapter wraps
 * driver errors; the MariaDB error number is found by walking the error, its meta and causes.
 */
export const ER_DUP_ENTRY = 1062;
export const ER_ROW_IS_REFERENCED = 1451;
export const ER_NO_REFERENCED_ROW = 1452;
export const ER_CONSTRAINT_FAILED = 4025;
export const ER_LOCK_WAIT_TIMEOUT = 1205;
export const ER_LOCK_DEADLOCK = 1213;

export type DbErrorKind =
  'UNIQUE_VIOLATION' | 'REFERENCE_VIOLATION' | 'CHECK_VIOLATION' | 'LOCK_WAIT_TIMEOUT' | 'DEADLOCK' | 'OTHER';

export interface DbErrorInfo {
  kind: DbErrorKind;
  errno: number | null;
  /** Constraint or index name when the engine reports one (e.g. `uq_otp_pending`). */
  constraint: string | null;
}

const PRISMA_CODE_ERRNO: Record<string, number> = {
  P2002: ER_DUP_ENTRY,
  P2003: ER_NO_REFERENCED_ROW,
  P2004: ER_CONSTRAINT_FAILED,
  P2034: ER_LOCK_DEADLOCK,
};

function findErrno(value: unknown, depth = 0): number | null {
  if (value === null || typeof value !== 'object' || depth > 6) return null;
  const o = value as Record<string, unknown>;
  for (const key of ['errno', 'originalCode', 'code']) {
    const v = o[key];
    if (typeof v === 'number' && v > 1000) return v;
    if (typeof v === 'string' && /^\d{4}$/.test(v)) return Number(v);
  }
  for (const key of ['cause', 'meta', 'driverAdapterError', 'error']) {
    const found = findErrno(o[key], depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function findMessage(value: unknown, depth = 0): string {
  if (value === null || typeof value !== 'object' || depth > 6) return '';
  const o = value as Record<string, unknown>;
  let out = typeof o.message === 'string' ? o.message : '';
  if (typeof o.originalMessage === 'string') out += ` ${o.originalMessage}`;
  for (const key of ['cause', 'meta', 'driverAdapterError']) out += ` ${findMessage(o[key], depth + 1)}`;
  return out;
}

export function dbErrorInfo(error: unknown): DbErrorInfo {
  let errno = findErrno(error);
  if (errno === null && error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && PRISMA_CODE_ERRNO[code]) errno = PRISMA_CODE_ERRNO[code] ?? null;
  }
  const message = findMessage(error);
  if (errno === null) {
    // Fallback: the driver's message text.
    if (/Duplicate entry/i.test(message)) errno = ER_DUP_ENTRY;
    else if (/Lock wait timeout/i.test(message)) errno = ER_LOCK_WAIT_TIMEOUT;
    else if (/Deadlock found/i.test(message)) errno = ER_LOCK_DEADLOCK;
    else if (/CONSTRAINT `[^`]+` failed/i.test(message)) errno = ER_CONSTRAINT_FAILED;
    else if (/foreign key constraint fails/i.test(message)) errno = ER_NO_REFERENCED_ROW;
  }
  const constraint =
    message.match(/for key '(?:[a-z0-9_]+\.)?([a-z0-9_]+)'/i)?.[1] ??
    message.match(/CONSTRAINT `([a-z0-9_]+)`/i)?.[1] ??
    null;
  let kind: DbErrorKind = 'OTHER';
  if (errno === ER_DUP_ENTRY) kind = 'UNIQUE_VIOLATION';
  else if (errno === ER_NO_REFERENCED_ROW || errno === ER_ROW_IS_REFERENCED) kind = 'REFERENCE_VIOLATION';
  else if (errno === ER_CONSTRAINT_FAILED) kind = 'CHECK_VIOLATION';
  else if (errno === ER_LOCK_WAIT_TIMEOUT) kind = 'LOCK_WAIT_TIMEOUT';
  else if (errno === ER_LOCK_DEADLOCK) kind = 'DEADLOCK';
  return { kind, errno, constraint };
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const info = dbErrorInfo(error);
  return info.kind === 'UNIQUE_VIOLATION' && (constraint === undefined || info.constraint === constraint);
}

/**
 * Prisma kills an interactive transaction that outlives its own `timeout` (P2028), which is what happens
 * when a transaction spends its budget queued behind a hot row lock. It is the same contention as a 1205
 * lock-wait timeout — the engine simply ran out of patience first — so it retries and exhausts the same way
 * (QUEUE-CONCURRENCY-DESIGN §1). Without this, a busy chamber day surfaces a raw Prisma error instead of the
 * documented retryable 503.
 */
export function isTransactionTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2028'
  );
}

export function isRetryableLockError(error: unknown): boolean {
  const { kind } = dbErrorInfo(error);
  return kind === 'LOCK_WAIT_TIMEOUT' || kind === 'DEADLOCK' || isTransactionTimeout(error);
}
