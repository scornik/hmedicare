import { z } from 'zod';
import { type Clock, systemClock } from '@hmedic/kernel';
import { type PrismaClient, withTransaction } from '@hmedic/database';
import type { Logger, Metrics } from '@hmedic/observability';
import { type JobRegistry, type JobRunner, MAINTENANCE_QUEUE, type PeriodicJob } from '@hmedic/jobs';
import { GENESIS_HASH, computeRowHash } from '../domain/chain-hash';
import { SECURITY_ACTIONS } from '../domain/audit-entry';
import type { ChainBreak, ChainVerification } from '../application/ports';
import { PrismaAuditPort, auditHashInput } from './prisma-audit';

export interface ChainRow {
  seq: bigint;
  prevRowHash: string | null;
  rowHash: string;
  hashInput: unknown;
}

/** A hash-chained table the verifier knows how to read (one per table in DATABASE-IMPLEMENTATION §4.3). */
export interface ChainSource {
  /** Checkpoint key prefix, e.g. `audit:`. */
  readonly prefix: string;
  /** Metric label. */
  readonly chainType: string;
  rowHashAt(prisma: PrismaClient, checkpointKey: string, seq: bigint): Promise<string | null>;
  rows(
    prisma: PrismaClient,
    checkpointKey: string,
    afterSeq: bigint,
    throughSeq: bigint,
    limit: number,
  ): Promise<ChainRow[]>;
}

export const auditChainSource: ChainSource = {
  prefix: 'audit:',
  chainType: 'audit',
  async rowHashAt(prisma, checkpointKey, seq) {
    const row = await prisma.auditLog.findUnique({
      where: { chainKey_seq: { chainKey: checkpointKey.slice('audit:'.length), seq } },
      select: { rowHash: true },
    });
    return row?.rowHash ?? null;
  },
  async rows(prisma, checkpointKey, afterSeq, throughSeq, limit) {
    const rows = await prisma.auditLog.findMany({
      where: { chainKey: checkpointKey.slice('audit:'.length), seq: { gt: afterSeq, lte: throughSeq } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      seq: r.seq,
      prevRowHash: r.prevRowHash,
      rowHash: r.rowHash,
      hashInput: auditHashInput(r),
    }));
  },
};

export interface VerifyOptions {
  /** Recompute from seq 1 instead of `verified_through_seq`. */
  full?: boolean;
  /** Restrict to one checkpoint key. */
  checkpointKey?: string;
  batchSize?: number;
}

/**
 * VerifyAppendOnlyChains (DATABASE-IMPLEMENTATION.md §4.3): recomputes hashes from `verified_through_seq`
 * (or from genesis with `full`). A mismatch raises INTEGRITY_CHAIN_BROKEN: metric, error log and a
 * platform-chain security audit event. Detection, not prevention (ADR-014).
 */
export class VerifyAppendOnlyChains {
  private readonly clock: Clock;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sources: readonly ChainSource[] = [auditChainSource],
    private readonly options: { clock?: Clock; logger?: Logger; metrics?: Metrics } = {},
  ) {
    this.clock = options.clock ?? systemClock;
  }

  async run(opts: VerifyOptions = {}): Promise<ChainVerification[]> {
    const checkpoints = await this.prisma.integrityChainCheckpoint.findMany({
      where: opts.checkpointKey ? { chainKey: opts.checkpointKey } : {},
      orderBy: { chainKey: 'asc' },
    });
    const results: ChainVerification[] = [];
    for (const cp of checkpoints) {
      const source = this.sources.find((s) => cp.chainKey.startsWith(s.prefix));
      if (!source) continue;
      const result = await this.verifyOne(source, cp, opts);
      results.push(result);
      if (result.ok) {
        await this.prisma.integrityChainCheckpoint.updateMany({
          where: { chainKey: cp.chainKey, verifiedThroughSeq: { lt: result.verifiedThrough } },
          data: { verifiedThroughSeq: result.verifiedThrough, verifiedAt: this.clock.now() },
        });
      } else {
        await this.reportBreak(source, result.break!);
      }
    }
    return results;
  }

  private async verifyOne(
    source: ChainSource,
    cp: { chainKey: string; lastSeq: bigint; lastRowHash: string; verifiedThroughSeq: bigint },
    opts: VerifyOptions,
  ): Promise<ChainVerification> {
    const from = opts.full ? 0n : cp.verifiedThroughSeq;
    const fail = (seq: bigint, reason: ChainBreak['reason'], rows: number): ChainVerification => ({
      checkpointKey: cp.chainKey,
      ok: false,
      verifiedFrom: from,
      verifiedThrough: seq - 1n,
      rows,
      break: { checkpointKey: cp.chainKey, seq, reason },
    });
    let prevHash: string | null = null;
    if (from > 0n) {
      prevHash = await source.rowHashAt(this.prisma, cp.chainKey, from);
      if (!prevHash) return fail(from, 'ANCHOR_MISSING', 0);
    }
    let expected = from + 1n;
    let count = 0;
    const batch = opts.batchSize ?? 500;
    for (;;) {
      const rows = await source.rows(this.prisma, cp.chainKey, expected - 1n, cp.lastSeq, batch);
      for (const row of rows) {
        if (row.seq !== expected) return fail(expected, 'SEQ_GAP', count);
        if (row.prevRowHash !== prevHash) return fail(row.seq, 'PREV_HASH_MISMATCH', count);
        if (computeRowHash(prevHash, row.hashInput) !== row.rowHash)
          return fail(row.seq, 'HASH_MISMATCH', count);
        prevHash = row.rowHash;
        expected++;
        count++;
      }
      if (rows.length < batch) break;
    }
    if (expected - 1n !== cp.lastSeq) return fail(expected, 'SEQ_GAP', count);
    if ((prevHash ?? GENESIS_HASH) !== cp.lastRowHash) return fail(cp.lastSeq, 'HEAD_MISMATCH', count);
    return {
      checkpointKey: cp.chainKey,
      ok: true,
      verifiedFrom: from,
      verifiedThrough: cp.lastSeq,
      rows: count,
    };
  }

  private async reportBreak(source: ChainSource, b: ChainBreak): Promise<void> {
    this.options.metrics?.integrityFailures.inc({ chain_type: source.chainType });
    this.options.logger?.error(
      { chainKey: b.checkpointKey, seq: b.seq.toString(), reason: b.reason },
      'INTEGRITY_CHAIN_BROKEN',
    );
    const audit = new PrismaAuditPort(this.clock);
    await withTransaction(this.prisma, (tx) =>
      audit.append(tx, {
        tenantId: null,
        actorUserId: null,
        actorType: 'SYSTEM',
        action: SECURITY_ACTIONS.INTEGRITY_CHAIN_BROKEN,
        resourceType: 'integrity_chain',
        outcome: 'FAILED',
        metadata: { chainKey: b.checkpointKey, seq: b.seq.toString(), reason: b.reason },
      }),
    );
  }
}

export const VERIFY_CHAINS_JOB = 'VerifyAppendOnlyChains';

/** Registers the daily verification job (maintenance queue). */
export function registerChainVerification(
  registry: JobRegistry,
  runner: JobRunner | null,
  verifier: VerifyAppendOnlyChains,
): PeriodicJob[] {
  registry.register({
    type: VERIFY_CHAINS_JOB,
    queue: MAINTENANCE_QUEUE,
    payloadSchema: z.object({ v: z.literal(1), window: z.number().int() }),
    maxAttempts: 3,
    leaseSeconds: 300,
    priority: 210,
  });
  runner?.handle(VERIFY_CHAINS_JOB, async () => {
    await verifier.run();
  });
  return [{ type: VERIFY_CHAINS_JOB, everyMs: 86_400_000 }];
}
