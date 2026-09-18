/** Cursor pagination (API-IMPLEMENTATION.md §1): limit 1–100 (default 20), opaque cursor. */
export interface PageRequest {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 100;

export function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return PAGE_LIMIT_DEFAULT;
  return Math.min(PAGE_LIMIT_MAX, Math.max(1, Math.trunc(limit)));
}

/** Opaque cursor: base64url of a JSON tuple; the server decides its meaning. */
export function encodeCursor(values: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): (string | number)[] | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string' || typeof v === 'number'))
      return null;
    return parsed;
  } catch {
    return null;
  }
}
