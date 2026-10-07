import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError, type Clock, systemClock } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import type { RateLimiter } from '@hmedic/jobs';

/**
 * Document download tokens (FILE-STORAGE-IMPLEMENTATION.md §2.5, ADR-016).
 *
 * A clinical file is never reachable by URL alone. Authorization happens when the token is issued, and
 * the token then carries exactly what was authorized: this tenant, this actor, this document, this
 * revision, until this moment. It is an HMAC over those fields, so there is nothing to look up and
 * nothing to forge.
 *
 * Four properties, each there because its absence is a real leak:
 *
 * - **Bound to the actor.** A token handed to someone else does not work, so a link pasted into a chat
 *   is useless to whoever reads it.
 * - **Bound to the revision.** A document that gains a revision does not retroactively expose the new
 *   one through an old link, and an old link keeps serving the bytes it was issued for.
 * - **Short lived.** Sixty seconds by default: long enough for a browser to follow a redirect, too
 *   short to be worth saving.
 * - **Single use.** Tracked in the rate-limit counters, which already exist and already expire, rather
 *   than in a new table that would need its own cleanup job.
 *
 * The token is compared with `timingSafeEqual`, and every rejection returns the same error. A caller
 * cannot learn whether a token was expired, replayed or simply wrong — those differences would let
 * someone probe for a valid one.
 */
export const DOWNLOAD_TOKEN_USED = { scope: 'download-token:used', limit: 1 } as const;

export interface DownloadTokenClaims {
  tenantId: string;
  actorUserId: string;
  documentId: string;
  revision: number;
}

export interface DownloadTokenDeps {
  prisma: PrismaClient;
  rateLimiter: RateLimiter;
  /** `DOWNLOAD_TOKEN_SECRET`. */
  secret: string | undefined;
  /** `DOWNLOAD_TOKEN_TTL_SECONDS`. */
  ttlSeconds: number;
  clock?: Clock;
}

/** `<expiry seconds>.<hmac>`; the claims are re-supplied by the caller and re-signed to check. */
const TOKEN_RE = /^(\d{10,13})\.([0-9a-f]{64})$/;

export class DownloadTokenService {
  private readonly clock: Clock;

  constructor(private readonly deps: DownloadTokenDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  private secret(): string {
    if (!this.deps.secret) {
      // Refused rather than defaulted: a predictable signing key is the same as no signature. Reported
      // as a disabled feature, which is what it is from a caller's side — this deployment cannot serve
      // documents — rather than as an internal error they can do nothing about.
      throw new AppError('FEATURE_DISABLED');
    }
    return this.deps.secret;
  }

  private sign(claims: DownloadTokenClaims, expiresAtSeconds: number): string {
    return createHmac('sha256', this.secret())
      .update(
        [
          claims.tenantId,
          claims.actorUserId,
          claims.documentId,
          String(claims.revision),
          String(expiresAtSeconds),
        ].join('|'),
      )
      .digest('hex');
  }

  /** Issues a token. The caller has already checked that this actor may read this document. */
  issue(claims: DownloadTokenClaims): { token: string; expiresAt: Date } {
    const expiresAtSeconds = Math.floor(this.clock.now().getTime() / 1000) + this.deps.ttlSeconds;
    return {
      token: `${expiresAtSeconds}.${this.sign(claims, expiresAtSeconds)}`,
      expiresAt: new Date(expiresAtSeconds * 1000),
    };
  }

  /**
   * Verifies and spends a token. Throws the same `UNAUTHENTICATED` for every failure.
   *
   * Spending happens after the signature checks out, so a wrong token cannot be used to burn a real
   * one's single use.
   */
  async redeem(token: string, claims: DownloadTokenClaims): Promise<void> {
    const match = TOKEN_RE.exec(token);
    if (!match) throw new AppError('UNAUTHENTICATED');
    const expiresAtSeconds = Number(match[1]);
    const presented = Buffer.from(match[2]!, 'hex');

    if (expiresAtSeconds * 1000 <= this.clock.now().getTime()) throw new AppError('UNAUTHENTICATED');

    const expected = Buffer.from(this.sign(claims, expiresAtSeconds), 'hex');
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw new AppError('UNAUTHENTICATED');
    }

    // Single use. The window is the token's own remaining life, so the counter expires on its own and
    // there is nothing to clean up.
    const remaining = Math.max(1, expiresAtSeconds - Math.floor(this.clock.now().getTime() / 1000));
    const decision = await this.deps.rateLimiter.consume(
      { scope: DOWNLOAD_TOKEN_USED.scope, limit: DOWNLOAD_TOKEN_USED.limit, windowSeconds: remaining },
      token,
    );
    if (!decision.allowed) throw new AppError('UNAUTHENTICATED');
  }
}
