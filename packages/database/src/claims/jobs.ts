import type { PrismaClient } from '../client';
import { type Tx, withTransaction } from '../tx';

/**
 * Job claim SQL (ADR-015 §2–§4). Both strategies implement the same contract:
 * - claim at most `limit` QUEUED jobs of one queue whose run_at <= now, in (priority, run_at) order;
 * - a job with a concurrency key is claimed only if a free slot 1..limit exists in job_concurrency_leases;
 * - claiming sets RUNNING, locked_by, lease and increments attempts.
 * One queue per call so the `ix_jobs_claim (queue, status, priority, run_at)` index serves ORDER BY
 * without a filesort (HOSTING-VERIFICATION §3.2: with a filesort SKIP LOCKED locks every matched row).
 */
export interface ClaimRequest {
  queue: string;
  limit: number;
  lockedBy: string;
  leaseSeconds: number;
  now: Date;
  /** Max concurrent RUNNING jobs per concurrency key (default 1). */
  concurrencyLimit?: (key: string) => number;
}

export interface ClaimedJobRow {
  id: string;
  tenantId: string | null;
  queue: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  concurrencyKey: string | null;
  correlationId: string;
  causationId: string | null;
  leaseExpiresAt: Date;
}

export const CLAIM_SELECT_SQL =
  "SELECT id, concurrency_key FROM jobs WHERE queue = ? AND status = 'QUEUED' AND run_at <= ? ORDER BY priority, run_at LIMIT ?";

async function takeConcurrencySlot(tx: Tx, key: string, jobId: string, limit: number, leaseExpires: Date) {
  for (let slot = 1; slot <= Math.max(1, limit); slot++) {
    const inserted = await tx.$executeRawUnsafe(
      'INSERT IGNORE INTO job_concurrency_leases (concurrency_key, slot_no, job_id, lease_expires_at) VALUES (?, ?, ?, ?)',
      key,
      slot,
      jobId,
      leaseExpires,
    );
    if (inserted === 1) return true;
  }
  return false;
}

async function markRunning(tx: Tx, ids: string[], req: ClaimRequest, leaseExpires: Date): Promise<number> {
  if (ids.length === 0) return 0;
  return tx.$executeRawUnsafe(
    `UPDATE jobs SET status = 'RUNNING', locked_by = ?, locked_at = ?, lease_expires_at = ?, attempts = attempts + 1, updated_at = ?
      WHERE id IN (${ids.map(() => '?').join(', ')}) AND status = 'QUEUED'`,
    req.lockedBy,
    req.now,
    leaseExpires,
    req.now,
    ...ids,
  );
}

async function loadClaimed(tx: Tx, ids: string[], lockedBy: string): Promise<ClaimedJobRow[]> {
  if (ids.length === 0) return [];
  const rows = await tx.job.findMany({ where: { id: { in: ids }, lockedBy, status: 'RUNNING' } });
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    queue: r.queue,
    type: r.type,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.maxAttempts,
    concurrencyKey: r.concurrencyKey,
    correlationId: r.correlationId,
    causationId: r.causationId,
    leaseExpiresAt: r.leaseExpiresAt as Date,
  }));
}

/** Primary strategy: SELECT … FOR UPDATE SKIP LOCKED inside a short READ COMMITTED transaction. */
export async function claimJobsSkipLocked(prisma: PrismaClient, req: ClaimRequest): Promise<ClaimedJobRow[]> {
  const leaseExpires = new Date(req.now.getTime() + req.leaseSeconds * 1000);
  return withTransaction(
    prisma,
    async (tx) => {
      const candidates = await tx.$queryRawUnsafe<Array<{ id: string; concurrency_key: string | null }>>(
        `${CLAIM_SELECT_SQL} FOR UPDATE SKIP LOCKED`,
        req.queue,
        req.now,
        req.limit,
      );
      const claimable: string[] = [];
      for (const c of candidates) {
        if (
          c.concurrency_key === null ||
          (await takeConcurrencySlot(
            tx,
            c.concurrency_key,
            c.id,
            req.concurrencyLimit?.(c.concurrency_key) ?? 1,
            leaseExpires,
          ))
        ) {
          claimable.push(c.id);
        }
      }
      await markRunning(tx, claimable, req, leaseExpires);
      return loadClaimed(tx, claimable, req.lockedBy);
    },
    { context: 'job-claim' },
  );
}

/** Fallback strategy: unlocked candidate read, then an atomic conditional update per job. */
export async function claimJobsConditional(
  prisma: PrismaClient,
  req: ClaimRequest,
): Promise<ClaimedJobRow[]> {
  const leaseExpires = new Date(req.now.getTime() + req.leaseSeconds * 1000);
  const candidates = await prisma.$queryRawUnsafe<Array<{ id: string; concurrency_key: string | null }>>(
    CLAIM_SELECT_SQL,
    req.queue,
    req.now,
    req.limit * 2,
  );
  const claimed: ClaimedJobRow[] = [];
  for (const c of candidates) {
    if (claimed.length >= req.limit) break;
    const rows = await withTransaction(
      prisma,
      async (tx) => {
        if (
          c.concurrency_key !== null &&
          !(await takeConcurrencySlot(
            tx,
            c.concurrency_key,
            c.id,
            req.concurrencyLimit?.(c.concurrency_key) ?? 1,
            leaseExpires,
          ))
        ) {
          return [];
        }
        const updated = await markRunning(tx, [c.id], req, leaseExpires);
        if (updated !== 1) {
          // Another runner won: give back the slot this transaction took.
          if (c.concurrency_key !== null) {
            await tx.$executeRawUnsafe('DELETE FROM job_concurrency_leases WHERE job_id = ?', c.id);
          }
          return [];
        }
        return loadClaimed(tx, [c.id], req.lockedBy);
      },
      { context: 'job-claim' },
    );
    claimed.push(...rows);
  }
  return claimed;
}

/** Lease heartbeat: only the holder can extend (ADR-015 §3). Returns false when the lease was lost. */
export async function extendJobLease(
  prisma: PrismaClient,
  jobId: string,
  lockedBy: string,
  now: Date,
  leaseSeconds: number,
): Promise<boolean> {
  const expires = new Date(now.getTime() + leaseSeconds * 1000);
  const n = await prisma.$executeRawUnsafe(
    "UPDATE jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND locked_by = ? AND status = 'RUNNING'",
    expires,
    now,
    jobId,
    lockedBy,
  );
  if (n === 1) {
    await prisma.$executeRawUnsafe(
      'UPDATE job_concurrency_leases SET lease_expires_at = ? WHERE job_id = ?',
      expires,
      jobId,
    );
  }
  return n === 1;
}

/** Reclaims RUNNING jobs whose lease expired: back to QUEUED, run_at = now, slot released. */
export async function reclaimExpiredJobs(prisma: PrismaClient, now: Date, limit = 100): Promise<number> {
  const expired = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    "SELECT id FROM jobs WHERE status = 'RUNNING' AND lease_expires_at < ? ORDER BY lease_expires_at LIMIT ?",
    now,
    limit,
  );
  let reclaimed = 0;
  for (const { id } of expired) {
    reclaimed += await withTransaction(
      prisma,
      async (tx) => {
        const n = await tx.$executeRawUnsafe(
          "UPDATE jobs SET status = 'QUEUED', run_at = ?, locked_by = NULL, locked_at = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'RUNNING' AND lease_expires_at < ?",
          now,
          now,
          id,
          now,
        );
        if (n === 1) await tx.$executeRawUnsafe('DELETE FROM job_concurrency_leases WHERE job_id = ?', id);
        return n;
      },
      { context: 'job-reclaim' },
    );
  }
  // Orphaned slots (job finished or reclaimed elsewhere) whose lease expired.
  await prisma.$executeRawUnsafe('DELETE FROM job_concurrency_leases WHERE lease_expires_at < ?', now);
  return reclaimed;
}

/** Releases a finished job's concurrency slot (called in the completion transaction). */
export async function releaseConcurrencySlot(tx: Tx, jobId: string): Promise<void> {
  await tx.$executeRawUnsafe('DELETE FROM job_concurrency_leases WHERE job_id = ?', jobId);
}

/** Job lag per queue: now − run_at of the oldest QUEUED job (seconds). */
export async function jobLagByQueue(prisma: PrismaClient, now: Date): Promise<Record<string, number>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ queue: string; oldest: Date }>>(
    "SELECT queue, MIN(run_at) AS oldest FROM jobs WHERE status = 'QUEUED' AND run_at <= ? GROUP BY queue",
    now,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.queue] = Math.max(0, (now.getTime() - new Date(r.oldest).getTime()) / 1000);
  return out;
}
