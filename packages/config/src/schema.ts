import { isIP } from 'node:net';
import { z } from 'zod';

/**
 * Environment contract (ENVIRONMENT-CONTRACT.md). Variables are grouped by section; each app composes
 * the sections it needs. Stage 4 covers runtime, database/jobs, auth/crypto, SMS/OTP and observability.
 * Storage, AI, payments, backups and medicine import sections are added by their stages.
 */
const TRUST_PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);

/** Parses TRUST_PROXY into proxy-addr entries; null when any entry is malformed. */
export function parseTrustProxy(value: string): string[] | null {
  const items = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  for (const item of items) {
    if (TRUST_PROXY_KEYWORDS.has(item)) continue;
    const [addr, prefix, extra] = item.split('/');
    const family = isIP(addr ?? '');
    if (family === 0 || extra !== undefined) return null;
    if (prefix !== undefined) {
      const n = Number(prefix);
      if (!/^\d{1,3}$/.test(prefix) || n > (family === 4 ? 32 : 128)) return null;
    }
  }
  return items;
}

export const APP_ENVS = ['development', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];
export type AppName = 'api' | 'worker' | 'host-probe' | 'seed' | 'cli';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');
const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);
const secret32 = z.string().min(32, 'must be at least 32 characters (≥ 32 random bytes, base64)');
const url = z.string().url();
const decimalBdt = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'must be a BDT decimal string');

export const runtimeSection = {
  APP_ENV: z.enum(APP_ENVS),
  APP_VERSION: z.string().default('dev'),
  PORT: z.coerce.number().int().min(1).max(65535),
  API_PUBLIC_URL: url.default('http://localhost:3000'),
  WEB_PUBLIC_URL: url.default('http://localhost:5173'),
  WORKER_PUBLIC_URL: url.default('http://localhost:3001'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  /**
   * Trusted reverse proxies (audit C-48): comma list of IPs, CIDRs or the keywords loopback | linklocal |
   * uniquelocal. Only requests whose immediate peer is listed get their client IP from X-Forwarded-For.
   * Empty = trust nothing. HOST-013 records Hostinger's proxy address. Hop counts are not accepted.
   */
  TRUST_PROXY: z
    .string()
    .default('')
    .refine(
      (v) => parseTrustProxy(v) !== null,
      'must be a comma list of IPs, CIDRs or loopback|linklocal|uniquelocal',
    ),
  DEFAULT_TIMEZONE: z.string().default('Asia/Dhaka'),
  DEFAULT_LOCALE: z.enum(['bn-BD', 'en-BD']).default('bn-BD'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  LOG_HASH_PEPPER: secret32,
};

export const databaseSection = {
  DATABASE_URL: z.string().regex(/^mariadb:\/\/|^mysql:\/\//, 'must be a mariadb:// or mysql:// URL'),
  DATABASE_POOL_MAX: int(10, 1, 100),
  DATABASE_POOL_MIN_IDLE: int(1, 0, 50),
  DATABASE_CONNECT_TIMEOUT_MS: int(10_000, 100),
  DATABASE_ACQUIRE_TIMEOUT_MS: int(5_000, 100),
  DB_LOCK_WAIT_TIMEOUT_SECONDS: int(5, 1, 120),
  DB_TX_RETRY_MAX: int(3, 0, 10),
  MIGRATION_LOCK_TIMEOUT_SECONDS: int(600, 1),
  MIGRATE_ON_STARTUP: bool(false),
};

export const jobsSection = {
  JOB_RUNNER_MODE: z.enum(['off', 'worker', 'embedded', 'cron']),
  JOB_CLAIM_STRATEGY: z.enum(['skip_locked', 'conditional_update']).default('skip_locked'),
  JOB_RUNNER_MAX_CONCURRENCY: int(2, 1, 16),
  JOB_POLL_INTERVAL_MS: int(1_000, 50),
  JOB_POLL_MAX_INTERVAL_MS: int(5_000, 50),
  JOB_CRON_BATCH_MAX: int(25, 1, 500),
  JOB_CRON_TIME_BUDGET_SECONDS: int(45, 1, 300),
  JOB_RETENTION_SUCCEEDED_DAYS: int(14, 1),
  JOB_RETENTION_FAILED_DAYS: int(90, 1),
  OUTBOX_RETENTION_DAYS: int(30, 1),
  IDEMPOTENCY_TTL_HOURS: int(24, 1),
  INTERNAL_CRON_TOKEN: secret32.optional(),
  /** SMS-002/HOST diagnostics on the worker; staging only, off by default (ENVIRONMENT-CONTRACT). */
  DIAGNOSTICS_ENABLED: bool(false),
  INTERNAL_DIAGNOSTICS_TOKEN: secret32.optional(),
  INTERNAL_METRICS_TOKEN: secret32,
};

export const authSection = {
  JWT_ISSUER: z.string().min(1).default('http://localhost:3000'),
  JWT_AUDIENCE: z.string().min(1).default('hmedic-api'),
  JWT_ACCESS_TTL_SECONDS: int(600, 60, 3600),
  JWT_SIGNING_KEY_ID: z.string().min(1),
  JWT_SIGNING_PRIVATE_KEY: z
    .string()
    .includes('PRIVATE KEY', { message: 'must be a PKCS#8 PEM private key' }),
  JWT_VERIFICATION_KEYS: z.string().refine(
    (v) => {
      try {
        const parsed = JSON.parse(v) as unknown;
        return typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0;
      } catch {
        return false;
      }
    },
    { message: 'must be a JSON map {kid: publicPem}' },
  ),
  REFRESH_TOKEN_PEPPER: secret32,
  OTP_PEPPER: secret32,
  RATE_LIMIT_PEPPER: secret32,
  CSRF_SECRET: secret32,
  SESSION_IDLE_TIMEOUT_HOURS_WEB: int(12, 1),
  SESSION_IDLE_TIMEOUT_HOURS_MOBILE: int(720, 1),
  SESSION_ABSOLUTE_TIMEOUT_DAYS_WEB: int(7, 1),
  SESSION_ABSOLUTE_TIMEOUT_DAYS_MOBILE: int(90, 1),
  ARGON2_MEMORY_KIB: int(19_456, 8_192),
  /**
   * Floor of 2, not 1: `argon2` itself refuses a time cost below 2, and it does so when the first password
   * is hashed rather than at load. A 1 here used to boot cleanly and then fail every login. It is also the
   * OWASP floor for Argon2id at this memory size, so the bound is worth having on its own merits.
   */
  ARGON2_TIME_COST: int(2, 2, 10),
  ARGON2_PARALLELISM: int(1, 1, 8),
  OTP_PROVIDER: z.enum(['mock', 'sms']).default('mock'),
  OTP_TTL_SECONDS: int(180, 60, 300),
  AUTH_COOKIE_DEV_MODE: bool(false),
  PLATFORM_OPERATOR_SESSION_IDLE_MINUTES: int(30, 5, 240),
  COVERAGE_MAX_DAYS: int(30, 1, 365),
  PUSH_TOKEN_KEK: secret32,
  PUSH_TOKEN_KEK_ID: z.string().min(1),
  PROVIDER_CREDENTIAL_KEK: secret32,
  PROVIDER_CREDENTIAL_KEK_ID: z.string().min(1),
  PROVIDER_CREDENTIAL_KEK_PREVIOUS: secret32.optional(),
  PROVIDER_CREDENTIAL_KEK_PREVIOUS_ID: z.string().min(1).optional(),
  PROVIDER_CREDENTIAL_FINGERPRINT_PEPPER: secret32,
};

export const smsSection = {
  SMS_PROVIDER: z.enum(['mock', 'zamanit']).default('mock'),
  ZAMANIT_BASE_URL: url.optional(),
  ZAMANIT_API_KEY: z.string().min(8).optional(),
  ZAMANIT_API_KEY_ISSUED_ON: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  ZAMANIT_SENDER_ID: z.string().min(1).optional(),
  ZAMANIT_TIMEOUT_MS: int(10_000, 1_000, 60_000),
  ZAMANIT_ALLOW_INSECURE_HTTP: bool(false),
  ZAMANIT_BALANCE_ALERT_BDT: decimalBdt.default('500.00'),
  ZAMANIT_BALANCE_DROP_ALERT_BDT_PER_HOUR: decimalBdt.default('200.00'),
  ZAMANIT_BALANCE_CHECK_MINUTES: int(60, 5),
  ZAMANIT_KEY_MAX_AGE_DAYS: int(90, 1),
  ZAMANIT_MAX_CONCURRENCY: int(2, 1, 8),
  ZAMANIT_MAX_SENDS_PER_MINUTE: int(30, 1),
};

export const observabilitySection = {
  OTEL_ENABLED: bool(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: url.optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
};

/** Variables that are LOCAL-only: refused outside development/test (ENVIRONMENT-CONTRACT.md legend). */
export const LOCAL_ONLY: Record<string, (value: string) => boolean> = {
  AUTH_COOKIE_DEV_MODE: (v) => v === 'true' || v === '1',
  ZAMANIT_LIVE_SMOKE: (v) => v === 'true' || v === '1',
  AAMARPAY_BASE_URL_OVERRIDE: (v) => v.length > 0,
};

export const SECTIONS_BY_APP: Record<AppName, Array<Record<string, z.ZodTypeAny>>> = {
  api: [runtimeSection, databaseSection, jobsSection, authSection, smsSection, observabilitySection],
  worker: [runtimeSection, databaseSection, jobsSection, authSection, smsSection, observabilitySection],
  seed: [runtimeSection, databaseSection, authSection],
  cli: [databaseSection],
  'host-probe': [],
};
