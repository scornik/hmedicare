import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SecretEnvelope,
  SecretEnvelopeError,
  kekFromBase64,
  last4,
  secretFingerprint,
} from '../../src/index';

const kek = (id: string) => kekFromBase64(id, randomBytes(32).toString('base64'));
const bundle = { apiKey: 'zit_fake_0123456789abcdef0123456789abcdef' };

describe('SecretEnvelope (AES-256-GCM, T14 pattern)', () => {
  it('round-trips and never stores the plaintext', () => {
    const env = new SecretEnvelope({ current: kek('test-pc-1') });
    const sealed = env.encrypt(bundle, 'c1|t1|SMS|zamanit');
    expect(JSON.stringify(sealed)).not.toContain('zit_fake_');
    expect(sealed.keyId).toBe('test-pc-1');
    expect(env.decrypt(sealed, 'c1|t1|SMS|zamanit')).toEqual(bundle);
  });

  it('binds ciphertext to its AAD (credential, tenant, provider)', () => {
    const env = new SecretEnvelope({ current: kek('test-pc-1') });
    const sealed = env.encrypt(bundle, 'c1|t1|SMS|zamanit');
    for (const aad of ['c2|t1|SMS|zamanit', 'c1|t2|SMS|zamanit', 'c1|t1|PAYMENT|aamarpay']) {
      expect(() => env.decrypt(sealed, aad)).toThrow(SecretEnvelopeError);
    }
  });

  it('detects tampering and unknown keys', () => {
    const env = new SecretEnvelope({ current: kek('test-pc-1') });
    const sealed = env.encrypt(bundle, 'aad');
    const [iv, ct, tag] = sealed.encryptedSecret.split('.');
    const flipped = Buffer.from(ct!, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() =>
      env.decrypt({ ...sealed, encryptedSecret: `${iv}.${flipped.toString('base64')}.${tag}` }, 'aad'),
    ).toThrow(SecretEnvelopeError);
    expect(() => env.decrypt({ ...sealed, keyId: 'other' }, 'aad')).toThrow(/UNKNOWN_KEY/);
    expect(() => env.decrypt({ ...sealed, encryptedSecret: 'garbage' }, 'aad')).toThrow(/MALFORMED/);
  });

  it('rotates KEKs: previous key decrypts, rewrap moves to the current key', () => {
    const oldKek = kek('test-pc-1');
    const sealed = new SecretEnvelope({ current: oldKek }).encrypt(bundle, 'aad');
    const rotated = new SecretEnvelope({ current: kek('test-pc-2'), previous: oldKek });
    expect(rotated.decrypt(sealed, 'aad')).toEqual(bundle);
    const rewrapped = rotated.rewrap(sealed, 'aad');
    expect(rewrapped.keyId).toBe('test-pc-2');
    expect(rewrapped.encryptedSecret).toBe(sealed.encryptedSecret);
    const onlyNew = new SecretEnvelope({
      current: {
        id: 'test-pc-2',
        key: (rotated as unknown as { ring: { current: { key: Buffer } } }).ring.current.key,
      },
    });
    expect(onlyNew.decrypt(rewrapped, 'aad')).toEqual(bundle);
    expect(() => onlyNew.decrypt(sealed, 'aad')).toThrow(/UNKNOWN_KEY/);
  });

  it('requires 32-byte KEKs and produces stable fingerprints without revealing the secret', () => {
    expect(() => kekFromBase64('x', Buffer.alloc(16).toString('base64'))).toThrow(/32 random bytes/);
    const f1 = secretFingerprint('pepper', { b: '2', a: '1' });
    expect(f1).toBe(secretFingerprint('pepper', { a: '1', b: '2' }));
    expect(f1).not.toBe(secretFingerprint('other', { a: '1', b: '2' }));
    expect(last4('zit_fake_abcd1234')).toBe('1234');
  });
});
