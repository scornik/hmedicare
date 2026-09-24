import { randomBytes } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaAuditPort } from '@hmedic/audit';
import { createDatabase, withTransaction } from '@hmedic/database';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher } from '../infrastructure/argon2-hasher';

/**
 * `pnpm ops:reset-owner-password --email <owner> --confirm <token>` (OPS-001, human queue H-11).
 *
 * The last way back into an installation whose only account is locked out. Production has one user; if
 * that password is lost, nobody can sign in at all, and no email-based reset is deployed (D-18, gate
 * G-1). This is the break-glass path, run on the host by someone who already has shell and database
 * access — which is the point: it grants nothing that person did not already have, it just makes the
 * recovery a reviewed, audited operation instead of a hand-written UPDATE.
 *
 * It is deliberately awkward:
 *
 * - **Two invocations.** The first prints a confirmation token and changes nothing. The second must
 *   repeat it. A destructive command that works on the first try is one that works by accident.
 * - **A recent verified dump is required.** Resetting a password revokes every session; if the operator
 *   has the wrong installation open, that is disruptive and hard to undo. Refusing without a backup
 *   makes "I was sure this was staging" recoverable.
 * - **The new password is generated here, never accepted as an argument.** A password passed as a flag
 *   lands in shell history and in `ps` for every other process on the host. It is printed once, to this
 *   terminal, and never stored or logged.
 * - **Every session is revoked.** If the account was locked out because somebody else holds it, leaving
 *   their session alive would defeat the whole exercise.
 *
 * It does **not** close gate G-1. G-1 asks for a password recovery path a user can reach; this one needs
 * a person with SSH. Whether that is sufficient for the installation is the owner's call, not this
 * script's, and the status document says so.
 */
const CONFIRM_WINDOW_MINUTES = 15;
const DUMP_MAX_AGE_HOURS = 24;
const GENERATED_PASSWORD_BYTES = 18;

/** The most recent dump artefact and how old it is, or null when the directory holds none. */
async function newestDump(dir: string): Promise<{ file: string; ageHours: number } | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const dumps = entries.filter((f) => f.endsWith('.sql.gz'));
  if (dumps.length === 0) return null;

  let newest: { file: string; mtimeMs: number } | null = null;
  for (const f of dumps) {
    const s = await stat(path.join(dir, f));
    if (!newest || s.mtimeMs > newest.mtimeMs) newest = { file: f, mtimeMs: s.mtimeMs };
  }
  if (!newest) return null;
  return { file: newest.file, ageHours: (Date.now() - newest.mtimeMs) / 3_600_000 };
}

/**
 * The confirmation token. Derived from the operation rather than random, so the second invocation proves
 * the operator read the first one rather than merely ran the command twice, and so it cannot be reused
 * for a different account or a different quarter-hour.
 */
function confirmationToken(email: string, at: Date): string {
  const window = Math.floor(at.getTime() / (CONFIRM_WINDOW_MINUTES * 60_000));
  return Buffer.from(`${email}:${window}`).toString('base64url').slice(0, 12);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      confirm: { type: 'string' },
      'dump-dir': { type: 'string' },
      'allow-stale-dump': { type: 'boolean' },
    },
  });
  const url = process.env.DATABASE_URL;
  const email = values.email?.trim().toLowerCase();
  if (!url || !email) {
    process.stderr.write(
      'usage: reset-owner-password --email <owner email> [--confirm <token>]\n' +
        '       [--dump-dir <path>] [--allow-stale-dump]\n' +
        'DATABASE_URL is required. Run once without --confirm to get the token.\n' +
        'The new password is generated here and printed once; it is never read from a flag.\n',
    );
    return 2;
  }

  const dumpDir = values['dump-dir'] ?? process.env.PRE_MIGRATION_DUMP_DIR ?? '';
  const now = new Date();
  const expected = confirmationToken(email, now);

  if (values.confirm !== expected) {
    // The previous window is also printed, because a token issued at 14:59 should still be usable at
    // 15:00 — an operator racing a clock boundary would otherwise be told they typed it wrong.
    const previous = confirmationToken(email, new Date(now.getTime() - CONFIRM_WINDOW_MINUTES * 60_000));
    if (values.confirm && values.confirm === previous) {
      // Accepted: still inside the grace window.
    } else {
      process.stderr.write(
        `reset-owner-password: nothing has changed.\n\n` +
          `This will set a new password for ${email} and revoke every session on this installation.\n` +
          `Re-run within ${CONFIRM_WINDOW_MINUTES} minutes with:\n\n` +
          `  --confirm ${expected}\n\n`,
      );
      return 3;
    }
  }

  if (!dumpDir) {
    process.stderr.write(
      'reset-owner-password: refusing without a dump directory. Pass --dump-dir or set ' +
        'PRE_MIGRATION_DUMP_DIR so a recent backup can be verified.\n',
    );
    return 4;
  }
  const dump = await newestDump(dumpDir);
  if (!dump) {
    process.stderr.write(
      `reset-owner-password: refusing — no dump found in ${dumpDir}. Take one first; this revokes every ` +
        'session and should not be the first irreversible thing that happens today.\n',
    );
    return 4;
  }
  if (dump.ageHours > DUMP_MAX_AGE_HOURS && !values['allow-stale-dump']) {
    process.stderr.write(
      `reset-owner-password: refusing — the newest dump (${dump.file}) is ` +
        `${dump.ageHours.toFixed(1)} h old, older than ${DUMP_MAX_AGE_HOURS} h. Take a fresh one, or ` +
        'pass --allow-stale-dump if you accept restoring to that point.\n',
    );
    return 4;
  }

  const db = createDatabase({ url, poolMax: 2 });
  const who = `cli:${userInfo().username}`.slice(0, 128);
  try {
    const user = await db.prisma.user.findFirst({
      where: { emailNormalized: email },
      select: { id: true, status: true },
    });
    if (!user) {
      process.stderr.write(`reset-owner-password: no user with that email.\n`);
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

    await withTransaction(
      db.prisma,
      async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: hash, passwordChangedAt: now, updatedAt: now },
        });
        // If the account was lost because someone else holds it, leaving their session alive would
        // defeat the exercise. Written here rather than through `SessionService`, which needs a token
        // port and a session policy this process has no reason to build: the revocation is three
        // statements and bumping `token_version`, which is what invalidates access tokens already issued.
        const live = await tx.session.findMany({
          where: { userId: user.id, revokedAt: null },
          select: { id: true },
        });
        await tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'PASSWORD_CHANGED' },
        });
        if (live.length) {
          await tx.refreshToken.updateMany({
            where: { sessionId: { in: live.map((l) => l.id) }, revokedAt: null },
            data: { revokedAt: now },
          });
        }
        await tx.user.update({
          where: { id: user.id },
          data: { tokenVersion: { increment: 1 }, rowVersion: { increment: 1 }, updatedAt: now },
        });
        await audit.append(tx, {
          tenantId: null,
          actorUserId: user.id,
          actorType: 'SYSTEM',
          action: 'AUTH_OWNER_PASSWORD_RESET_BY_OPERATOR',
          resourceType: 'user',
          resourceId: user.id,
          outcome: 'SUCCESS',
          requestId: null,
          correlationId: newId(),
          // Who ran it, against which backup. Never the password, and never the email: the audit row
          // already identifies the user by id, and an address in metadata is a contact detail sitting
          // somewhere it does not need to be.
          metadata: {
            operator: who,
            dumpFile: dump.file,
            dumpAgeHours: Math.round(dump.ageHours),
            sessionsRevoked: live.length,
          },
        });
      },
      { context: 'ops:reset-owner-password' },
    );

    process.stdout.write(
      `\nreset-owner-password: done.\n\n` +
        `  user      ${user.id}\n` +
        `  sessions  all revoked\n` +
        `  backup    ${dump.file}\n\n` +
        `New password (shown once, not stored anywhere):\n\n  ${password}\n\n` +
        `Sign in and change it. This does not close gate G-1: a recovery path that needs SSH is not a\n` +
        `recovery path a user can reach.\n\n`,
    );
    return 0;
  } finally {
    await db.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    // Never the error object: it may carry the connection string or the generated password.
    process.stderr.write(`reset-owner-password: ${String((e as Error).message ?? e).slice(0, 300)}\n`);
    process.exit(1);
  });
