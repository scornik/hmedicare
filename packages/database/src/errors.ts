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

/**
 * Prisma reports the offending index in `meta.target`: a string for a named constraint, or the field list
 * when it can only name columns. Reading it avoids depending on message wording, which differs between
 * the driver's raw text and Prisma's own rendering.
 */
function metaTarget(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const meta = (error as { meta?: unknown }).meta;
  if (meta === null || typeof meta !== 'object') return null;
  const target = (meta as { target?: unknown }).target;
  if (typeof target === 'string' && target.length > 0) return target;
  if (Array.isArray(target) && target.every((t) => typeof t === 'string') && target.length > 0) {
    return target.join(',');
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
  // `meta.target` is the structured answer and is preferred; the message patterns cover the driver's raw
  // text ("for key 'uq_x'"), Prisma's own phrasing ("on the constraint: `uq_x`") and CHECK failures.
  const constraint =
    metaTarget(error) ??
    message.match(/for key '(?:[a-z0-9_]+\.)?([a-z0-9_]+)'/i)?.[1] ??
    message.match(/constraint:?\s*`([a-z0-9_]+)`/i)?.[1] ??
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

export function isRetryableLockError(error: unknown): boolean {
  const { kind } = dbErrorInfo(error);
  return kind === 'LOCK_WAIT_TIMEOUT' || kind === 'DEADLOCK';
}
