import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateJwtKeys, generateSecret } from '@hmedic/config/testing';
import { FixedClock, newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort } from '@hmedic/audit';
import { RateLimiter } from '@hmedic/jobs';
import { Argon2idHasher } from '../../src/infrastructure/argon2-hasher';
import { JoseTokenService } from '../../src/infrastructure/token-service';
import { SessionService } from '../../src/infrastructure/session-service';
import { MockPasswordResetNotifier, PasswordAuthService } from '../../src/infrastructure/password-auth';
import { CsrfService } from '../../src/infrastructure/csrf';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

// ID-002 password login, lockout/backoff, password reset; ID-004 CSRF token binding.
let db: Database;
const clock = new FixedClock(new Date('2026-09-18T06:00:00.000Z'));
const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 1, parallelism: 1 });
const notifier = new MockPasswordResetNotifier();
let sessions: SessionService;
let auth: PasswordAuthService;
const meta = { clientType: 'WEB' as const, ip: '203.0.113.10' };

beforeAll(() => {
  db = openTestDatabase();
  const keys = generateJwtKeys();
  const audit = new PrismaAuditPort(clock);
  sessions = new SessionService(
    db.prisma,
    new JoseTokenService(
      {
        issuer: 'i',
        audience: 'a',
        ttlSeconds: 600,
        signingKeyId: keys.JWT_SIGNING_KEY_ID,
        signingPrivateKeyPem: keys.JWT_SIGNING_PRIVATE_KEY,
        verificationKeysJson: keys.JWT_VERIFICATION_KEYS,
      },
      clock,
    ),
    {
      idleHoursWeb: 12,
      idleHoursMobile: 720,
      absoluteDaysWeb: 7,
      absoluteDaysMobile: 90,
      refreshPepper: generateSecret(),
    },
    audit,
    clock,
  );
  auth = new PasswordAuthService(
    db.prisma,
    hasher,
    sessions,
    new RateLimiter(db.prisma, generateSecret(), clock),
    audit,
    notifier,
    generateSecret(),
    clock,
  );
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
  clock.set(new Date('2026-09-18T06:00:00.000Z'));
});

async function staff(password = 'correct horse battery', status = 'ACTIVE') {
  const id = newId();
  const email = `Staff.${id.slice(-8)}@Example.Invalid`;
  await db.prisma.user.create({
    data: {
      id,
      email,
      emailNormalized: email.toLowerCase(),
      status,
      passwordHash: await hasher.hash(password),
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
  });
  return { id, email };
}

describe('password login', () => {
  it('logs in with a case-insensitive email and audits success', async () => {
    const u = await staff();
    const s = await auth.login(`  ${u.email.toUpperCase()} `, 'correct horse battery', meta);
    expect(await sessions.authenticate(s.access.token)).toMatchObject({
      userId: u.id,
      authnMethods: ['pwd'],
    });
    expect(
      await db.prisma.auditLog.count({ where: { action: 'AUTH_LOGIN_SUCCEEDED', actorUserId: u.id } }),
    ).toBe(1);
  });

  it('fails generically for unknown accounts, wrong passwords and disabled users; failures are audited', async () => {
    const u = await staff();
    const d = await staff('another long password', 'DISABLED');
    for (const [email, pw] of [
      ['nobody@example.invalid', 'whatever password'],
      [u.email, 'wrong password!!'],
      [d.email, 'another long password'],
    ] as const) {
      await expect(auth.login(email, pw, meta)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'UNAUTHENTICATED',
      });
    }
    const audits = await db.prisma.auditLog.findMany({ where: { action: 'AUTH_PASSWORD_FAILED' } });
    expect(audits.map((a) => (a.metadata as { reason: string }).reason).sort()).toEqual([
      'BAD_PASSWORD',
      'INACTIVE_OR_NO_PASSWORD',
      'UNKNOWN_ACCOUNT',
    ]);
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toContain('wrong password');
  });

  it('locks the account after 5 attempts in 15 minutes (429 with Retry-After), then recovers', async () => {
    const u = await staff();
    for (let i = 0; i < 5; i++) {
      await expect(
        auth.login(u.email, 'wrong password!!', { ...meta, ip: `198.51.100.${i}` }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    const locked = await auth
      .login(u.email, 'correct horse battery', { ...meta, ip: '198.51.100.99' })
      .catch((e: unknown) => e);
    expect(locked).toMatchObject({ code: 'RATE_LIMITED' });
    expect((locked as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    clock.advanceMs(31 * 60_000);
    await expect(auth.login(u.email, 'correct horse battery', meta)).resolves.toMatchObject({ userId: u.id });
  });

  it('rehashes on login when Argon2 parameters change', async () => {
    const u = await staff();
    const before = (await db.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash!;
    const stronger = new PasswordAuthService(
      db.prisma,
      new Argon2idHasher({ memoryKiB: 9216, timeCost: 1, parallelism: 1 }),
      sessions,
      new RateLimiter(db.prisma, generateSecret(), clock),
      new PrismaAuditPort(clock),
      notifier,
      generateSecret(),
      clock,
    );
    await stronger.login(u.email, 'correct horse battery', meta);
    const after = (await db.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash!;
    expect(after).not.toBe(before);
    expect(after).toContain('m=9216');
  });
});

describe('password reset', () => {
  it('delivers a single-use token, sets the password and revokes every session', async () => {
    const u = await staff();
    const s = await auth.login(u.email, 'correct horse battery', meta);
    await auth.requestReset(u.email, { locale: 'en-BD' });
    const token = notifier.latestFor(u.id)!;
    expect(token).toBeTruthy();
    expect(JSON.stringify(await db.prisma.passwordResetToken.findMany())).not.toContain(token);
    await auth.completeReset(token, 'a brand new passphrase');
    await expect(auth.completeReset(token, 'another new passphrase')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(sessions.authenticate(s.access.token)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    await expect(auth.login(u.email, 'correct horse battery', meta)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(auth.login(u.email, 'a brand new passphrase', meta)).resolves.toMatchObject({
      userId: u.id,
    });
  });

  it('does not reveal unknown accounts and expires tokens after 30 minutes', async () => {
    await expect(auth.requestReset('nobody@example.invalid', { locale: 'bn-BD' })).resolves.toBeUndefined();
    const u = await staff();
    await auth.requestReset(u.email, { locale: 'bn-BD' });
    const token = notifier.latestFor(u.id)!;
    clock.advanceMs(31 * 60_000);
    await expect(auth.completeReset(token, 'a brand new passphrase')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('enforces the password length policy', async () => {
    await expect(auth.completeReset('x', 'short')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('CsrfService (T17)', () => {
  const csrf = new CsrfService(generateSecret());
  it('binds tokens to the session and requires header == cookie', () => {
    const t = csrf.issue('session-a');
    expect(csrf.verify('session-a', t, t)).toBe(true);
    expect(csrf.verify('session-b', t, t)).toBe(false);
    expect(csrf.verify('session-a', t, csrf.issue('session-a'))).toBe(false);
    expect(csrf.verify('session-a', undefined, t)).toBe(false);
    expect(csrf.verify('session-a', 'forged.value', 'forged.value')).toBe(false);
  });
});
