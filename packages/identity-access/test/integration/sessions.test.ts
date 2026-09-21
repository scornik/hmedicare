import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateJwtKeys, generateSecret } from '@hmedic/config/testing';
import { FixedClock, newId } from '@hmedic/kernel';
import { type Database, withTransaction } from '@hmedic/database';
import { PrismaAuditPort } from '@hmedic/audit';
import { Argon2idHasher } from '../../src/infrastructure/argon2-hasher';
import { JoseTokenService } from '../../src/infrastructure/token-service';
import { SessionService } from '../../src/infrastructure/session-service';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

// ID-002 auth core: Argon2id, EdDSA access tokens, sessions, rotation, reuse detection, revocation.
let db: Database;
const clock = new FixedClock(new Date('2026-09-18T06:00:00.000Z'));
const keys = generateJwtKeys('test-kid-1');
const tokens = new JoseTokenService(
  {
    issuer: 'http://localhost:3000',
    audience: 'hmedic-api',
    ttlSeconds: 600,
    signingKeyId: keys.JWT_SIGNING_KEY_ID,
    signingPrivateKeyPem: keys.JWT_SIGNING_PRIVATE_KEY,
    verificationKeysJson: keys.JWT_VERIFICATION_KEYS,
  },
  clock,
);
let sessions: SessionService;

beforeAll(() => {
  db = openTestDatabase();
  sessions = new SessionService(
    db.prisma,
    tokens,
    {
      idleHoursWeb: 12,
      idleHoursMobile: 720,
      absoluteDaysWeb: 7,
      absoluteDaysMobile: 90,
      refreshPepper: generateSecret(),
    },
    new PrismaAuditPort(clock),
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

async function user(): Promise<string> {
  const id = newId();
  await db.prisma.user.create({
    data: {
      id,
      emailNormalized: `user-${id.slice(-8)}@example.invalid`,
      email: `user-${id.slice(-8)}@example.invalid`,
      status: 'ACTIVE',
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
  });
  return id;
}

async function login(userId: string, clientType: 'WEB' | 'ANDROID' = 'WEB') {
  const started = await withTransaction(db.prisma, (tx) =>
    sessions.start(tx, { userId, clientType, authnMethods: ['pwd'] }),
  );
  const access = await sessions.issueAccess(userId, started.sessionId);
  return { ...started, access };
}

describe('Argon2idHasher', () => {
  it('hashes with argon2id, verifies, and flags parameter changes for rehash', async () => {
    const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 });
    const hash = await hasher.hash('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(hash, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(hash, 'wrong password!')).toBe(false);
    expect(await hasher.verify('not-a-hash', 'x')).toBe(false);
    expect(hasher.needsRehash(hash)).toBe(false);
    expect(new Argon2idHasher({ memoryKiB: 9216, timeCost: 2, parallelism: 1 }).needsRehash(hash)).toBe(true);
  });
});

describe('JoseTokenService', () => {
  it('issues EdDSA tokens with sid/tv and no tenant or PHI claims', async () => {
    const issued = await tokens.issue({ userId: 'u1', sessionId: 's1', tokenVersion: 3 });
    const [header, payload] = issued.token
      .split('.')
      .slice(0, 2)
      .map((p) => JSON.parse(Buffer.from(p, 'base64url').toString()));
    expect(header).toMatchObject({ alg: 'EdDSA', kid: 'test-kid-1' });
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub', 'tv']);
    expect(await tokens.verify(issued.token)).toEqual({ userId: 'u1', sessionId: 's1', tokenVersion: 3 });
  });

  it('rejects tampering, unknown kids, other audiences and expiry', async () => {
    const issued = await tokens.issue({ userId: 'u1', sessionId: 's1', tokenVersion: 1 });
    const [h, p, s] = issued.token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), sub: 'u2' })).toString('base64url')}.${s}`;
    await expect(tokens.verify(forged)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const other = generateJwtKeys('test-kid-2');
    const foreign = new JoseTokenService({
      issuer: 'http://localhost:3000',
      audience: 'hmedic-api',
      ttlSeconds: 600,
      signingKeyId: 'test-kid-2',
      signingPrivateKeyPem: other.JWT_SIGNING_PRIVATE_KEY,
      verificationKeysJson: other.JWT_VERIFICATION_KEYS,
    });
    await expect(
      tokens.verify((await foreign.issue({ userId: 'u', sessionId: 's', tokenVersion: 1 })).token),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    clock.advanceMs(601_000);
    await expect(tokens.verify(issued.token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(tokens.verify('garbage')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('SessionService', () => {
  it('stores only hashes of refresh tokens and authenticates access tokens', async () => {
    const u = await user();
    const s = await login(u);
    const stored = await db.prisma.refreshToken.findFirstOrThrow();
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(s.refreshToken);
    expect(await sessions.authenticate(s.access.token)).toMatchObject({
      userId: u,
      sessionId: s.sessionId,
      authnMethods: ['pwd'],
      clientType: 'WEB',
    });
  });

  it('rotates on refresh and detects reuse: family + session revoked, audited, SESSION_REVOKED', async () => {
    const u = await user();
    const s = await login(u);
    const r1 = await sessions.refresh(s.refreshToken);
    expect(r1.refreshToken).not.toBe(s.refreshToken);
    const r2 = await sessions.refresh(r1.refreshToken);
    // An attacker replays the first (used) token.
    await expect(sessions.refresh(s.refreshToken)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    await expect(sessions.refresh(r2.refreshToken)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    const session = await db.prisma.session.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(session.revokeReason).toBe('REFRESH_REUSE');
    expect(await db.prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    await expect(sessions.authenticate(r2.access.token)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: 'REFRESH_REUSE' } });
    expect(audit).toMatchObject({ actorUserId: u, resourceId: s.sessionId, outcome: 'DENIED' });
  });

  it('allows only one of two concurrent refreshes with the same token', async () => {
    const u = await user();
    const s = await login(u);
    const results = await Promise.allSettled([
      sessions.refresh(s.refreshToken),
      sessions.refresh(s.refreshToken),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('enforces idle and absolute timeouts', async () => {
    const u = await user();
    const s = await login(u);
    clock.advanceMs(13 * 3_600_000); // web idle is 12 h
    await expect(sessions.refresh(s.refreshToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const m = await login(u, 'ANDROID');
    for (let i = 0, t = m.refreshToken; i < 4; i++) {
      clock.advanceMs(25 * 24 * 3_600_000);
      if (i < 3) t = (await sessions.refresh(t)).refreshToken;
      else await expect(sessions.refresh(t)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); // 90 d absolute
    }
  });

  it('logout revokes one session; logout-all revokes every session and outstanding access tokens', async () => {
    const u = await user();
    const [a, b] = [await login(u), await login(u, 'ANDROID')];
    await sessions.revoke(a.sessionId, 'LOGOUT');
    await expect(sessions.authenticate(a.access.token)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    await expect(sessions.refresh(a.refreshToken)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect(await sessions.authenticate(b.access.token)).toMatchObject({ sessionId: b.sessionId });
    await sessions.revokeAll(u, 'LOGOUT_ALL');
    await expect(sessions.authenticate(b.access.token)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect((await db.prisma.user.findUniqueOrThrow({ where: { id: u } })).tokenVersion).toBe(2);
  });

  it('rejects disabled users', async () => {
    const u = await user();
    const s = await login(u);
    await db.prisma.user.update({ where: { id: u }, data: { status: 'DISABLED' } });
    sessions.invalidate(s.sessionId);
    await expect(sessions.authenticate(s.access.token)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    await expect(sessions.refresh(s.refreshToken)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });
});
