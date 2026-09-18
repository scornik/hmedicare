#!/usr/bin/env node
// Generates environment secrets (ENVIRONMENT-CONTRACT.md §11): fresh random peppers/tokens, an Ed25519 JWT
// key pair and 32-byte KEKs with environment-prefixed key ids.
//
//   node scripts/generate-local-secrets.mjs                 # writes .env for local development (refuses to overwrite)
//   node scripts/generate-local-secrets.mjs --force         # overwrite .env
//   node scripts/generate-local-secrets.mjs --env staging --print   # print staging secrets to paste into hPanel
//
// Staging/production output is printed only (never written to a file in the repository).
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const env = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'development';
const print = args.includes('--print');
const force = args.includes('--force');
const PREFIX = { development: 'dev', test: 'test', staging: 'staging', production: 'prod' }[env];
if (!PREFIX) {
  console.error(
    'usage: generate-local-secrets.mjs [--env development|staging|production] [--print] [--force]',
  );
  process.exit(2);
}
if (env !== 'development' && !print) {
  console.error(`Refusing to write ${env} secrets to a file. Use --print and paste them into hPanel.`);
  process.exit(2);
}

const secret = (bytes = 32) => randomBytes(bytes).toString('base64');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const kid = `${PREFIX}-jwt-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
const pem = (k, type) => k.export({ format: 'pem', type }).toString().trim();
const escaped = (s) => s.replace(/\n/g, '\\n');

const secrets = {
  LOG_HASH_PEPPER: secret(),
  INTERNAL_CRON_TOKEN: secret(),
  INTERNAL_METRICS_TOKEN: secret(),
  JWT_SIGNING_KEY_ID: kid,
  JWT_SIGNING_PRIVATE_KEY: escaped(pem(privateKey, 'pkcs8')),
  JWT_VERIFICATION_KEYS: JSON.stringify({ [kid]: pem(publicKey, 'spki') }),
  REFRESH_TOKEN_PEPPER: secret(),
  OTP_PEPPER: secret(),
  RATE_LIMIT_PEPPER: secret(),
  CSRF_SECRET: secret(),
  PUSH_TOKEN_KEK: secret(32),
  PUSH_TOKEN_KEK_ID: `${PREFIX}-push-1`,
  PROVIDER_CREDENTIAL_KEK: secret(32),
  PROVIDER_CREDENTIAL_KEK_ID: `${PREFIX}-pc-1`,
  PROVIDER_CREDENTIAL_FINGERPRINT_PEPPER: secret(),
};

if (print) {
  for (const [k, v] of Object.entries(secrets)) console.log(`${k}=${v}`);
  process.exit(0);
}

const target = path.join(root, '.env');
if (existsSync(target) && !force) {
  console.error(
    '.env already exists (use --force to regenerate; existing sessions and encrypted rows become unreadable).',
  );
  process.exit(1);
}
let template = readFileSync(path.join(root, '.env.example'), 'utf8');
for (const [k, v] of Object.entries(secrets)) {
  // The PEM is double-quoted so the env-file parser expands \n; the JSON map is single-quoted (kept verbatim,
  // JSON.parse decodes its \n escapes).
  const value = k === 'JWT_SIGNING_PRIVATE_KEY' ? `"${v}"` : k === 'JWT_VERIFICATION_KEYS' ? `'${v}'` : v;
  template = template.replace(new RegExp(`^${k}=.*$`, 'm'), () => `${k}=${value}`);
}
// Local compose credentials (infrastructure/docker/compose.yaml; local-only, not a secret).
template = template.replace(
  /^DATABASE_URL=.*$/m,
  'DATABASE_URL=mariadb://hmedic_app:local-only-password@127.0.0.1:3306/hmedic_dev',
);
writeFileSync(target, template, { mode: 0o600 });
console.log('wrote .env with freshly generated development secrets (gitignored).');
