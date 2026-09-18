import type { PrismaClient } from '../client';

/**
 * Fixed-window counters for the DB-backed rate limiter (ADR-015 §8, AUTH-IMPLEMENTATION.md §3).
 * `INSERT … ON DUPLICATE KEY UPDATE count = count + 1` is atomic per (scope, subject_hash, window_start).
 */
export async function incrementRateCounter(
  prisma: PrismaClient,
  scope: string,
  subjectHash: string,
  windowStart: Date,
  windowSeconds: number,
  expiresAt: Date,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO rate_limit_counters (scope, subject_hash, window_start, window_seconds, count, expires_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE count = count + 1`,
    scope,
    subjectHash,
    windowStart,
    windowSeconds,
    expiresAt,
  );
}

export async function readRateCounters(
  prisma: PrismaClient,
  scope: string,
  subjectHash: string,
  windowStarts: readonly Date[],
): Promise<Map<number, number>> {
  const rows = await prisma.rateLimitCounter.findMany({
    where: { scope, subjectHash, windowStart: { in: [...windowStarts] } },
    select: { windowStart: true, count: true },
  });
  return new Map(rows.map((r) => [r.windowStart.getTime(), r.count]));
}
