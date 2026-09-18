import { AppError, type ActorContext, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, lockRow, lockRowBy, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { AccessTokenPort, IssuedAccessToken } from '../application/ports';
import { hmacHex, randomToken } from './crypto';

export type ClientType = 'WEB' | 'ANDROID' | 'IOS';
export type AuthnMethod = 'pwd' | 'otp';
export type RevokeReason =
  'LOGOUT' | 'LOGOUT_ALL' | 'REFRESH_REUSE' | 'ADMIN' | 'PASSWORD_CHANGED' | 'EXPIRED';

export interface SessionPolicy {
  idleHoursWeb: number;
  idleHoursMobile: number;
  absoluteDaysWeb: number;
  absoluteDaysMobile: number;
  refreshPepper: string;
  /** Platform operator sessions (pwd+otp): idle minutes (AUTH §2.6, default 30) and a 12 h absolute cap. */
  operatorIdleMinutes?: number;
}

const OPERATOR_ABSOLUTE_MS = 12 * 3_600_000;

export interface StartedSession {
  sessionId: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface RefreshedSession extends StartedSession {
  userId: string;
  clientType: ClientType;
  access: IssuedAccessToken;
}

const HOUR = 3_600_000;
const STATUS_CACHE_MS = 30_000;

interface RefreshRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  family_id: string;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
}

/**
 * Sessions and refresh tokens (AUTH-IMPLEMENTATION §1, §2.3–2.5): opaque refresh tokens stored as
 * HMAC-SHA-256, rotation on every refresh, family reuse detection, idle + absolute timeouts, `token_version`
 * revocation of outstanding access tokens.
 */
export class SessionService {
  /** Positive session-status cache (≤ 30 s, no PHI), invalidated on revoke in this process. */
  private readonly statusCache = new Map<string, number>();
  private readonly cachedDetails = new Map<string, { clientType: string; authnMethods: unknown }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: AccessTokenPort,
    private readonly policy: SessionPolicy,
    private readonly audit: PrismaAuditPort,
    private readonly clock: Clock = systemClock,
  ) {}

  private windows(clientType: ClientType, now: Date) {
    const web = clientType === 'WEB';
    return {
      idle: new Date(now.getTime() + (web ? this.policy.idleHoursWeb : this.policy.idleHoursMobile) * HOUR),
      absolute: new Date(
        now.getTime() + (web ? this.policy.absoluteDaysWeb : this.policy.absoluteDaysMobile) * 24 * HOUR,
      ),
    };
  }

  hashRefreshToken(raw: string): string {
    return hmacHex(this.policy.refreshPepper, raw);
  }

  /** Creates a session and the first refresh token of a new family inside the caller's transaction. */
  async start(
    tx: Tx,
    input: {
      userId: string;
      clientType: ClientType;
      authnMethods: AuthnMethod[];
      ipHash?: string | null;
      deviceLabel?: string | null;
      /** Platform operator sessions use a short idle window and a 12 h absolute cap (AUTH §2.6). */
      overrideWindows?: { idle: Date; absolute: Date };
    },
  ): Promise<StartedSession> {
    const now = this.clock.now();
    const w = input.overrideWindows ?? this.windows(input.clientType, now);
    const sessionId = newId();
    await tx.session.create({
      data: {
        id: sessionId,
        userId: input.userId,
        clientType: input.clientType,
        deviceLabel: input.deviceLabel ?? null,
        createdAt: now,
        lastSeenAt: now,
        idleExpiresAt: w.idle,
        absoluteExpiresAt: w.absolute,
        authnMethods: input.authnMethods,
        ipHash: input.ipHash ?? null,
      },
    });
    const refreshToken = randomToken();
    await tx.refreshToken.create({
      data: {
        id: newId(),
        sessionId,
        familyId: newId(),
        tokenHash: this.hashRefreshToken(refreshToken),
        issuedAt: now,
        expiresAt: w.absolute,
      },
    });
    await tx.user.update({ where: { id: input.userId }, data: { lastLoginAt: now } });
    return { sessionId, refreshToken, refreshExpiresAt: w.absolute };
  }

  private operatorWindows(now: Date) {
    return {
      idle: new Date(now.getTime() + (this.policy.operatorIdleMinutes ?? 30) * 60_000),
      absolute: new Date(now.getTime() + OPERATOR_ABSOLUTE_MS),
    };
  }

  private async isOperatorSession(tx: Tx, userId: string, authnMethods: unknown): Promise<boolean> {
    const m = Array.isArray(authnMethods) ? authnMethods : [];
    if (!m.includes('pwd') || !m.includes('otp')) return false;
    return (await tx.platformOperator.count({ where: { userId, status: 'ACTIVE' } })) > 0;
  }

  /**
   * Adds an authentication method to an active session (OTP step-up). When the result is a platform
   * operator pwd+otp session, the operator idle window and the 12 h absolute cap apply from now on.
   */
  async addAuthnMethod(tx: Tx, sessionId: string, userId: string, method: AuthnMethod): Promise<string[]> {
    const now = this.clock.now();
    if (!(await lockRow(tx, 'sessions', sessionId))) throw new AppError('UNAUTHENTICATED');
    const session = await tx.session.findUniqueOrThrow({ where: { id: sessionId } });
    if (session.userId !== userId || session.revokedAt || session.idleExpiresAt <= now) {
      throw new AppError('UNAUTHENTICATED');
    }
    const current = Array.isArray(session.authnMethods) ? (session.authnMethods as string[]) : [];
    const methods = [...new Set([...current, method])].sort();
    const operator = await this.isOperatorSession(tx, userId, methods);
    const w = operator ? this.operatorWindows(now) : null;
    await tx.session.update({
      where: { id: sessionId },
      data: {
        authnMethods: methods,
        lastSeenAt: now,
        ...(w
          ? {
              idleExpiresAt: w.idle,
              absoluteExpiresAt:
                w.absolute < session.absoluteExpiresAt ? w.absolute : session.absoluteExpiresAt,
            }
          : {}),
      },
    });
    if (w) {
      await tx.refreshToken.updateMany({
        where: { sessionId, revokedAt: null, usedAt: null, expiresAt: { gt: w.absolute } },
        data: { expiresAt: w.absolute },
      });
    }
    this.invalidate(sessionId);
    return methods;
  }

  /** Session of a refresh token without rotating it (web CSRF is verified against it first). */
  async peekSessionId(rawToken: string): Promise<string | null> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashRefreshToken(rawToken) },
      select: { sessionId: true },
    });
    return row?.sessionId ?? null;
  }

  async issueAccess(userId: string, sessionId: string): Promise<IssuedAccessToken> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    return this.tokens.issue({ userId, sessionId, tokenVersion: user.tokenVersion });
  }

  /**
   * Rotates a refresh token. Reuse of a used/revoked token revokes the whole family and the session,
   * audits `REFRESH_REUSE`, and fails with SESSION_REVOKED (the revocation commits before the error).
   */
  async refresh(rawToken: string, meta: { requestId?: string } = {}): Promise<RefreshedSession> {
    const now = this.clock.now();
    const hash = this.hashRefreshToken(rawToken);
    const outcome = await withTransaction(
      this.prisma,
      async (tx) => {
        const row = await lockRowBy<RefreshRow>(tx, 'refresh_tokens', 'token_hash', hash);
        if (!row) return { kind: 'invalid' as const };
        await lockRow(tx, 'sessions', row.session_id);
        const session = await tx.session.findUniqueOrThrow({ where: { id: row.session_id } });
        if (row.used_at || row.revoked_at) {
          await tx.refreshToken.updateMany({
            where: { familyId: row.family_id, revokedAt: null },
            data: { revokedAt: now },
          });
          if (!session.revokedAt) {
            await tx.session.update({
              where: { id: session.id },
              data: { revokedAt: now, revokeReason: 'REFRESH_REUSE' },
            });
          }
          await this.audit.append(tx, {
            tenantId: null,
            actorUserId: session.userId,
            actorType: 'USER',
            action: 'REFRESH_REUSE',
            resourceType: 'session',
            resourceId: session.id,
            outcome: 'DENIED',
            requestId: meta.requestId ?? null,
            metadata: { familyId: row.family_id },
          });
          return { kind: 'reuse' as const, sessionId: session.id };
        }
        if (session.revokedAt) return { kind: 'revoked' as const };
        if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now || row.expires_at <= now) {
          return { kind: 'expired' as const };
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: session.userId } });
        if (user.status !== 'ACTIVE') return { kind: 'revoked' as const };

        const next = randomToken();
        const nextId = newId();
        const w = (await this.isOperatorSession(tx, session.userId, session.authnMethods))
          ? this.operatorWindows(now)
          : this.windows(session.clientType as ClientType, now);
        const idle = w.idle < session.absoluteExpiresAt ? w.idle : session.absoluteExpiresAt;
        await tx.refreshToken.create({
          data: {
            id: nextId,
            sessionId: session.id,
            familyId: row.family_id,
            tokenHash: this.hashRefreshToken(next),
            issuedAt: now,
            expiresAt: session.absoluteExpiresAt,
          },
        });
        await tx.refreshToken.update({ where: { id: row.id }, data: { usedAt: now, replacedById: nextId } });
        await tx.session.update({
          where: { id: session.id },
          data: { lastSeenAt: now, idleExpiresAt: idle },
        });
        return {
          kind: 'ok' as const,
          userId: user.id,
          tokenVersion: user.tokenVersion,
          sessionId: session.id,
          clientType: session.clientType as ClientType,
          refreshToken: next,
          refreshExpiresAt: session.absoluteExpiresAt,
        };
      },
      { context: 'session-refresh' },
    );
    if (outcome.kind === 'reuse') {
      this.invalidate(outcome.sessionId);
      throw new AppError('SESSION_REVOKED');
    }
    if (outcome.kind === 'revoked') throw new AppError('SESSION_REVOKED');
    if (outcome.kind !== 'ok') throw new AppError('UNAUTHENTICATED');
    const access = await this.tokens.issue({
      userId: outcome.userId,
      sessionId: outcome.sessionId,
      tokenVersion: outcome.tokenVersion,
    });
    return {
      userId: outcome.userId,
      sessionId: outcome.sessionId,
      clientType: outcome.clientType,
      refreshToken: outcome.refreshToken,
      refreshExpiresAt: outcome.refreshExpiresAt,
      access,
    };
  }

  /** Revokes one session and its refresh tokens (logout, device revoke). */
  async revoke(sessionId: string, reason: RevokeReason, tx?: Tx): Promise<void> {
    const now = this.clock.now();
    const run = async (t: Tx) => {
      await t.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: now, revokeReason: reason },
      });
      await t.refreshToken.updateMany({ where: { sessionId, revokedAt: null }, data: { revokedAt: now } });
    };
    if (tx) await run(tx);
    else await withTransaction(this.prisma, run);
    this.invalidate(sessionId);
  }

  /** Revokes every session of a user and bumps `token_version` (invalidates outstanding access tokens). */
  async revokeAll(userId: string, reason: RevokeReason, tx?: Tx): Promise<void> {
    const now = this.clock.now();
    const run = async (t: Tx) => {
      const sessions = await t.session.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
      await t.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokeReason: reason },
      });
      if (sessions.length) {
        await t.refreshToken.updateMany({
          where: { sessionId: { in: sessions.map((s) => s.id) }, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      await t.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 }, rowVersion: { increment: 1 }, updatedAt: now },
      });
      for (const s of sessions) this.invalidate(s.id);
    };
    if (tx) await run(tx);
    else await withTransaction(this.prisma, run);
  }

  /**
   * Request authentication (AUTH §2.5): verify the JWT, then check the session (active, within idle and
   * absolute windows) and the user's `token_version` with one indexed query.
   */
  async authenticate(accessToken: string): Promise<ActorContext> {
    const claims = await this.tokens.verify(accessToken);
    const now = this.clock.now();
    const cacheKey = `${claims.sessionId}:${claims.tokenVersion}`;
    const cachedUntil = this.statusCache.get(cacheKey);
    let session: { clientType: string; authnMethods: unknown } | null = null;
    if (cachedUntil === undefined || cachedUntil < now.getTime()) {
      const row = await this.prisma.session.findFirst({
        where: { id: claims.sessionId, userId: claims.userId },
        select: {
          clientType: true,
          authnMethods: true,
          revokedAt: true,
          idleExpiresAt: true,
          absoluteExpiresAt: true,
        },
      });
      if (!row || row.idleExpiresAt <= now || row.absoluteExpiresAt <= now) {
        this.statusCache.delete(cacheKey);
        throw new AppError('UNAUTHENTICATED');
      }
      const user = await this.prisma.user.findFirst({
        where: { id: claims.userId },
        select: { status: true, tokenVersion: true },
      });
      // Revoked session, logout-all/password change (token_version bump) or disabled user: the client must
      // drop local session data (MOBILE-IMPLEMENTATION §2).
      if (row.revokedAt || !user || user.status !== 'ACTIVE' || user.tokenVersion !== claims.tokenVersion) {
        this.statusCache.delete(cacheKey);
        throw new AppError('SESSION_REVOKED');
      }
      session = row;
      this.statusCache.set(cacheKey, now.getTime() + STATUS_CACHE_MS);
      this.cachedDetails.set(claims.sessionId, row);
    } else {
      session = this.cachedDetails.get(claims.sessionId) ?? null;
      if (!session) {
        this.statusCache.delete(cacheKey);
        return this.authenticate(accessToken);
      }
    }
    return {
      userId: claims.userId as ActorContext['userId'],
      sessionId: claims.sessionId as ActorContext['sessionId'],
      authnMethods: Array.isArray(session.authnMethods) ? (session.authnMethods as string[]) : [],
      clientType: session.clientType as ActorContext['clientType'],
    };
  }

  /** Drops cached status for a session (called by revoke paths in this process). */
  invalidate(sessionId: string): void {
    for (const key of this.statusCache.keys())
      if (key.startsWith(`${sessionId}:`)) this.statusCache.delete(key);
    this.cachedDetails.delete(sessionId);
  }
}
