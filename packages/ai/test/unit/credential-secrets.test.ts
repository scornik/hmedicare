import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretEnvelope, kekFromBase64 } from '@hmedic/secrets';
import {
  AICredentialSecrets,
  AICredentialSecretError,
  aiCredentialAad,
  type AICredentialSecretScope,
} from '../../src/public';

const key = (id: string) => kekFromBase64(id, randomBytes(32).toString('base64'));
const pepper = 'test-only-ai-fingerprint-pepper-0123456789';
const secret = 'fake_synthetic_credential_0123456789';
const scope: AICredentialSecretScope = {
  credentialId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  doctorProfileId: '00000000-0000-4000-8000-000000000003',
  providerCode: 'mock',
};
const fixture = () => {
  const envelope = new SecretEnvelope({ current: key('ai-test-1') });
  return { envelope, secrets: new AICredentialSecrets(envelope, pepper) };
};

describe('AI credential secret boundary', () => {
  it('seals with a fresh data key and exposes only the last four characters', async () => {
    const { secrets } = fixture();
    const first = secrets.seal(scope, secret);
    const second = secrets.seal(scope, secret);
    expect(first.encryptedSecret).not.toBe(second.encryptedSecret);
    expect(first.wrappedDataKey).not.toBe(second.wrappedDataKey);
    expect(first.secretFingerprint).toBe(second.secretFingerprint);
    expect(first.secretLast4).toBe('6789');
    expect(first.secretFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain(secret);
    expect(await secrets.use(scope, first, async (apiKey) => apiKey === secret)).toBe(true);
  });
  it.each(['credentialId', 'tenantId', 'doctorProfileId', 'providerCode'] as const)(
    'rejects copied ciphertext with another %s',
    async (field) => {
      const { secrets } = fixture();
      const sealed = secrets.seal(scope, secret);
      const changed = {
        ...scope,
        [field]: field === 'providerCode' ? 'other' : '00000000-0000-4000-8000-000000000099',
      };
      await expect(secrets.use(changed, sealed, async () => true)).rejects.toMatchObject({
        code: 'SECRET_UNAVAILABLE',
      });
      expect(() => secrets.rewrap(changed, sealed)).toThrow(AICredentialSecretError);
    },
  );
  it('rejects whitespace, non-ASCII and length violations without leaking input', () => {
    const { secrets } = fixture();
    for (const invalid of [
      '',
      'x'.repeat(15),
      'x'.repeat(513),
      `${secret} `,
      `${secret}\n`,
      `বাংলা${secret}`,
    ]) {
      expect(() => secrets.seal(scope, invalid)).toThrow('AI credential: INVALID_SECRET');
    }
    expect(secrets.seal(scope, 'x'.repeat(16)).secretLast4).toBe('xxxx');
    expect(secrets.seal(scope, 'x'.repeat(512)).secretLast4).toBe('xxxx');
  });
  it('rejects delimiter injection and malformed scope before encryption', () => {
    for (const changed of [
      { ...scope, tenantId: 'tenant|doctor' },
      { ...scope, providerCode: 'mock|other' },
      { ...scope, providerCode: 'x'.repeat(33) },
      { ...scope, credentialId: '' },
      { ...scope, credentialId: `${scope.credentialId}\n` },
      { ...scope, providerCode: 'mock\n' },
    ])
      expect(() => aiCredentialAad(changed)).toThrow('AI credential: INVALID_SCOPE');
  });
  it('requires a separate strong fingerprint pepper and distinguishes secrets', () => {
    const { envelope, secrets } = fixture();
    expect(() => new AICredentialSecrets(envelope, 'short')).toThrow();
    const one = secrets.seal(scope, secret);
    const two = secrets.seal(scope, `${secret}x`);
    const otherPepper = new AICredentialSecrets(envelope, `${pepper}other`).seal(scope, secret);
    expect(one.secretFingerprint).not.toBe(two.secretFingerprint);
    expect(one.secretFingerprint).not.toBe(otherPepper.secretFingerprint);
  });
  it('rotates the wrapped key while preserving ciphertext and display metadata', async () => {
    const previous = key('old-ai-key');
    const current = key('new-ai-key');
    const old = new AICredentialSecrets(new SecretEnvelope({ current: previous }), pepper);
    const sealed = old.seal(scope, secret);
    const rotated = new AICredentialSecrets(new SecretEnvelope({ current, previous }), pepper).rewrap(
      scope,
      sealed,
    );
    expect(rotated.encryptedSecret).toBe(sealed.encryptedSecret);
    expect(rotated.wrappedDataKey).not.toBe(sealed.wrappedDataKey);
    expect(rotated.secretFingerprint).toBe(sealed.secretFingerprint);
    expect(rotated.secretLast4).toBe(sealed.secretLast4);
    expect(rotated.keyId).toBe('new-ai-key');
    const currentOnly = new AICredentialSecrets(new SecretEnvelope({ current }), pepper);
    expect(await currentOnly.use(scope, rotated, async (apiKey) => apiKey === secret)).toBe(true);
    await expect(currentOnly.use(scope, sealed, async () => true)).rejects.toMatchObject({
      code: 'SECRET_UNAVAILABLE',
    });
  });
  it('rejects tombstones and unexpected decrypted bundles before calling the adapter', async () => {
    const { envelope, secrets } = fixture();
    let called = false;
    for (const sealed of [
      { encryptedSecret: 'revoked', wrappedDataKey: 'revoked', keyId: 'revoked' },
      envelope.encrypt({ apiKey: secret, extra: 'not_allowed' }, aiCredentialAad(scope)),
      envelope.encrypt({ apiKey: 'short' }, aiCredentialAad(scope)),
    ]) {
      await expect(
        secrets.use(scope, sealed, async () => {
          called = true;
        }),
      ).rejects.toMatchObject({ code: 'SECRET_UNAVAILABLE' });
    }
    expect(called).toBe(false);
  });
  it('sanitizes unexpected provider exceptions and still permits normalized failure results', async () => {
    const { secrets } = fixture();
    const sealed = secrets.seal(scope, secret);
    await expect(
      secrets.use(scope, sealed, async () => {
        throw new Error(`request failed using ${secret}`);
      }),
    ).rejects.toThrow('AI credential: PROVIDER_OPERATION_FAILED');
    expect(await secrets.use(scope, sealed, async () => ({ ok: false, code: 'RATE_LIMITED' }))).toEqual({
      ok: false,
      code: 'RATE_LIMITED',
    });
  });
});
