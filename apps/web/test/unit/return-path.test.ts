import { describe, expect, it } from 'vitest';
import { shortLinkReturn } from '../../src/auth/return-path';
describe('notification login return', () => {
  it('preserves only an exact internal opaque link path', () => {
    expect(shortLinkReturn('/r/' + 'A'.repeat(22))).toBe('/r/' + 'A'.repeat(22));
    for (const value of [
      null,
      {},
      'https://example.invalid',
      '//example.invalid',
      '/r/short',
      '/r/' + 'A'.repeat(22) + '?next=https://example.invalid',
      '/r/' + 'A'.repeat(22) + '/extra',
    ])
      expect(shortLinkReturn(value)).toBe('/select-tenant');
  });
});
