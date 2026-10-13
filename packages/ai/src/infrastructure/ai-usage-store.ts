import { AppError, type Clock, systemClock } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import { TenantContextResolver } from '@hmedic/identity-access';
import { withTransaction } from '@hmedic/database';

/**
 * AI usage, per credential (AICRED-005, AI-IMPLEMENTATION §6.4).
 *
 * A doctor using their own key pays for it, so they need to see what has been spent. Everything here
 * is read from counters and the ledger the job runner already writes on every provider call; nothing
 * is recomputed and nothing is estimated that the provider did not report.
 *
 * `estimatedRemaining` is the one number that could mislead, so it is the one with the strictest rule:
 * it is null unless a `quota_hint` was configured for that credential, and where it is present it is
 * labelled an estimate everywhere it is shown. No provider here reports a remaining quota, so the only
 * honest basis is a number somebody entered — and a figure derived from nothing would be read as the
 * provider's own answer.
 *
 * Token counts are the provider's where it reported them and zero where it did not. A doctor comparing
 * them against a vendor's dashboard will find differences; the counts are what this system observed,
 * not a billing record.
 */
export interface AIUsageActor {
  tenantId: string;
  userId: string;
  requestId?: string;
}

export interface AICredentialUsage {
  credentialId: string;
  providerCode: string;
  declaredTier: string;
  status: string;
  requestsToday: number;
  inputTokensToday: number;
  outputTokensToday: number;
  requestsThisMinute: number;
  lastRateLimitedAt: string | null;
  retryAfterUntil: string | null;
  /** Null unless a quota hint was configured. Always presented as an estimate. */
  estimatedRemaining: number | null;
  /** Completed provider calls recorded for this credential, all time. */
  callsRecorded: number;
  errorsRecorded: number;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export class AIUsageStore {
  private readonly clock: Clock;
  constructor(private readonly deps: { prisma: PrismaClient; clock?: Clock }) {
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * Usage for one doctor's credentials.
   *
   * A doctor reads their own without any extra permission; reading someone else's needs
   * `ai.usage.read`, because what a colleague has spent on their own key is theirs to know.
   */
  async forDoctor(actor: AIUsageActor, doctorProfileId: string): Promise<AICredentialUsage[]> {
    await withTransaction(this.deps.prisma, async (tx) => {
      const context = await new TenantContextResolver(tx).resolve(actor.userId, actor.tenantId);
      if (!context || !(await tx.user.count({ where: { id: actor.userId, status: 'ACTIVE' } }))) {
        throw new AppError('FORBIDDEN');
      }
      const own = await tx.doctorProfile.findFirst({
        where: { tenantId: actor.tenantId, id: doctorProfileId, userId: actor.userId, status: 'ACTIVE' },
      });
      if (!own && !context.effectivePermissions.has('ai.usage.read')) throw new AppError('FORBIDDEN');
    });

    const now = this.clock.now();
    const dayStart = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
    const minuteStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);

    const credentials = await this.deps.prisma.aiProviderCredential.findMany({
      where: { tenantId: actor.tenantId, doctorProfileId },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
    const out: AICredentialUsage[] = [];
    for (const credential of credentials) {
      const [day, minute, calls, errors] = await Promise.all([
        this.deps.prisma.aiUsageCounter.findFirst({
          where: { credentialId: credential.id, window: 'DAY', windowStart: dayStart },
        }),
        this.deps.prisma.aiUsageCounter.findFirst({
          where: { credentialId: credential.id, window: 'MINUTE', windowStart: minuteStart },
        }),
        this.deps.prisma.aiUsageLedgerEntry.count({
          where: { tenantId: actor.tenantId, credentialId: credential.id },
        }),
        this.deps.prisma.aiUsageLedgerEntry.count({
          where: { tenantId: actor.tenantId, credentialId: credential.id, outcome: 'ERROR' },
        }),
      ]);
      // The most recent rate limit in any window, which may be older than today.
      const limited = await this.deps.prisma.aiUsageCounter.findFirst({
        where: { credentialId: credential.id, last429At: { not: null } },
        orderBy: { last429At: 'desc' },
      });
      const requestsToday = day?.requestCount ?? 0;
      out.push({
        credentialId: credential.id,
        providerCode: credential.providerCode,
        declaredTier: credential.declaredTier,
        status: credential.status,
        requestsToday,
        inputTokensToday: Number(day?.inputTokens ?? 0n),
        outputTokensToday: Number(day?.outputTokens ?? 0n),
        requestsThisMinute: minute?.requestCount ?? 0,
        lastRateLimitedAt: limited?.last429At?.toISOString() ?? null,
        retryAfterUntil:
          limited?.retryAfterUntil && limited.retryAfterUntil > now
            ? limited.retryAfterUntil.toISOString()
            : null,
        estimatedRemaining: this.estimateRemaining(credential.quotaHint, requestsToday),
        callsRecorded: calls,
        errorsRecorded: errors,
      });
    }
    return out;
  }

  /**
   * Remaining requests today, from a configured hint only.
   *
   * Null for anything else — a missing hint, a malformed one, a non-positive daily figure. A number
   * invented here would be read as the provider's own answer about a quota it never reported, and a
   * doctor planning a clinic around it would be planning around nothing.
   */
  private estimateRemaining(quotaHint: unknown, requestsToday: number): number | null {
    if (!quotaHint || typeof quotaHint !== 'object' || Array.isArray(quotaHint)) return null;
    const daily = (quotaHint as { requestsPerDay?: unknown }).requestsPerDay;
    if (typeof daily !== 'number' || !Number.isFinite(daily) || daily <= 0) return null;
    return Math.max(0, Math.floor(daily) - requestsToday);
  }
}
