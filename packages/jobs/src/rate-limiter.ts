import { createHmac } from 'node:crypto';
import { AppError, type Clock, systemClock } from '@hmedic/kernel';
import { type PrismaClient, incrementRateCounter, readRateCounters } from '@hmedic/database';
import type { Metrics } from '@hmedic/observability';

/**
 * DB-backed rate limiter (ADR-015 §8, AUTH-IMPLEMENTATION.md §3). Sliding-window approximation:
 *   estimate = count(current) + count(previous) × (1 − elapsed/window)
 * Subjects are HMAC-hashed with RATE_LIMIT_PEPPER; raw phones/IPs are never stored.
 */
export interface RateLimitRule {
  /** e.g. `otp:phone`, `login:ip`. */
  scope: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  estimate: number;
  retryAfterSeconds: number;
}

export class RateLimiter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly pepper: string,
    private readonly clock: Clock = systemClock,
    private readonly metrics?: Metrics,
  ) {}

  subjectHash(subject: string): string {
    return createHmac('sha256', this.pepper).update(subject).digest('hex');
  }

  /** Counts this attempt and decides. Attempts over the limit are still counted (abuse stays limited). */
  async consume(rule: RateLimitRule, subject: string): Promise<RateLimitDecision> {
    const now = this.clock.now().getTime();
    const windowMs = rule.windowSeconds * 1000;
    const currentStart = Math.floor(now / windowMs) * windowMs;
    const previousStart = currentStart - windowMs;
    const hash = this.subjectHash(subject);
    await incrementRateCounter(
      this.prisma,
      rule.scope,
      hash,
      new Date(currentStart),
      rule.windowSeconds,
      new Date(currentStart + 2 * windowMs),
    );
    const counts = await readRateCounters(this.prisma, rule.scope, hash, [
      new Date(currentStart),
      new Date(previousStart),
    ]);
    const elapsed = (now - currentStart) / windowMs;
    const estimate = (counts.get(currentStart) ?? 0) + (counts.get(previousStart) ?? 0) * (1 - elapsed);
    const allowed = estimate <= rule.limit;
    if (!allowed) this.metrics?.rateLimitTripped.inc({ scope: rule.scope });
    return {
      allowed,
      estimate,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((currentStart + windowMs - now) / 1000)),
    };
  }

  /** Throws 429 RATE_LIMITED with Retry-After when any rule is exceeded. */
  async enforce(
    rules: ReadonlyArray<{ rule: RateLimitRule; subject: string | null | undefined }>,
  ): Promise<void> {
    for (const { rule, subject } of rules) {
      if (!subject) continue;
      const d = await this.consume(rule, subject);
      if (!d.allowed)
        throw new AppError('RATE_LIMITED', undefined, { retryAfterSeconds: d.retryAfterSeconds });
    }
  }
}
