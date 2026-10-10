import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type ServerConfig } from '../../src/index';
import { testEnv } from '../../src/testing';

const aiEnv = () => ({
  AI_CREDENTIAL_KEK: randomBytes(32).toString('base64'),
  AI_CREDENTIAL_KEK_ID: 'test-ai-1',
  AI_CREDENTIAL_FINGERPRINT_PEPPER: randomBytes(32).toString('base64'),
  AI_ENABLED_PROVIDER_CODES: 'mock',
});
const config = (overrides: Record<string, string | undefined> = {}) =>
  loadConfig<ServerConfig>('api', testEnv(overrides));

describe('AI runtime configuration', () => {
  it('keeps AI unconfigured and opt-ins off by default', () => {
    const cfg = config();
    expect(cfg.AI_ENABLED_PROVIDER_CODES).toEqual([]);
    expect(cfg.AI_CREDENTIAL_KEK).toBeUndefined();
    expect(cfg.AI_FREE_TIER_ALLOWED_DEFAULT).toBe(false);
    expect(cfg.AI_PLATFORM_MANAGED_ENABLED).toBe(false);
    expect(cfg.AI_TRANSCRIPTION_ENABLED).toBe(false);
  });
  it('requires a complete AI encryption configuration when providers are listed', () => {
    expect(() => config({ AI_ENABLED_PROVIDER_CODES: 'mock' })).toThrow(ConfigError);
    expect(config(aiEnv()).AI_ENABLED_PROVIDER_CODES).toEqual(['mock']);
    expect(() => config({ ...aiEnv(), AI_CREDENTIAL_FINGERPRINT_PEPPER: undefined })).toThrow();
  });
  it.each(['short', 'x'.repeat(44), randomBytes(31).toString('base64'), randomBytes(33).toString('base64')])(
    'rejects malformed encryption key without displaying it',
    (invalid) => {
      try {
        config({ ...aiEnv(), AI_CREDENTIAL_KEK: invalid });
        throw new Error('invalid key was accepted');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as Error).message).not.toContain(invalid);
      }
    },
  );
  it('rejects reused provider/push encryption keys and fingerprints', () => {
    const env = testEnv(aiEnv());
    expect(() => loadConfig('api', { ...env, AI_CREDENTIAL_KEK: env.PROVIDER_CREDENTIAL_KEK })).toThrow();
    expect(() => loadConfig('worker', { ...env, AI_CREDENTIAL_KEK: env.PUSH_TOKEN_KEK })).toThrow();
    expect(() =>
      loadConfig('api', {
        ...env,
        AI_CREDENTIAL_FINGERPRINT_PEPPER: env.PROVIDER_CREDENTIAL_FINGERPRINT_PEPPER,
      }),
    ).toThrow();
  });
  it('requires distinct complete rotation pairs', () => {
    const current = aiEnv();
    expect(() =>
      config({ ...current, AI_CREDENTIAL_KEK_PREVIOUS: randomBytes(32).toString('base64') }),
    ).toThrow();
    expect(() =>
      config({
        ...current,
        AI_CREDENTIAL_KEK_PREVIOUS: current.AI_CREDENTIAL_KEK,
        AI_CREDENTIAL_KEK_PREVIOUS_ID: 'test-ai-0',
      }),
    ).toThrow();
    expect(() =>
      config({
        ...current,
        AI_CREDENTIAL_KEK_PREVIOUS: randomBytes(32).toString('base64'),
        AI_CREDENTIAL_KEK_PREVIOUS_ID: current.AI_CREDENTIAL_KEK_ID,
      }),
    ).toThrow();
    expect(
      config({
        ...current,
        AI_CREDENTIAL_KEK_PREVIOUS: randomBytes(32).toString('base64'),
        AI_CREDENTIAL_KEK_PREVIOUS_ID: 'test-ai-0',
      }).AI_CREDENTIAL_KEK_PREVIOUS_ID,
    ).toBe('test-ai-0');
  });
  it('rejects duplicate or malformed provider codes', () => {
    for (const codes of ['mock,mock', 'mock|other', 'Gemini', 'x'.repeat(33)])
      expect(() => config({ ...aiEnv(), AI_ENABLED_PROVIDER_CODES: codes })).toThrow();
  });
  it('blocks mock configuration in production without requiring AI on existing deployments', () => {
    const env = testEnv({
      APP_ENV: 'production',
      OTP_PROVIDER: 'sms',
      SMS_PROVIDER: 'zamanit',
      ZAMANIT_BASE_URL: 'https://sms.example.invalid/api',
      ZAMANIT_API_KEY: 'zit_fake_0000000000000000',
      ZAMANIT_SENDER_ID: 'HMEDIC',
      ZAMANIT_API_KEY_ISSUED_ON: '2026-10-11',
      CORS_ALLOWED_ORIGINS: '',
      PUSH_TOKEN_KEK_ID: 'prod-push-1',
      PROVIDER_CREDENTIAL_KEK_ID: 'prod-provider-1',
    });
    expect(() => loadConfig('api', env)).not.toThrow();
    expect(() => loadConfig('api', { ...env, ...aiEnv(), AI_CREDENTIAL_KEK_ID: 'prod-ai-1' })).toThrow(
      'mock is refused',
    );
  });
});
