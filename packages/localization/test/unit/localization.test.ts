import { describe, expect, it } from 'vitest';
import {
  addDays,
  dhakaDate,
  dhakaDayRange,
  formatDhakaDateTime,
  isBdMobileE164,
  maskPhone,
  normalizeBdMobile,
  resolveLocale,
  startOfDhakaDay,
  toBanglaDigits,
  toLatinDigits,
} from '../../src/index';

// Synthetic numbers only (+8801700000000–999, SEED-DATA.md).
describe('normalizeBdMobile', () => {
  it.each([
    ['01700000001', '+8801700000001'],
    ['+8801700000001', '+8801700000001'],
    ['8801700000001', '+8801700000001'],
    ['008801700000001', '+8801700000001'],
    ['017-0000 0001', '+8801700000001'],
    ['(+880) 1700-000001', '+8801700000001'],
    [toBanglaDigits('01700000001'), '+8801700000001'],
    ['+880 1700000099', '+8801700000099'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeBdMobile(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['0170000000'], // too short
    ['017000000011'], // too long
    ['01200000001'], // 012 is not a mobile prefix
    ['0270000001'], // Dhaka landline
    ['+911700000001'], // India
    ['+14155550100'], // US
    ['01700abc001'],
    ['javascript:alert(1)'],
    ['1'.repeat(40)],
  ])('rejects %s', (input) => {
    expect(normalizeBdMobile(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(normalizeBdMobile(undefined)).toBeNull();
    expect(normalizeBdMobile(null)).toBeNull();
  });

  it('validates canonical E.164 and masks for display', () => {
    expect(isBdMobileE164('+8801700000001')).toBe(true);
    expect(isBdMobileE164('01700000001')).toBe(false);
    expect(maskPhone('+8801700000045')).toBe('+8801*******45');
  });
});

describe('digits', () => {
  it('round-trips Bangla and ASCII digits', () => {
    expect(toBanglaDigits('2026-09-18')).not.toMatch(/[0-9]/);
    expect(toLatinDigits(toBanglaDigits('0123456789'))).toBe('0123456789');
    expect(toLatinDigits('abc')).toBe('abc');
  });
});

describe('resolveLocale', () => {
  it.each([
    [undefined, 'bn-BD'],
    ['en-BD', 'en-BD'],
    ['bn-BD', 'bn-BD'],
    ['en-US,en;q=0.9', 'en-BD'],
    ['fr-FR, en;q=0.5', 'en-BD'],
    ['en;q=0.4, bn;q=0.8', 'bn-BD'],
    ['de', 'bn-BD'],
  ])('%s → %s', (input, expected) => {
    expect(resolveLocale(input)).toBe(expected);
  });
});

describe('Dhaka time (UTC+06:00)', () => {
  it('maps the UTC 18:00 boundary to the next Dhaka date', () => {
    expect(dhakaDate(new Date('2026-09-18T17:59:59.999Z'))).toBe('2026-09-18');
    expect(dhakaDate(new Date('2026-09-18T18:00:00.000Z'))).toBe('2026-09-19');
  });
  it('computes day starts and half-open ranges', () => {
    expect(startOfDhakaDay('2026-09-19').toISOString()).toBe('2026-09-18T18:00:00.000Z');
    const r = dhakaDayRange('2026-12-31');
    expect([r.start.toISOString(), r.end.toISOString()]).toEqual([
      '2026-12-30T18:00:00.000Z',
      '2026-12-31T18:00:00.000Z',
    ]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('rejects invalid dates', () => {
    expect(() => startOfDhakaDay('2026-02-30')).toThrow(RangeError);
    expect(() => startOfDhakaDay('18/09/2026')).toThrow(RangeError);
  });
  it('formats in bn-BD with Bangla digits and en-BD with ASCII digits', () => {
    const at = new Date('2026-09-18T04:30:00.000Z');
    expect(formatDhakaDateTime(at, 'bn-BD')).toMatch(/[০-৯]/);
    expect(formatDhakaDateTime(at, 'en-BD')).toMatch(/10:30/);
  });
});
