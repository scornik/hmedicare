import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, lockRowBy, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { RateLimiter } from '@hmedic/jobs';
import type { PasswordHasherPort, PasswordResetNotifierPort } from '../application/ports';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './argon2-hasher';
import { hmacHex, randomToken } from './crypto';
import type { ClientType, RefreshedSession, SessionService } from './session-service';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** AUTH-IMPLEMENTATION §2.2 limits: 5 per 15 min per account, then a daily cap (backoff), plus per IP. */
export const LOGIN_LIMITS = {
  account: { scope: 'login:account', limit: 5, windowSeconds: 900 },
  accountDaily: { scope: 'login:account:day', limit: 20, windowSeconds: 86_400 },
  ip: { scope: 'login:ip', limit: 30, windowSeconds: 900 },
} as const;
export const RESET_LIMITS = {
  account: { scope: 'reset:account', limit: 3, windowSeconds: 3_600 },
  ip: { scope: 'reset:ip', limit: 10, windowSeconds: 3_600 },
} as const;
const RESET_TTL_MS = 30 * 60_000;

export interface LoginMeta {
  ip?: string | undefined;
  ipHash?: string | null;
  requestId?: string;
  clientType: ClientType;
  deviceLabel?: string | null;
}

/**
 * Staff/doctor password login and password reset (AUTH-IMPLEMENTATION §2.2, §2.4). Every failure is the
 * same generic `UNAUTHENTICATED`; unknown accounts still pay one Argon2 verification (no timing oracle).
 */
export class PasswordAuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly hasher: PasswordHasherPort,
    private readonly sessions: SessionService,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: PrismaAuditPort,
    private readonly resetNotifier: PasswordResetNotifierPort,
    private readonly resetPepper: string,
    private readonly clock: Clock = systemClock,
  ) {}

  private async burnVerify(password: string): Promise<void> {
    this.dummyHash ??= this.hasher.hash(randomToken(24));
    await this.hasher.verify(await this.dummyHash, password);
  }

  private async auditFailure(userId: string | null, reason: string, meta: LoginMeta) {
    await withTransaction(this.prisma, (tx) =>
      this.audit.append(tx, {
        tenantId: null,
        actorUserId: userId,
        actorType: 'USER',
        action: 'AUTH_PASSWORD_FAILED',
        resourceType: 'user',
        resourceId: userId,
        outcome: 'DENIED',
        requestId: meta.requestId ?? null,
        ipHash: meta.ipHash ?? null,
        metadata: { reason },
      }),
    );
  }

  async login(email: string, password: string, meta: LoginMeta): Promise<RefreshedSession> {
    const emailNormalized = normalizeEmail(email);
    await this.rateLimiter.enforce([
      { rule: LOGIN_LIMITS.ip, subject: meta.ip },
      { rule: LOGIN_LIMITS.account, subject: emailNormalized },
      { rule: LOGIN_LIMITS.accountDaily, subject: emailNormalized },
    ]);
    if (password.length > PASSWORD_MAX_LENGTH) throw new AppError('UNAUTHENTICATED');
    const user = await this.prisma.user.findUnique({ where: { emailNormalized } });
    if (!user?.passwordHash || user.status !== 'ACTIVE') {
      await this.burnVerify(password);
      await this.auditFailure(user?.id ?? null, user ? 'INACTIVE_OR_NO_PASSWORD' : 'UNKNOWN_ACCOUNT', meta);
      throw new AppError('UNAUTHENTICATED');
    }
    if (!(await this.hasher.verify(user.passwordHash, password))) {
      await this.auditFailure(user.id, 'BAD_PASSWORD', meta);
      throw new AppError('UNAUTHENTICATED');
    }
    const rehash = this.hasher.needsRehash(user.passwordHash) ? await this.hasher.hash(password) : null;
    const started = await withTransaction(this.prisma, async (tx) => {
      if (rehash) await tx.user.update({ where: { id: user.id }, data: { passwordHash: rehash } });
      const s = await this.sessions.start(tx, {
        userId: user.id,
        clientType: meta.clientType,
        authnMethods: ['pwd'],
        ipHash: meta.ipHash ?? null,
        deviceLabel: meta.deviceLabel ?? null,
      });
      await this.audit.append(tx, {
        tenantId: null,
        actorUserId: user.id,
        actorType: 'USER',
        action: 'AUTH_LOGIN_SUCCEEDED',
        resourceType: 'session',
        resourceId: s.sessionId,
        outcome: 'SUCCESS',
        requestId: meta.requestId ?? null,
        ipHash: meta.ipHash ?? null,
        metadata: { method: 'pwd', clientType: meta.clientType },
      });
      return s;
    });
    const access = await this.sessions.issueAccess(user.id, started.sessionId);
    return { ...started, userId: user.id, clientType: meta.clientType, access };
  }

  resetTokenHash(token: string): string {
    return hmacHex(this.resetPepper, 'password-reset', token);
  }

  /** Always resolves identically (no account enumeration); delivers a token only to eligible accounts. */
  async requestReset(email: string, meta: { ip?: string; requestId?: string; locale: 'bn-BD' | 'en-BD' }) {
    const emailNormalized = normalizeEmail(email);
    await this.rateLimiter.enforce([
      { rule: RESET_LIMITS.ip, subject: meta.ip },
      { rule: RESET_LIMITS.account, subject: emailNormalized },
    ]);
    const user = await this.prisma.user.findUnique({ where: { emailNormalized } });
    if (!user?.passwordHash || user.status !== 'ACTIVE') return;
    const now = this.clock.now();
    const token = randomToken();
    const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
    await withTransaction(this.prisma, async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      });
      await tx.passwordResetToken.create({
        data: {
          id: newId(),
          userId: user.id,
          tokenHash: this.resetTokenHash(token),
          createdAt: now,
          expiresAt,
        },
      });
      await this.audit.append(tx, {
        tenantId: null,
        actorUserId: user.id,
        actorType: 'USER',
        action: 'AUTH_PASSWORD_RESET_REQUESTED',
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'SUCCESS',
        requestId: meta.requestId ?? null,
        metadata: {},
      });
    });
    await this.resetNotifier.send({ userId: user.id, token, expiresAt, locale: meta.locale });
  }

  /** Single use, 30 min; sets the password, revokes every session and bumps token_version. */
  async completeReset(token: string, newPassword: string, meta: { requestId?: string } = {}): Promise<void> {
    if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'newPassword', code: 'too_small', message: 'validation.password_length' }],
      });
    }
    const hash = await this.hasher.hash(newPassword);
    const now = this.clock.now();
    const ok = await withTransaction(this.prisma, async (tx) => {
      const row = await lockRowBy<{ id: string; user_id: string; used_at: Date | null; expires_at: Date }>(
        tx,
        'password_reset_tokens',
        'token_hash',
        this.resetTokenHash(token),
      );
      if (!row || row.used_at || row.expires_at <= now) return false;
      await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: now } });
      await tx.user.update({
        where: { id: row.user_id },
        data: { passwordHash: hash, passwordChangedAt: now, updatedAt: now },
      });
      await this.sessions.revokeAll(row.user_id, 'PASSWORD_CHANGED', tx);
      await this.audit.append(tx, {
        tenantId: null,
        actorUserId: row.user_id,
        actorType: 'USER',
        action: 'AUTH_PASSWORD_RESET_COMPLETED',
        resourceType: 'user',
        resourceId: row.user_id,
        outcome: 'SUCCESS',
        requestId: meta.requestId ?? null,
        metadata: {},
      });
      return true;
    });
    if (!ok) throw new AppError('UNAUTHENTICATED');
  }
}

/** Local/test inbox for reset tokens (email delivery is outside Stage 4). Never logs tokens. */
export class MockPasswordResetNotifier implements PasswordResetNotifierPort {
  private readonly inbox = new Map<string, string>();
  async send(message: { userId: string; token: string }): Promise<void> {
    this.inbox.set(message.userId, message.token);
  }
  latestFor(userId: string): string | undefined {
    return this.inbox.get(userId);
  }
}

/** Deployed environments until the email adapter exists: the request succeeds, nothing is delivered. */
export class NoopPasswordResetNotifier implements PasswordResetNotifierPort {
  async send(): Promise<void> {
    /* email delivery is a later communication task */
  }
}
