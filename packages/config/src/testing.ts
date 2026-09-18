import { generateKeyPairSync, randomBytes } from 'node:crypto';

/**
 * Builds a complete, synthetic environment for tests and local tooling. Every secret is freshly generated
 * per call and never written to disk.
 */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64');
}

export function generateJwtKeys(kid = 'test-jwt-1'): {
  JWT_SIGNING_KEY_ID: string;
  JWT_SIGNING_PRIVATE_KEY: string;
  JWT_VERIFICATION_KEYS: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const priv = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const pub = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  return {
    JWT_SIGNING_KEY_ID: kid,
    JWT_SIGNING_PRIVATE_KEY: priv,
    JWT_VERIFICATION_KEYS: JSON.stringify({ [kid]: pub }),
  };
}

export function testEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const base: Record<string, string> = {
    APP_ENV: 'test',
    PORT: '3000',
    LOG_HASH_PEPPER: generateSecret(),
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'mariadb://hmedic_app:unused@127.0.0.1:3306/hmedic_test',
    JOB_RUNNER_MODE: 'off',
    INTERNAL_METRICS_TOKEN: generateSecret(),
    INTERNAL_CRON_TOKEN: generateSecret(),
    ...generateJwtKeys(),
    REFRESH_TOKEN_PEPPER: generateSecret(),
    OTP_PEPPER: generateSecret(),
    RATE_LIMIT_PEPPER: generateSecret(),
    CSRF_SECRET: generateSecret(),
    PUSH_TOKEN_KEK: generateSecret(),
    PUSH_TOKEN_KEK_ID: 'test-push-1',
    PROVIDER_CREDENTIAL_KEK: generateSecret(),
    PROVIDER_CREDENTIAL_KEK_ID: 'test-pc-1',
    PROVIDER_CREDENTIAL_FINGERPRINT_PEPPER: generateSecret(),
    // Lower Argon2 cost keeps unit tests fast; production parameters are tuned at HOST-002.
    ARGON2_MEMORY_KIB: '8192',
    ARGON2_TIME_COST: '1',
  };
  const merged: Record<string, string> = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  return merged;
}
