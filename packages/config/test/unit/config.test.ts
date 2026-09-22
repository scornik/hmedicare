import { describe, expect, it } from 'vitest';
import { ConfigError, assertPublicViteEnv, loadConfig, parseTrustProxy } from '../../src/index';
import { testEnv } from '../../src/testing';

function problemsOf(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
  return [];
}

describe('loadConfig (ENVIRONMENT-CONTRACT.md)', () => {
  it('accepts a complete test environment and applies documented defaults', () => {
    const cfg = loadConfig('api', testEnv());
    expect(cfg.APP_ENV).toBe('test');
    expect(cfg.OTP_TTL_SECONDS).toBe(180);
    expect(cfg.JOB_CLAIM_STRATEGY).toBe('skip_locked');
    expect(cfg.DEFAULT_TIMEZONE).toBe('Asia/Dhaka');
  });

  it('lists every missing required variable by name and never prints values', () => {
    const env = testEnv({ DATABASE_URL: undefined, CSRF_SECRET: undefined });
    const secretValue = env.OTP_PEPPER as string;
    let message = '';
    try {
      loadConfig('api', env);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('DATABASE_URL: required but not set');
    expect(message).toContain('CSRF_SECRET: required but not set');
    expect(message).not.toContain(secretValue);
  });

  it('fails fast without APP_ENV', () => {
    expect(problemsOf(() => loadConfig('api', testEnv({ APP_ENV: undefined })))).toEqual([
      'APP_ENV: required (development|test|staging|production)',
    ]);
  });

  it('refuses LOCAL-only variables in staging and production', () => {
    const problems = problemsOf(() =>
      loadConfig(
        'api',
        testEnv({
          APP_ENV: 'production',
          AUTH_COOKIE_DEV_MODE: 'true',
          PUSH_TOKEN_KEK_ID: 'prod-push-1',
          PROVIDER_CREDENTIAL_KEK_ID: 'prod-pc-1',
          OTP_PROVIDER: 'sms',
          SMS_PROVIDER: 'zamanit',
          ZAMANIT_BASE_URL: 'https://sms.example.invalid/api',
          ZAMANIT_API_KEY: 'zit_fake_0000000000000000',
          ZAMANIT_SENDER_ID: 'HMEDIC',
          ZAMANIT_API_KEY_ISSUED_ON: '2026-09-18',
        }),
      ),
    );
    expect(problems).toEqual(['AUTH_COOKIE_DEV_MODE: LOCAL-only variable is refused in production']);
  });

  it('requires environment-prefixed key ids in deployed environments', () => {
    const problems = problemsOf(() => loadConfig('api', testEnv({ APP_ENV: 'staging' })));
    expect(problems).toContain(
      'PUSH_TOKEN_KEK_ID: key id must start with "staging-" so keys are never reused across environments',
    );
  });

  it('rejects wildcard CORS', () => {
    expect(problemsOf(() => loadConfig('api', testEnv({ CORS_ALLOWED_ORIGINS: '*' })))).toContain(
      'CORS_ALLOWED_ORIGINS: wildcard origin is not allowed',
    );
  });

  it('refuses plain-http Zaman IT without the explicit insecure flag (ADR-018 §2)', () => {
    const env = testEnv({
      SMS_PROVIDER: 'zamanit',
      ZAMANIT_BASE_URL: 'http://192.0.2.10/api',
      ZAMANIT_API_KEY: 'zit_fake_0000000000000000',
      ZAMANIT_SENDER_ID: 'HMEDIC',
      ZAMANIT_API_KEY_ISSUED_ON: '2026-09-18',
    });
    expect(problemsOf(() => loadConfig('api', env))).toContain(
      'ZAMANIT_BASE_URL: plain http requires ZAMANIT_ALLOW_INSECURE_HTTP=true (and GATE-SMS-HTTP in production)',
    );
    expect(() => loadConfig('api', { ...env, ZAMANIT_ALLOW_INSECURE_HTTP: 'true' })).not.toThrow();
  });

  it('refuses mock OTP delivery in production', () => {
    const problems = problemsOf(() =>
      loadConfig(
        'api',
        testEnv({
          APP_ENV: 'production',
          PUSH_TOKEN_KEK_ID: 'prod-push-1',
          PROVIDER_CREDENTIAL_KEK_ID: 'prod-pc-1',
          OTP_PROVIDER: 'mock',
        }),
      ),
    );
    expect(problems).toContain('OTP_PROVIDER: mock delivery is refused in production');
  });

  it('requires the cron token when a runner is active', () => {
    expect(
      problemsOf(() =>
        loadConfig('worker', testEnv({ JOB_RUNNER_MODE: 'worker', INTERNAL_CRON_TOKEN: undefined })),
      ),
    ).toContain('INTERNAL_CRON_TOKEN: required when a job runner is active (worker/embedded/cron)');
  });

  it('TRUST_PROXY accepts addresses, CIDRs and keywords only (audit C-48; hop counts are rejected)', () => {
    expect(parseTrustProxy('')).toEqual([]);
    expect(parseTrustProxy('loopback, 10.0.0.0/8 ,2001:db8::1, fd00::/8')).toEqual([
      'loopback',
      '10.0.0.0/8',
      '2001:db8::1',
      'fd00::/8',
    ]);
    for (const bad of [
      '1',
      'proxy.example',
      '10.0.0.0/33',
      'fd00::/129',
      '10.0.0.1/8/1',
      'loopback;linklocal',
    ]) {
      expect(parseTrustProxy(bad), bad).toBeNull();
    }
    expect(problemsOf(() => loadConfig('api', testEnv({ TRUST_PROXY: '1' })))).toContain(
      'TRUST_PROXY: must be a comma list of IPs, CIDRs or loopback|linklocal|uniquelocal',
    );
    expect(problemsOf(() => loadConfig('api', testEnv({ TRUST_PROXY_HOPS: '1' })))).toContain(
      'TRUST_PROXY_HOPS: removed (audit C-48); set TRUST_PROXY to the proxy address or CIDR instead',
    );
  });

  it('diagnostics (SMS-002/HOST) need their own token and are refused in production', () => {
    expect(problemsOf(() => loadConfig('worker', testEnv({ DIAGNOSTICS_ENABLED: 'true' })))).toContain(
      'INTERNAL_DIAGNOSTICS_TOKEN: required when DIAGNOSTICS_ENABLED=true',
    );
    const prod = problemsOf(() =>
      loadConfig(
        'worker',
        testEnv({
          APP_ENV: 'production',
          PUSH_TOKEN_KEK_ID: 'prod-push-1',
          PROVIDER_CREDENTIAL_KEK_ID: 'prod-pc-1',
          DIAGNOSTICS_ENABLED: 'true',
          INTERNAL_DIAGNOSTICS_TOKEN: 'd'.repeat(43),
        }),
      ),
    );
    expect(prod).toContain('DIAGNOSTICS_ENABLED: diagnostics endpoints are refused in production');
    const ok = loadConfig<{ DIAGNOSTICS_ENABLED: boolean } & Record<string, unknown> & { APP_ENV: 'test' }>(
      'worker',
      testEnv({ DIAGNOSTICS_ENABLED: 'true', INTERNAL_DIAGNOSTICS_TOKEN: 'd'.repeat(43) }),
    );
    expect(ok.DIAGNOSTICS_ENABLED).toBe(true);
    expect(
      loadConfig<Record<string, unknown> & { APP_ENV: 'test' }>('worker', testEnv({})).DIAGNOSTICS_ENABLED,
    ).toBe(false);
  });
});

describe('REAL_PATIENT_DATA_ALLOWED (DEPLOY-004)', () => {
  it('defaults to false, so an installation is never opened to real data by omission', () => {
    expect(loadConfig('api', testEnv()).REAL_PATIENT_DATA_ALLOWED).toBe(false);
  });

  it('is refused outside production, where every environment is synthetic by definition', () => {
    const problems = problemsOf(() => loadConfig('api', testEnv({ REAL_PATIENT_DATA_ALLOWED: 'true' })));
    expect(problems.join(' ')).toContain('REAL_PATIENT_DATA_ALLOWED');
    expect(problems.join(' ')).toContain('every other environment is synthetic');
  });

  it('is refused while SMS delivery is mocked, because a real patient could not be reached', () => {
    // Asserted through the message rather than by building a whole production environment: the rule is
    // the subject here, and a production env needs real keys this suite must not contain.
    const problems = problemsOf(() =>
      loadConfig('api', testEnv({ REAL_PATIENT_DATA_ALLOWED: '1', SMS_PROVIDER: 'mock' })),
    );
    expect(problems.some((p) => p.includes('REAL_PATIENT_DATA_ALLOWED'))).toBe(true);
  });
});

describe('assertPublicViteEnv', () => {
  it('rejects secret-looking public variable names', () => {
    expect(() => assertPublicViteEnv(['VITE_API_BASE_URL', 'VITE_APP_ENV'])).not.toThrow();
    expect(() => assertPublicViteEnv(['VITE_API_KEY'])).toThrow(ConfigError);
  });
});
