import { createRequire } from 'node:module';
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

// Proves each eslint-plugin-hmedic rule fires on a violation and stays quiet on valid code.
const require = createRequire(import.meta.url);
const plugin = require('eslint-plugin-hmedic') as { rules: Record<string, never> };

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser as never } });

describe('hmedic/no-raw-sql', () => {
  tester.run('no-raw-sql', plugin.rules['no-raw-sql'], {
    valid: [
      {
        code: 'await prisma.user.findMany();',
        filename: '/repo/packages/identity-access/src/infrastructure/repo.ts',
      },
      {
        code: 'await prisma.$queryRaw`SELECT 1 FOR UPDATE`;',
        filename: '/repo/packages/database/src/locks/lock-row.ts',
      },
    ],
    invalid: [
      {
        code: 'await prisma.$queryRaw`SELECT * FROM users`;',
        filename: '/repo/packages/identity-access/src/infrastructure/repo.ts',
        errors: [{ messageId: 'rawCall' }],
      },
      {
        code: "await db.$executeRawUnsafe('DELETE FROM jobs');",
        filename: '/repo/apps/api/src/main.ts',
        errors: [{ messageId: 'rawCall' }],
      },
      {
        code: "const sql = 'SELECT id FROM jobs FOR UPDATE SKIP LOCKED';",
        filename: '/repo/packages/jobs/src/runner.ts',
        errors: [{ messageId: 'lockSql' }],
      },
    ],
  });
});

describe('hmedic/no-append-only-mutation', () => {
  tester.run('no-append-only-mutation', plugin.rules['no-append-only-mutation'], {
    valid: ['await tx.auditLog.create({ data });', 'await tx.user.update({ where, data });'],
    invalid: [
      { code: 'await tx.auditLog.update({ where, data });', errors: [{ messageId: 'mutation' }] },
      { code: 'await prisma.auditLog.deleteMany({});', errors: [{ messageId: 'mutation' }] },
      { code: 'await tx.platformGateDecision.upsert({});', errors: [{ messageId: 'mutation' }] },
    ],
  });
});

describe('hmedic/no-secret-logging', () => {
  tester.run('no-secret-logging', plugin.rules['no-secret-logging'], {
    valid: ["logger.info({ userId }, 'login');", "console.warn('started');"],
    invalid: [
      { code: "logger.info({ password }, 'login');", errors: [{ messageId: 'secret' }] },
      { code: 'console.log(otpCode);', errors: [{ messageId: 'secret' }] },
      { code: 'this.logger.debug(`key ${apiKey}`);', errors: [{ messageId: 'secret' }] },
    ],
  });
});

describe('hmedic/no-get-provider-call', () => {
  tester.run('no-get-provider-call', plugin.rules['no-get-provider-call'], {
    valid: ["await fetch(url, { method: 'POST', body });"],
    invalid: [
      { code: "await fetch(url, { method: 'GET' });", errors: [{ messageId: 'get' }] },
      { code: "const u = base + '/api/sendsms?api_key=' + key;", errors: [{ messageId: 'credInUrl' }] },
      { code: 'const u = `${base}/check?signature_key=${k}`;', errors: [{ messageId: 'credInUrl' }] },
    ],
  });
});

describe('hmedic/no-tls-disable', () => {
  tester.run('no-tls-disable', plugin.rules['no-tls-disable'], {
    valid: ['new Agent({ rejectUnauthorized: true });'],
    invalid: [
      { code: 'new Agent({ rejectUnauthorized: false });', errors: [{ messageId: 'reject' }] },
      { code: "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';", errors: [{ messageId: 'env' }] },
    ],
  });
});
