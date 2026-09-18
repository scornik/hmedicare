import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AppError,
  ERROR_CODES,
  decodeCursor,
  encodeCursor,
  findDeniedPayloadKeys,
  isUuid,
  newId,
  normalizeLimit,
  uuidv7Timestamp,
} from '../../src/index';

describe('error codes (API-IMPLEMENTATION.md §4)', () => {
  const doc = readFileSync(
    path.resolve(__dirname, '../../../../docs/implementation/API-IMPLEMENTATION.md'),
    'utf8',
  );
  const section = doc.slice(doc.indexOf('## 4. Canonical error codes'), doc.indexOf('## 5. Versioning'));
  const rows = section
    .split('\n')
    .filter((line) => /^\| \*{0,2}`[A-Z_]+`/.test(line))
    .map((line) => {
      const cells = line.split('|').map((c) => c.trim());
      return { code: (cells[1] ?? '').replace(/[*`]/g, ''), http: cells[2] ?? '' };
    });

  it('documents at least the codes the kernel defines, and vice versa', () => {
    const docCodes = rows.map((r) => r.code).sort();
    expect(Object.keys(ERROR_CODES).sort()).toEqual(docCodes);
  });

  it.each(rows)('$code maps to HTTP $http', ({ code, http }) => {
    const status = ERROR_CODES[code as keyof typeof ERROR_CODES];
    expect(http.split('/').map(Number)).toContain(status);
  });

  it('AppError carries the mapped status', () => {
    const e = new AppError('STALE_VERSION');
    expect(e.status).toBe(409);
    expect(e.code).toBe('STALE_VERSION');
  });
});

describe('ids', () => {
  it('generates time-ordered UUIDv7 strings of 36 chars', () => {
    const a = newId();
    const b = newId();
    expect(a).toHaveLength(36);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe('7');
    expect(uuidv7Timestamp(b)).toBeGreaterThanOrEqual(uuidv7Timestamp(a));
  });

  it('rejects non-UUID strings', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(123)).toBe(false);
  });
});

describe('pagination', () => {
  it('clamps limits to 1..100 with default 20', () => {
    expect(normalizeLimit(undefined)).toBe(20);
    expect(normalizeLimit(0)).toBe(1);
    expect(normalizeLimit(500)).toBe(100);
  });

  it('round-trips opaque cursors and rejects tampered ones', () => {
    expect(decodeCursor(encodeCursor(['2026-09-18T00:00:00.000Z', 'abc']))).toEqual([
      '2026-09-18T00:00:00.000Z',
      'abc',
    ]);
    expect(decodeCursor('%%%')).toBeNull();
    expect(decodeCursor(Buffer.from('{"a":1}').toString('base64url'))).toBeNull();
  });
});

describe('payload deny-list (EVENT-ARCHITECTURE.md §2, ADR-015 §1)', () => {
  it('accepts id/enum-only payloads', () => {
    expect(findDeniedPayloadKeys({ v: 1, userId: 'x', status: 'ACTIVE', reasonCode: 'LOGOUT' })).toEqual([]);
  });

  it('rejects PHI and secret fields at any depth', () => {
    expect(findDeniedPayloadKeys({ phone: '+8801700000001' })).toEqual(['phone']);
    expect(findDeniedPayloadKeys({ a: { otpCode: '123456' } })).toEqual(['a.otpCode']);
    expect(findDeniedPayloadKeys({ apiKey: 'k', displayName: 'n' })).toEqual(['apiKey', 'displayName']);
  });
});
