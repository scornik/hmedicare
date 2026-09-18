import { z } from 'zod';
import { type AppEnv, type AppName, LOCAL_ONLY, SECTIONS_BY_APP, runtimeSection } from './schema';

export class ConfigError extends Error {
  /** Variable names only; values are never included (ENVIRONMENT-CONTRACT.md §11). */
  readonly problems: readonly string[];
  constructor(app: string, problems: string[]) {
    super(
      `Invalid configuration for ${app}. Fix these environment variables (values are not shown):\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

function buildSchema(app: AppName) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const section of SECTIONS_BY_APP[app]) Object.assign(shape, section);
  return z.object(shape).passthrough();
}

const KEK_ID_VARS = [
  'PUSH_TOKEN_KEK_ID',
  'PROVIDER_CREDENTIAL_KEK_ID',
  'PHI_FIELD_KEK_ID',
  'AI_CREDENTIAL_KEK_ID',
];
const ENV_PREFIX: Record<AppEnv, string> = {
  development: 'dev',
  test: 'test',
  staging: 'staging',
  production: 'prod',
};

/** Cross-field rules that fail closed in staging and production (ENVIRONMENT-CONTRACT.md §11, ADR-018 §2). */
function crossChecks(env: Env, appEnv: AppEnv, app: AppName): string[] {
  const problems: string[] = [];
  const deployed = appEnv === 'staging' || appEnv === 'production';

  if (deployed) {
    for (const [name, isSet] of Object.entries(LOCAL_ONLY)) {
      const value = env[name];
      if (value !== undefined && isSet(value))
        problems.push(`${name}: LOCAL-only variable is refused in ${appEnv}`);
    }
    for (const name of KEK_ID_VARS) {
      const value = env[name];
      if (value !== undefined && !value.startsWith(`${ENV_PREFIX[appEnv]}-`)) {
        problems.push(
          `${name}: key id must start with "${ENV_PREFIX[appEnv]}-" so keys are never reused across environments`,
        );
      }
    }
  }

  if (app === 'api' && (env.CORS_ALLOWED_ORIGINS ?? '').split(',').some((o) => o.trim() === '*')) {
    problems.push('CORS_ALLOWED_ORIGINS: wildcard origin is not allowed');
  }

  const mode = env.JOB_RUNNER_MODE;
  if ((app === 'worker' || mode === 'embedded' || mode === 'cron') && app !== 'seed' && app !== 'cli') {
    if (mode && mode !== 'off' && !env.INTERNAL_CRON_TOKEN) {
      problems.push('INTERNAL_CRON_TOKEN: required when a job runner is active (worker/embedded/cron)');
    }
  }

  if (env.SMS_PROVIDER === 'zamanit') {
    for (const name of [
      'ZAMANIT_BASE_URL',
      'ZAMANIT_API_KEY',
      'ZAMANIT_SENDER_ID',
      'ZAMANIT_API_KEY_ISSUED_ON',
    ]) {
      if (!env[name]) problems.push(`${name}: required when SMS_PROVIDER=zamanit`);
    }
    const base = env.ZAMANIT_BASE_URL ?? '';
    const insecureAllowed =
      env.ZAMANIT_ALLOW_INSECURE_HTTP === 'true' || env.ZAMANIT_ALLOW_INSECURE_HTTP === '1';
    if (base.startsWith('http://') && !insecureAllowed) {
      problems.push(
        'ZAMANIT_BASE_URL: plain http requires ZAMANIT_ALLOW_INSECURE_HTTP=true (and GATE-SMS-HTTP in production)',
      );
    }
  }
  if (env.OTP_PROVIDER === 'sms' && (env.SMS_PROVIDER ?? 'mock') === 'mock' && deployed) {
    problems.push('OTP_PROVIDER: "sms" with SMS_PROVIDER=mock is not allowed in staging/production');
  }
  if (appEnv === 'production' && env.OTP_PROVIDER !== undefined && env.OTP_PROVIDER === 'mock') {
    problems.push('OTP_PROVIDER: mock delivery is refused in production');
  }
  if (env.OTEL_ENABLED === 'true' && !env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    problems.push('OTEL_EXPORTER_OTLP_ENDPOINT: required when OTEL_ENABLED=true');
  }
  return problems;
}

export type LoadedConfig = Record<string, unknown> & { APP_ENV: AppEnv };

/**
 * Parses and validates the environment for an app. Throws ConfigError listing every missing or invalid
 * variable by name. Never prints values.
 */
export function loadConfig<T extends LoadedConfig = LoadedConfig>(app: AppName, env: Env = process.env): T {
  const appEnvParse = runtimeSection.APP_ENV.safeParse(env.APP_ENV);
  if (app !== 'cli' && app !== 'host-probe' && !appEnvParse.success) {
    throw new ConfigError(app, ['APP_ENV: required (development|test|staging|production)']);
  }
  const appEnv: AppEnv = appEnvParse.success ? appEnvParse.data : 'development';
  const result = buildSchema(app).safeParse(env);
  const problems: string[] = [];
  if (!result.success) {
    for (const issue of result.error.issues) {
      const name = String(issue.path[0] ?? '(root)');
      const missing = issue.code === 'invalid_type' && issue.received === 'undefined';
      problems.push(`${name}: ${missing ? 'required but not set' : issue.message}`);
    }
  }
  problems.push(...crossChecks(env, appEnv, app));
  if (problems.length) throw new ConfigError(app, [...new Set(problems)].sort());
  return { ...(result.data as Record<string, unknown>), APP_ENV: appEnv } as T;
}

/** Web build rule: public VITE_* variables must never look like secrets (WEB-IMPLEMENTATION.md §3). */
export function assertPublicViteEnv(names: readonly string[]): void {
  const bad = names.filter((n) => n.startsWith('VITE_') && /SECRET|KEY|TOKEN|PASSWORD/i.test(n));
  if (bad.length)
    throw new ConfigError(
      'web',
      bad.map((n) => `${n}: secret-looking names are not allowed in VITE_*`),
    );
}
