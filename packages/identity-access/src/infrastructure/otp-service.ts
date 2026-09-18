import { randomInt } from 'node:crypto';
import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { RateLimiter } from '@hmedic/jobs';
import type { Metrics } from '@hmedic/observability';
import { normalizeBdMobile } from '@hmedic/localization';
import type { OtpDeliveryOutcome, OtpDeliveryPort } from '../application/ports';
import { hmacHex, safeEqual } from './crypto';
import type { ClientType, RefreshedSession, SessionService } from './session-service';

export type OtpPurpose = 'LOGIN' | 'PHONE_VERIFY' | 'RECOVERY';

/** AUTH-IMPLEMENTATION §2.1 limits. */
export const OTP_LIMITS = {
  phone: { scope: 'otp:phone', limit: 3, windowSeconds: 900 },
  phoneDaily: { scope: 'otp:phone:day', limit: 10, windowSeconds: 86_400 },
  ip: { scope: 'otp:ip', limit: 20, windowSeconds: 3_600 },
  device: { scope: 'otp:device', limit: 10, windowSeconds: 3_600 },
  verifyIp: { scope: 'otp:verify:ip', limit: 30, windowSeconds: 900 },
} as const;

/** Client-facing hint; identical for existing and unknown phones (no enumeration). */
export type OtpRequestHint = 'SENT' | 'RETRY_LATER' | 'MAY_ARRIVE';

export interface OtpRequestResult {
  challengeId: string;
  expiresAt: Date;
  hint: OtpRequestHint;
}

const HINT: Record<OtpDeliveryOutcome, OtpRequestHint> = {
  ACCEPTED: 'SENT',
  REJECTED: 'RETRY_LATER',
  PROVIDER_UNAVAILABLE: 'RETRY_LATER',
  UNKNOWN_OUTCOME: 'MAY_ARRIVE',
};

function invalidPhone(): AppError {
  return new AppError('VALIDATION_FAILED', undefined, {
    fieldErrors: [{ path: 'phone', code: 'invalid_string', message: 'validation.phone_bd_mobile' }],
  });
}

/**
 * OTP login (AUTH-IMPLEMENTATION §2.1, ADR-018 §4). Codes are HMAC-hashed with the challenge id, never
 * stored or logged in plaintext, and delivered synchronously after commit (no job payload holds a code).
 * No automatic resend: a user resend is a new challenge that supersedes the pending one.
 */
export class OtpService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly delivery: OtpDeliveryPort,
    private readonly sessions: SessionService,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: PrismaAuditPort,
    private readonly config: { otpPepper: string; ttlSeconds: number; channel: 'SMS' | 'MOCK' },
    private readonly clock: Clock = systemClock,
    private readonly metrics?: Metrics,
  ) {}

  destinationHash(phoneE164: string): string {
    return hmacHex(this.config.otpPepper, 'otp-destination', phoneE164);
  }

  private codeHash(challengeId: string, code: string): string {
    return hmacHex(this.config.otpPepper, 'otp-code', challengeId, code);
  }

  async request(input: {
    phone: string;
    purpose: OtpPurpose;
    locale: 'bn-BD' | 'en-BD';
    ip?: string | undefined;
    deviceId?: string | undefined;
    ipHash?: string | null;
  }): Promise<OtpRequestResult> {
    const phoneE164 = normalizeBdMobile(input.phone);
    if (!phoneE164) throw invalidPhone();
    await this.rateLimiter.enforce([
      { rule: OTP_LIMITS.ip, subject: input.ip },
      { rule: OTP_LIMITS.device, subject: input.deviceId },
      { rule: OTP_LIMITS.phone, subject: phoneE164 },
      { rule: OTP_LIMITS.phoneDaily, subject: phoneE164 },
    ]);
    const now = this.clock.now();
    const destinationHash = this.destinationHash(phoneE164);
    const challengeId = newId();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(now.getTime() + this.config.ttlSeconds * 1000);
    await withTransaction(this.prisma, async (tx) => {
      await tx.otpChallenge.updateMany({
        where: { destinationHash, purpose: input.purpose, status: 'PENDING' },
        data: { status: 'SUPERSEDED' },
      });
      await tx.otpChallenge.create({
        data: {
          id: challengeId,
          purpose: input.purpose,
          destinationHash,
          channel: this.config.channel,
          codeHash: this.codeHash(challengeId, code),
          status: 'PENDING',
          createdAt: now,
          expiresAt,
          ipHash: input.ipHash ?? null,
        },
      });
    });
    const { outcome } = await this.delivery.send({
      challengeId,
      phoneE164,
      code,
      purpose: input.purpose,
      locale: input.locale,
      ttlSeconds: this.config.ttlSeconds,
    });
    this.metrics?.otpDelivery.inc({ outcome });
    if (outcome === 'REJECTED' || outcome === 'PROVIDER_UNAVAILABLE') {
      // Definitely not delivered: the challenge cannot be used. UNKNOWN_OUTCOME stays PENDING.
      await this.prisma.otpChallenge.updateMany({
        where: { id: challengeId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
    }
    return { challengeId, expiresAt, hint: HINT[outcome] };
  }

  /**
   * Verifies the pending LOGIN challenge for a phone, upserts the user by phone and starts a session with
   * `authn_methods=['otp']`. Every failure is a generic UNAUTHENTICATED; attempts are committed.
   */
  async verifyLogin(input: {
    phone: string;
    code: string;
    clientType: ClientType;
    deviceLabel?: string | null;
    ip?: string | undefined;
    ipHash?: string | null;
    requestId?: string;
  }): Promise<RefreshedSession & { isNewUser: boolean }> {
    const phoneE164 = normalizeBdMobile(input.phone);
    if (!phoneE164) throw invalidPhone();
    await this.rateLimiter.enforce([{ rule: OTP_LIMITS.verifyIp, subject: input.ip }]);
    const now = this.clock.now();
    const destinationHash = this.destinationHash(phoneE164);
    const pending = await this.prisma.otpChallenge.findFirst({
      where: { destinationHash, purpose: 'LOGIN', status: 'PENDING' },
      select: { id: true },
    });
    const code = /^\d{6}$/.test(input.code) ? input.code : '';
    const outcome = await withTransaction(this.prisma, async (tx) => {
      if (!pending || !(await lockRow(tx, 'otp_challenges', pending.id)))
        return { ok: false as const, reason: 'NO_CHALLENGE' };
      const ch = await tx.otpChallenge.findUniqueOrThrow({ where: { id: pending.id } });
      if (ch.status !== 'PENDING') return { ok: false as const, reason: 'NO_CHALLENGE' };
      if (ch.expiresAt <= now) {
        await tx.otpChallenge.update({ where: { id: ch.id }, data: { status: 'EXPIRED' } });
        return { ok: false as const, reason: 'EXPIRED' };
      }
      const attempts = ch.attempts + 1;
      const match = code !== '' && safeEqual(this.codeHash(ch.id, code), ch.codeHash);
      if (!match) {
        await tx.otpChallenge.update({
          where: { id: ch.id },
          data: { attempts, ...(attempts >= ch.maxAttempts ? { status: 'LOCKED' } : {}) },
        });
        return { ok: false as const, reason: attempts >= ch.maxAttempts ? 'LOCKED' : 'BAD_CODE' };
      }
      await tx.otpChallenge.update({
        where: { id: ch.id },
        data: { attempts, status: 'VERIFIED', consumedAt: now },
      });
      let user = await tx.user.findUnique({ where: { phoneE164 } });
      let isNewUser = false;
      if (!user) {
        user = await tx.user.create({
          data: {
            id: newId(),
            phoneE164,
            status: 'ACTIVE',
            phoneVerifiedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });
        isNewUser = true;
      } else if (user.status !== 'ACTIVE') {
        return { ok: false as const, reason: 'USER_INACTIVE', userId: user.id };
      } else if (!user.phoneVerifiedAt) {
        await tx.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: now, updatedAt: now } });
      }
      const started = await this.sessions.start(tx, {
        userId: user.id,
        clientType: input.clientType,
        authnMethods: ['otp'],
        ipHash: input.ipHash ?? null,
        deviceLabel: input.deviceLabel ?? null,
      });
      await this.audit.append(tx, {
        tenantId: null,
        actorUserId: user.id,
        actorType: 'USER',
        action: 'AUTH_OTP_VERIFIED',
        resourceType: 'session',
        resourceId: started.sessionId,
        outcome: 'SUCCESS',
        requestId: input.requestId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: { challengeId: ch.id, newUser: isNewUser, clientType: input.clientType },
      });
      return { ok: true as const, userId: user.id, started, isNewUser };
    });
    if (!outcome.ok) {
      await withTransaction(this.prisma, (tx) =>
        this.audit.append(tx, {
          tenantId: null,
          actorUserId: 'userId' in outcome ? (outcome.userId ?? null) : null,
          actorType: 'USER',
          action: 'AUTH_OTP_FAILED',
          resourceType: 'otp_challenge',
          resourceId: pending?.id ?? null,
          outcome: 'DENIED',
          requestId: input.requestId ?? null,
          ipHash: input.ipHash ?? null,
          metadata: { reason: outcome.reason },
        }),
      );
      throw new AppError('UNAUTHENTICATED');
    }
    const access = await this.sessions.issueAccess(outcome.userId, outcome.started.sessionId);
    return {
      ...outcome.started,
      userId: outcome.userId,
      clientType: input.clientType,
      access,
      isNewUser: outcome.isNewUser,
    };
  }
}

/**
 * Local/CI OTP delivery (AUTH §2.1 "Mock provider"): records codes in memory for the test-only inbox route
 * and simulates outcomes by scenario. Never logs codes or phones.
 */
export class MockOtpDelivery implements OtpDeliveryPort {
  private readonly inbox = new Map<string, { code: string; at: number }>();
  scenario: OtpDeliveryOutcome = 'ACCEPTED';
  readonly sent: Array<{ challengeId: string; outcome: OtpDeliveryOutcome }> = [];

  async send(message: { challengeId: string; code: string }) {
    const outcome = this.scenario;
    this.sent.push({ challengeId: message.challengeId, outcome });
    if (outcome === 'ACCEPTED' || outcome === 'UNKNOWN_OUTCOME') {
      this.inbox.set(message.challengeId, { code: message.code, at: Date.now() });
      if (this.inbox.size > 1000) this.inbox.delete(this.inbox.keys().next().value as string);
    }
    return { outcome };
  }

  /** Test/dev inbox lookup (exposed only by `GET /internal/test/otp/:challengeId` in development/test). */
  codeFor(challengeId: string): string | undefined {
    return this.inbox.get(challengeId)?.code;
  }
}
