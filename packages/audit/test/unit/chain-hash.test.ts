import { describe, expect, it } from 'vitest';
import {
  AuditMetadataError,
  GENESIS_HASH,
  auditChainKey,
  auditCheckpointKey,
  canonicalJson,
  computeRowHash,
  sanitizeAuditMetadata,
} from '../../src/public/index';

describe('canonicalJson', () => {
  it('sorts keys at every level and normalizes dates, bigints and undefined', () => {
    const a = canonicalJson({ b: 1, a: { d: new Date(Date.UTC(2026, 8, 18)), c: 2n }, u: undefined });
    expect(a).toBe('{"a":{"c":"2","d":"2026-09-18T00:00:00.000Z"},"b":1}');
    expect(canonicalJson({ a: { c: 2n, d: new Date(Date.UTC(2026, 8, 18)) }, b: 1 })).toBe(a);
  });
});

describe('computeRowHash', () => {
  it('chains from genesis and changes with any field or the previous hash', () => {
    const h1 = computeRowHash(null, { a: 1 });
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(computeRowHash(GENESIS_HASH, { a: 1 })).toBe(h1);
    expect(computeRowHash(null, { a: 2 })).not.toBe(h1);
    expect(computeRowHash(h1, { a: 1 })).not.toBe(h1);
  });
});

describe('chain keys', () => {
  it('maps tenants and platform', () => {
    expect(auditChainKey(null)).toBe('platform');
    expect(auditCheckpointKey(auditChainKey('t1'))).toBe('audit:tenant:t1');
  });
});

describe('sanitizeAuditMetadata (T5/T22)', () => {
  it('removes secret keys and redacts PHI-like values', () => {
    const clean = sanitizeAuditMetadata({
      credentialId: '0198a3b2-7c3e-7000-8000-000000000001',
      apiKey: 'zit_fake_0123456789abcdef0123456789abcdef',
      note: 'call +8801700000001',
    });
    const text = JSON.stringify(clean);
    expect(text).not.toContain('zit_fake_');
    expect(text).not.toContain('8801700000001');
    expect(clean.credentialId).toBe('0198a3b2-7c3e-7000-8000-000000000001');
  });
  it('rejects nested objects, bad keys and oversized metadata', () => {
    expect(() => sanitizeAuditMetadata({ nested: { a: 1 } } as never)).toThrow(AuditMetadataError);
    expect(() => sanitizeAuditMetadata({ 'bad key': 1 })).toThrow(AuditMetadataError);
    expect(() => sanitizeAuditMetadata({ big: 'x'.repeat(5000) })).toThrow(AuditMetadataError);
  });
});
