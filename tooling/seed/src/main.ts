import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '@hmedic/config';
import { createDatabase } from '@hmedic/database';
import { PATIENTS, PHONE_FOR, Seeder, verifySeed } from './seed';
import { type StoredCredential, credentialsPath, mayStore, readStore, writeStore } from './credentials';

/**
 * `pnpm db:seed [--rotate-passwords]` / `pnpm db:seed:verify` / `pnpm db:credentials`.
 *
 * Generated demo passwords are printed once. In development and test they are also written to
 * `.local/dev-credentials.json` so they can be read again without rotating every password to recover
 * one; see `credentials.ts` for why that stops at those two environments.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      verify: { type: 'boolean' },
      'rotate-passwords': { type: 'boolean' },
      credentials: { type: 'boolean' },
    },
  });
  // Standalone runs (`pnpm db:seed`) read the repo-root .env like `pnpm dev` does; variables already set in the
  // environment (e.g. an explicit staging DATABASE_URL) take precedence because loadEnvFile never overrides.
  const envFile = path.resolve(__dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  let cfg: Record<string, unknown>;
  try {
    cfg = loadConfig('seed');
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 78;
    }
    throw error;
  }
  const c = cfg as Record<string, string | number>;
  if (c.APP_ENV === 'production') {
    process.stderr.write('seed refuses to run with APP_ENV=production\n');
    return 2;
  }
  const repoRoot = path.resolve(__dirname, '../../..');

  // `--credentials` only reads the store, so it needs no database at all.
  if (values.credentials) {
    const store = readStore(repoRoot);
    if (!store) {
      process.stderr.write(
        mayStore(String(c.APP_ENV))
          ? 'db:credentials: nothing stored yet. Run `pnpm db:seed` (or `pnpm db:seed ' +
              '--rotate-passwords` if the accounts already exist) to generate and record them.\n'
          : `db:credentials: refused for APP_ENV=${String(c.APP_ENV)}; demo passwords are never ` +
              'written to disk outside development and test.\n',
      );
      return 1;
    }
    printCredentials(store.credentials, credentialsPath(repoRoot));
    return 0;
  }

  const db = createDatabase({ url: String(c.DATABASE_URL), poolMax: 4 });
  try {
    if (values.verify) {
      const problems = await verifySeed(db.prisma);
      for (const p of problems) process.stderr.write(`seed:verify ✗ ${p}\n`);
      process.stdout.write(`seed:verify ${problems.length ? 'FAILED' : 'passed'}\n`);
      return problems.length ? 1 : 0;
    }
    const report = await new Seeder(
      db.prisma,
      {
        appEnv: String(c.APP_ENV),
        argon2: {
          memoryKiB: Number(c.ARGON2_MEMORY_KIB),
          timeCost: Number(c.ARGON2_TIME_COST),
          parallelism: Number(c.ARGON2_PARALLELISM),
        },
        kek: { id: String(c.PROVIDER_CREDENTIAL_KEK_ID), base64: String(c.PROVIDER_CREDENTIAL_KEK) },
        fingerprintPepper: String(c.PROVIDER_CREDENTIAL_FINGERPRINT_PEPPER),
      },
      { rotatePasswords: values['rotate-passwords'] === true },
    ).run();
    process.stdout.write(
      `seed: ${report.created.length ? report.created.join('\n      ') : 'nothing to create (idempotent)'}\n`,
    );
    const rotatedAt = new Date().toISOString();
    const fresh: StoredCredential[] = [
      ...report.credentials.map((r) => ({
        login: r.login,
        role: r.role,
        password: r.password,
        method: 'password' as const,
        rotatedAt,
      })),
      // Patients hold no password: the phone *is* the credential and the code comes from the mock
      // inbox. They belong in the store anyway, because "how do I log in as a patient" is the same
      // question a developer is asking when they reach for this file.
      ...PATIENTS.map((n) => ({
        login: PHONE_FOR(n),
        role: 'patient',
        password: '',
        method: 'otp' as const,
        note: 'phone + OTP; read the code from `pnpm dev:otp` or GET /internal/test/otp/:challengeId',
        rotatedAt,
      })),
    ];
    const written = writeStore(repoRoot, String(c.APP_ENV), fresh);
    // Re-read, so a run that created nothing still prints the passwords already on disk rather than
    // the empty list the seeder returned.
    const store = readStore(repoRoot);
    printCredentials(store?.credentials ?? fresh, written);
    return 0;
  } finally {
    await db.close();
  }
}

/** One table, so the seed and `--credentials` present the logins the same way. */
function printCredentials(credentials: readonly StoredCredential[], writtenTo: string | null): void {
  if (credentials.length === 0) return;
  process.stdout.write('\nDemo logins\n');
  for (const c of credentials.filter((x) => x.method === 'password')) {
    process.stdout.write(`  ${c.role.padEnd(22)} ${c.login.padEnd(36)} ${c.password}\n`);
  }
  const otp = credentials.filter((x) => x.method === 'otp');
  if (otp.length > 0) {
    process.stdout.write('\n  Patients (phone + OTP, no password):\n');
    for (const c of otp) process.stdout.write(`    ${c.login}\n`);
    process.stdout.write('    Read the code with `pnpm dev:otp`, or GET /internal/test/otp/:challengeId\n');
  }
  process.stdout.write(
    writtenTo
      ? `\nStored at ${writtenTo} — re-read any time with \`pnpm db:credentials\`.\n`
      : '\nShown once; not written to disk in this environment.\n',
  );
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Field errors and details carry the reason an AppError was raised; without them the seed is undebuggable.
    const extra =
      error && typeof error === 'object'
        ? [
            'fieldErrors' in error ? JSON.stringify(error.fieldErrors) : '',
            'details' in error ? JSON.stringify(error.details) : '',
            'code' in error ? String(error.code) : '',
            'meta' in error ? JSON.stringify(error.meta) : '',
          ]
            .filter(Boolean)
            .join(' ')
        : '';
    process.stderr.write(
      `seed failed: ${error instanceof Error ? `${error.name}: ${error.message}` : 'error'}${extra ? ` ${extra}` : ''}\n`,
    );
    process.exitCode = 1;
  },
);
