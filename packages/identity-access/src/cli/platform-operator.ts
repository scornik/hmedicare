import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { createDatabase } from '@hmedic/database';
import { PrismaAuditPort } from '@hmedic/audit';
import { PLATFORM_PERMISSIONS } from '../domain/authz/permissions';
import { PlatformOperatorService } from '../infrastructure/platform-operators';

/**
 * `pnpm ops:platform-operator grant --email <e> --permissions <a,b>` / `revoke --email <e>`
 * (AUTH §2.6). Run by the account owner with DB access; writes a platform-chain audit event. Prints ids and
 * permission names only.
 */
async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { email: { type: 'string' }, permissions: { type: 'string' } },
  });
  const command = positionals[0];
  const url = process.env.DATABASE_URL;
  if (!url || !values.email || (command !== 'grant' && command !== 'revoke')) {
    process.stderr.write(
      'usage: platform-operator grant --email <email> --permissions <p1,p2> | revoke --email <email>\n' +
        `platform permissions: ${PLATFORM_PERMISSIONS.join(', ')}\nDATABASE_URL is required.\n`,
    );
    return 2;
  }
  const db = createDatabase({ url, poolMax: 2 });
  const who = `cli:${userInfo().username}`.slice(0, 128);
  try {
    const svc = new PlatformOperatorService(db.prisma, new PrismaAuditPort());
    if (command === 'grant') {
      const r = await svc.grant({
        email: values.email,
        permissions: (values.permissions ?? '')
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
        grantedBy: who,
        grantorUserId: null,
      });
      process.stdout.write(
        `${JSON.stringify({ event: 'PLATFORM_OPERATOR_GRANTED', operatorId: r.operatorId, permissions: r.permissions })}\n`,
      );
    } else {
      await svc.revoke({ email: values.email, revokedBy: who, revokerUserId: null });
      process.stdout.write(`${JSON.stringify({ event: 'PLATFORM_OPERATOR_REVOKED' })}\n`);
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
    const code = (error as { code?: string }).code ?? (error instanceof Error ? error.name : 'error');
    process.stderr.write(`platform-operator failed: ${code}\n`);
    process.exitCode = 1;
  },
);
