import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { createDatabase } from '@hmedic/database';
import { PrismaAuditPort } from '@hmedic/audit';
import { Argon2idHasher, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@hmedic/identity-access';
import { TenantBootstrapService } from '../infrastructure/tenant-bootstrap';

/**
 * `pnpm ops:bootstrap-tenant --name <clinic> --owner-name <person> --owner-email <email>`
 *
 * Creates the first tenant and its owner on a database that has schema but no data — the state a fresh
 * deployment is in after migrations. This is deliberately **not** `pnpm db:seed`: the seed writes synthetic
 * patients, chambers and demo logins, none of which belong in production.
 *
 * The owner's password is read from `HMEDIC_BOOTSTRAP_OWNER_PASSWORD` and never echoed, logged or written
 * to a file. It is taken from the environment rather than a flag so it does not land in shell history or
 * in the arguments another process can read from `ps`.
 *
 * Re-running is safe: a tenant with the same slug is reported and left alone.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      slug: { type: 'string' },
      'owner-name': { type: 'string' },
      'owner-email': { type: 'string' },
      'owner-phone': { type: 'string' },
      'practice-type': { type: 'string', default: 'SOLO' },
    },
  });
  const url = process.env.DATABASE_URL;
  const password = process.env.HMEDIC_BOOTSTRAP_OWNER_PASSWORD;
  const practiceType = values['practice-type'] === 'GROUP' ? 'GROUP' : 'SOLO';
  const ownerName = values['owner-name'];
  const ownerEmail = values['owner-email'];
  const ownerPhone = values['owner-phone'];

  if (!url || !values.name || !ownerName || (!ownerEmail && !ownerPhone)) {
    process.stderr.write(
      'usage: bootstrap-tenant --name <clinic name> --owner-name <person> ' +
        '(--owner-email <email> | --owner-phone <01…>) [--slug <slug>] [--practice-type SOLO|GROUP]\n' +
        'DATABASE_URL and HMEDIC_BOOTSTRAP_OWNER_PASSWORD are required.\n' +
        'The password is read from the environment so it stays out of shell history and `ps`.\n',
    );
    return 2;
  }
  if (!password || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    process.stderr.write(
      `HMEDIC_BOOTSTRAP_OWNER_PASSWORD must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.\n`,
    );
    return 2;
  }

  const db = createDatabase({ url, poolMax: 2 });
  const by = `cli:${userInfo().username}`.slice(0, 128);
  try {
    // A bootstrap is for an empty installation. Refusing on an existing tenant keeps this from being the
    // tool someone reaches for to add the second clinic, which is `POST /tenants` under an operator session.
    const existing = await db.prisma.tenant.count();
    if (existing > 0) {
      const slug = values.slug;
      const match = slug ? await db.prisma.tenant.findUnique({ where: { slug } }) : null;
      if (match) {
        process.stdout.write(
          `${JSON.stringify({ event: 'TENANT_ALREADY_BOOTSTRAPPED', tenantId: match.id, slug: match.slug })}\n`,
        );
        return 0;
      }
      process.stderr.write(
        `refusing: ${existing} tenant(s) already exist. Bootstrap is for an empty installation; ` +
          'create further tenants through POST /tenants as a platform operator.\n',
      );
      return 1;
    }

    const hasher = new Argon2idHasher({
      memoryKiB: Number(process.env.ARGON2_MEMORY_KIB ?? 19_456),
      timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
      parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
    });
    // Hash before writing anything, so a rejected password fails without leaving a half-made tenant.
    const passwordHash = await hasher.hash(password);

    const result = await new TenantBootstrapService(db.prisma, new PrismaAuditPort()).bootstrap({
      name: values.name,
      slug: values.slug,
      practiceType,
      owner: { email: ownerEmail, phone: ownerPhone, displayName: ownerName },
      actor: { userId: null, type: 'SYSTEM' },
    });

    const now = new Date();
    await db.prisma.user.update({
      where: { id: result.ownerUserId },
      data: { passwordHash, passwordChangedAt: now, updatedAt: now },
    });

    process.stdout.write(
      `${JSON.stringify({
        event: 'TENANT_BOOTSTRAPPED',
        tenantId: result.tenantId,
        slug: result.slug,
        practiceType,
        ownerUserId: result.ownerUserId,
        ownerMembershipId: result.ownerMembershipId,
        ownerDoctorProfileId: result.ownerDoctorProfileId,
        by,
      })}\n`,
    );
    process.stderr.write(
      'Owner password set. It was never printed — sign in with it once and store it in a password manager.\n',
    );
    return 0;
  } finally {
    await db.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    // Never let an error carry the password into the output; the message and name are enough to act on.
    process.stderr.write(
      `bootstrap-tenant failed: ${error instanceof Error ? `${error.name}: ${error.message}` : 'error'}\n`,
    );
    process.exit(1);
  });
