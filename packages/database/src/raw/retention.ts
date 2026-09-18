import type { PrismaClient } from '../client';

/**
 * Bounded TTL deletes (DATABASE-IMPLEMENTATION.md §5, ADR-015 §8). Fixed statements only; callers choose
 * a rule by name, never a table or SQL fragment. Each call deletes at most `limit` rows.
 */
const DAY = 86_400_000;

type Rule = { sql: string; params: (now: Date, cfg: RetentionConfig) => unknown[] };

export interface RetentionConfig {
  jobRetentionSucceededDays: number;
  jobRetentionFailedDays: number;
  outboxRetentionDays: number;
}

export const RETENTION_RULES = {
  rate_limit_counters: {
    sql: 'DELETE FROM rate_limit_counters WHERE expires_at < ? LIMIT ?',
    params: (now) => [now],
  },
  otp_challenges: {
    sql: 'DELETE FROM otp_challenges WHERE expires_at < ? LIMIT ?',
    params: (now) => [new Date(now.getTime() - DAY)],
  },
  idempotency_records_expired: {
    sql: "DELETE FROM idempotency_records WHERE expires_at < ? AND status <> 'IN_PROGRESS' LIMIT ?",
    params: (now) => [now],
  },
  idempotency_records_orphaned: {
    sql: "DELETE FROM idempotency_records WHERE status = 'IN_PROGRESS' AND created_at < ? LIMIT ?",
    params: (now) => [new Date(now.getTime() - 3_600_000)],
  },
  sessions: {
    sql: 'DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR absolute_expires_at < ? LIMIT ?',
    params: (now) => [new Date(now.getTime() - 30 * DAY), new Date(now.getTime() - 30 * DAY)],
  },
  refresh_tokens: {
    sql: 'DELETE FROM refresh_tokens WHERE expires_at < ? LIMIT ?',
    params: (now) => [new Date(now.getTime() - 30 * DAY)],
  },
  password_reset_tokens: {
    sql: 'DELETE FROM password_reset_tokens WHERE expires_at < ? LIMIT ?',
    params: (now) => [new Date(now.getTime() - DAY)],
  },
  email_verification_tokens: {
    sql: 'DELETE FROM email_verification_tokens WHERE expires_at < ? LIMIT ?',
    params: (now) => [new Date(now.getTime() - DAY)],
  },
  jobs_succeeded: {
    sql: "DELETE FROM jobs WHERE status IN ('SUCCEEDED', 'CANCELLED') AND finished_at < ? LIMIT ?",
    params: (now, c) => [new Date(now.getTime() - c.jobRetentionSucceededDays * DAY)],
  },
  jobs_failed: {
    sql: "DELETE FROM jobs WHERE status = 'FAILED' AND finished_at < ? LIMIT ?",
    params: (now, c) => [new Date(now.getTime() - c.jobRetentionFailedDays * DAY)],
  },
  outbox_events: {
    sql: "DELETE FROM outbox_events WHERE status = 'PUBLISHED' AND published_at < ? LIMIT ?",
    params: (now, c) => [new Date(now.getTime() - c.outboxRetentionDays * DAY)],
  },
  // Append-only table with a documented retention (400 days): deletion only through this rule.
  sms_balance_snapshots: {
    sql: 'DELETE FROM sms_balance_snapshots WHERE checked_at < ? LIMIT ?',
    params: (now) => [new Date(now.getTime() - 400 * DAY)],
  },
} satisfies Record<string, Rule>;

export type RetentionRule = keyof typeof RETENTION_RULES;

export async function deleteExpiredBatch(
  prisma: PrismaClient,
  rule: RetentionRule,
  now: Date,
  cfg: RetentionConfig,
  limit = 1000,
): Promise<number> {
  const r: Rule = RETENTION_RULES[rule];
  return prisma.$executeRawUnsafe(r.sql, ...r.params(now, cfg), limit);
}
