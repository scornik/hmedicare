import { createHash, randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { PrismaAuditPort } from '@hmedic/audit';
import { createDatabase, withTransaction } from '@hmedic/database';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher } from '../infrastructure/argon2-hasher';

/**
 * `pnpm ops:create-operator-user --email <e> --phone <+8801…> --name <display> --confirm <token>`
 * (AUTH §2.6, the prerequisite of `ops:platform-operator grant`).
 *
 * A fresh installation has no platform operator and no way to make one. `ops:platform-operator grant`
 * refuses an account without a password and a verified phone, because operators authenticate with
 * password plus OTP on every session, and the seed that creates such an account is development-only by
 * design — it writes a known password to `.local/dev-credentials.json`. So in production nobody can
 * call a `/admin/*` route at all, including the dataset-import gates. This fills exactly that gap.
 *
 * It creates the user and stops. Permissions are a separate, separately audited command, so that
 * "an account exists" and "that account may import a medication catalog" are two decisions with two
 * records, rather than one flag that quietly does both.
 *
 * Borrowed deliberately from `ops:reset-owner-password`, which solves the neighbouring problem:
 *
 * - **Two invocations.** The first prints a confirmation token and changes nothing. Creating a
 *   privileged account should not be something a mistyped command does on the first try.
 * - **The password is generated here, never accepted as an argument.** A password passed as a flag lands
 *   in shell history and in `ps` for every other process on the host. It is printed once and never
 *   stored or logged.
 * - **It refuses an existing account.** Re-pointing an existing user at a new password is
 *   `ops:reset-owner-password`, which takes a backup first; silently overwriting one from here would be
 *   a password reset wearing a different name.
 *
 * `phone_verified_at` is set without an OTP round trip, and that is the one thing here worth arguing
 * about. The justification is narrow: this command runs on the host, by someone who already holds shell
 * and database access, for an account they are provisioning for themselves. Such a person can already
 * write any row they like. What they cannot do by hand is leave a correct audit record, use the
 * deployment's own Argon2 parameters, and get a password that was never typed into a shell. That is
 * what this adds. It does not weaken the OTP requirement for *login*: every operator session still
 * needs the second factor, which is the control that matters.
 */
const CONFIRM_WINDOW_MINUTES = 15;
const GENERATED_PASSWORD_BYTES = 18;

/** E.164, which is what `users.phone_e164` holds and what the OTP sender expects. */
export const E164_RE = /^\+[1-9]\d{7,14}$/;

/**
 * The confirmation token. Derived from the operation rather than random, so the second invocation
 * proves the operator read the first one rather than merely ran the command twice, and so a token
 * cannot be reused for a different account or a different quarter-hour.
 */
export function confirmationToken(email: string, at: Date): string {
  const window = Math.floor(at.getTime() / (CONFIRM_WINDOW_MINUTES * 60_000));
  // Hashed, not the encoded string itself. Base64 of a prefixed plaintext, truncated to twelve
  // characters, encodes only the prefix — every email and every window would print one identical
  // token, which is a confirmation step that confirms nothing.
  return createHash('sha256').update(`operator-user:${email}:${window}`).digest('base64url').slice(0, 12);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      phone: { type: 'string' },
      name: { type: 'string' },
      confirm: { type: 'string' },
    },
  });
  const url = process.env.DATABASE_URL;
  const email = values.email?.trim().toLowerCase();
  const phone = values.phone?.trim();
  const name = values.name?.trim();
  if (!url || !email || !phone || !name) {
    process.stderr.write(
      'usage: create-operator-user --email <email> --phone <+8801…> --name <display name>\n' +
        '       [--confirm <token>]\n' +
        'DATABASE_URL is required. Run once without --confirm to get the token.\n' +
        'The password is generated here and printed once; it is never read from a flag.\n' +
        'Grant permissions afterwards with ops:platform-operator grant.\n',
    );
    return 2;
  }
  if (!email.includes('@') || email.length > 254) {
    process.stderr.write('create-operator-user: that does not look like an email address.\n');
    return 2;
  }
  if (!E164_RE.test(phone)) {
    process.stderr.write(
      `create-operator-user: "${phone}" is not E.164. It must start with + and a country code, ` +
        'for example +8801700000123. The OTP step-up sends to this number.\n',
    );
    return 2;
  }

  const now = new Date();
  const expected = confirmationToken(email, now);
  if (values.confirm !== expected) {
    // The previous window is also accepted, because a token issued at 14:59 should still work at 15:00.
    const previous = confirmationToken(email, new Date(now.getTime() - CONFIRM_WINDOW_MINUTES * 60_000));
    if (!values.confirm || values.confirm !== previous) {
      process.stderr.write(
        'create-operator-user: nothing has changed.\n\n' +
          `This will create an active account for ${email} with a password and a phone marked\n` +
          `verified, so that it can be granted platform operator permissions.\n` +
          `Re-run within ${CONFIRM_WINDOW_MINUTES} minutes with:\n\n` +
          `  --confirm ${expected}\n\n`,
      );
      return 3;
    }
  }

  const db = createDatabase({ url, poolMax: 2 });
  const who = `cli:${userInfo().username}`.slice(0, 128);
  try {
    const byEmail = await db.prisma.user.findUnique({
      where: { emailNormalized: email },
      select: { id: true },
    });
    if (byEmail) {
      process.stderr.write(
        'create-operator-user: that email already has an account. To give it a new password use\n' +
          'ops:reset-owner-password, which takes a backup first; to make it an operator use\n' +
          'ops:platform-operator grant.\n',
      );
      return 5;
    }
    const byPhone = await db.prisma.user.findUnique({
      where: { phoneE164: phone },
      select: { id: true },
    });
    if (byPhone) {
      process.stderr.write(
        'create-operator-user: that phone number already belongs to an account. Two accounts cannot\n' +
          'share a number, because the OTP would be ambiguous.\n',
      );
      return 5;
    }

    // Generated here, printed once, never stored, never logged, never passed as an argument.
    const password = randomBytes(GENERATED_PASSWORD_BYTES).toString('base64url');
    // The deployment's own parameters, so the stored hash matches what login will verify against.
    const hasher = new Argon2idHasher({
      memoryKiB: Number(process.env.ARGON2_MEMORY_KIB ?? 19456),
      timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
      parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
    });
    const hash = await hasher.hash(password);
    const audit = new PrismaAuditPort();
    const userId = newId();

    await withTransaction(
      db.prisma,
      async (tx) => {
        await tx.user.create({
          data: {
            id: userId,
            email,
            emailNormalized: email,
            phoneE164: phone,
            // Vouched for by whoever holds the host, recorded as such in the audit metadata below.
            phoneVerifiedAt: now,
            emailVerifiedAt: now,
            displayName: name.slice(0, 120),
            status: 'ACTIVE',
            passwordHash: hash,
            passwordChangedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });
        await audit.append(tx, {
          tenantId: null,
          actorUserId: null,
          actorType: 'SYSTEM',
          action: 'PLATFORM_OPERATOR_USER_CREATED',
          resourceType: 'user',
          resourceId: userId,
          outcome: 'SUCCESS',
          requestId: null,
          correlationId: newId(),
          // Who ran it, and that the phone was vouched for rather than verified by OTP. Never the
          // password, never the email and never the phone number: the row already identifies the user
          // by id, and a contact detail in metadata is a contact detail sitting somewhere it is not
          // needed.
          metadata: { operator: who, phoneVerification: 'VOUCHED_BY_HOST_OPERATOR' },
        });
      },
      { context: 'ops:create-operator-user' },
    );

    process.stdout.write(
      '\ncreate-operator-user: done.\n\n' +
        `  user   ${userId}\n` +
        `  login  ${email}\n\n` +
        'Password (shown once, not stored anywhere):\n\n' +
        `  ${password}\n\n` +
        'This account has no permissions yet. Grant them, and nothing wider than the task needs:\n\n' +
        `  pnpm ops:platform-operator grant --email ${email} --permissions medication.import\n\n` +
        'Then sign in, change the password, and complete the OTP step-up.\n\n',
    );
    return 0;
  } finally {
    await db.close();
  }
}

// Only when run as the command: the token derivation and the phone pattern are unit-tested directly.
if (process.argv[1]?.includes('create-operator-user')) {
  main()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      // Never the error object: it may carry the connection string or the generated password.
      process.stderr.write(`create-operator-user: ${String((e as Error).message ?? e).slice(0, 300)}\n`);
      process.exit(1);
    });
}
