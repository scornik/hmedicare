import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateJwtKeys, generateSecret } from '@hmedic/config/testing';
import { FixedClock } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort } from '@hmedic/audit';
import { RateLimiter } from '@hmedic/jobs';
import { JoseTokenService } from '../../src/infrastructure/token-service';
import { SessionService } from '../../src/infrastructure/session-service';
import { MockOtpDelivery, OtpService } from '../../src/infrastructure/otp-service';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

// ID-003 OTP login (AUTH §2.1, ADR-018 §4, T30). Synthetic phones only.
let db: Database;
const clock = new FixedClock(new Date('2026-09-18T06:00:00.000Z'));
const mock = new MockOtpDelivery();
let sessions: SessionService;
let otp: OtpService;
const PHONE = '01700000011';
const PHONE_E164 = '+8801700000011';

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
  otp = new OtpService(
    db.prisma,
    mock,
    sessions,
    new RateLimiter(db.prisma, generateSecret(), clock),
    audit,
    { otpPepper: generateSecret(), ttlSeconds: 180, channel: 'MOCK' },
    clock,
  );
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
  clock.set(new Date('2026-09-18T06:00:00.000Z'));
  mock.scenario = 'ACCEPTED';
  mock.sent.length = 0;
});

const request = (phone = PHONE, ip = '203.0.113.20') =>
  otp.request({ phone, purpose: 'LOGIN', locale: 'bn-BD', ip });
const verify = (code: string, phone = PHONE) =>
  otp.verifyLogin({ phone, code, clientType: 'ANDROID', ip: '203.0.113.20' });

describe('OTP login', () => {
  it('creates the user on first verify, stores only hashes, and starts an otp session', async () => {
    const r = await request();
    expect(r.hint).toBe('SENT');
    expect(r.expiresAt.getTime() - clock.now().getTime()).toBe(180_000);
    const code = mock.codeFor(r.challengeId)!;
    const rows = await db.prisma.otpChallenge.findMany();
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(JSON.stringify(rows)).not.toContain('8801700000011');
    const s = await verify(code, '+880 1700-000011');
    expect(s.isNewUser).toBe(true);
    expect(await sessions.authenticate(s.access.token)).toMatchObject({
      authnMethods: ['otp'],
      clientType: 'ANDROID',
    });
    const user = await db.prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(user).toMatchObject({ phoneE164: PHONE_E164, status: 'ACTIVE' });
    expect(user.phoneVerifiedAt).not.toBeNull();
    // The challenge is single use.
    await expect(verify(code)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    // A second login reuses the same user.
    const again = await request();
    expect((await verify(mock.codeFor(again.challengeId)!)).isNewUser).toBe(false);
  });

  it('answers identically for unknown and known phones (no enumeration)', async () => {
    const first = await request('01700000012');
    await verify(mock.codeFor(first.challengeId)!, '01700000012');
    const known = await request('01700000012', '203.0.113.21');
    const unknown = await request('01700000013', '203.0.113.21');
    expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort());
    expect(known.hint).toBe(unknown.hint);
  });

  it('locks the challenge after 5 wrong codes and the correct code then fails', async () => {
    const r = await request();
    const code = mock.codeFor(r.challengeId)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await expect(verify(wrong)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(verify(code)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await db.prisma.otpChallenge.findUniqueOrThrow({ where: { id: r.challengeId } })).status).toBe(
      'LOCKED',
    );
    const reasons = (await db.prisma.auditLog.findMany({ where: { action: 'AUTH_OTP_FAILED' } })).map(
      (a) => (a.metadata as { reason: string }).reason,
    );
    expect(reasons.filter((x) => x === 'BAD_CODE')).toHaveLength(4);
    expect(reasons).toContain('LOCKED');
  });

  it('expires after the TTL', async () => {
    const r = await request();
    clock.advanceMs(181_000);
    await expect(verify(mock.codeFor(r.challengeId)!)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('a resend creates a new challenge and supersedes the old code', async () => {
    const a = await request();
    const b = await request();
    expect(b.challengeId).not.toBe(a.challengeId);
    expect((await db.prisma.otpChallenge.findUniqueOrThrow({ where: { id: a.challengeId } })).status).toBe(
      'SUPERSEDED',
    );
    const oldCode = mock.codeFor(a.challengeId)!;
    const newCode = mock.codeFor(b.challengeId)!;
    if (oldCode !== newCode) await expect(verify(oldCode)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(verify(newCode)).resolves.toMatchObject({ clientType: 'ANDROID' });
  });

  it('UNKNOWN_OUTCOME keeps the challenge usable and never auto-resends; REJECTED expires it', async () => {
    mock.scenario = 'UNKNOWN_OUTCOME';
    const u = await request();
    expect(u.hint).toBe('MAY_ARRIVE');
    expect(mock.sent).toHaveLength(1);
    await expect(verify(mock.codeFor(u.challengeId)!)).resolves.toBeTruthy();
    mock.scenario = 'REJECTED';
    const r = await request('01700000014');
    expect(r.hint).toBe('RETRY_LATER');
    expect(mock.sent).toHaveLength(2);
    expect((await db.prisma.otpChallenge.findUniqueOrThrow({ where: { id: r.challengeId } })).status).toBe(
      'EXPIRED',
    );
  });

  it('rate-limits requests per phone (3 per 15 minutes) and rejects invalid phones', async () => {
    for (let i = 0; i < 3; i++) await request(PHONE, `198.51.100.${i}`);
    await expect(request(PHONE, '198.51.100.9')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(request('+14155550100')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [expect.objectContaining({ path: 'phone' })],
    });
  });
});
