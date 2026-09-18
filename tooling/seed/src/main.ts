import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '@hmedic/config';
import { createDatabase } from '@hmedic/database';
import { Seeder, verifySeed } from './seed';

/**
 * `pnpm db:seed [--rotate-passwords]` / `pnpm db:seed:verify`.
 * Generated demo passwords are printed to this terminal only and never written to files.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { verify: { type: 'boolean' }, 'rotate-passwords': { type: 'boolean' } },
  });
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
    if (report.credentials.length) {
      process.stdout.write(
        '\nDemo logins (shown once; not stored anywhere — re-run with --rotate-passwords to reset):\n',
      );
      for (const r of report.credentials)
        process.stdout.write(`  ${r.role.padEnd(22)} ${r.login.padEnd(36)} ${r.password}\n`);
      process.stdout.write(
        'Patient users log in with OTP (mock inbox: GET /internal/test/otp/:challengeId).\n',
      );
    }
    return 0;
  } finally {
    await db.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `seed failed: ${error instanceof Error ? `${error.name}: ${error.message}` : 'error'}\n`,
    );
    process.exitCode = 1;
  },
);
