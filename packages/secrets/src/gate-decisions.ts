import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, withTransaction } from '@hmedic/database';
import { ChainAppender, type ChainSource, PrismaAuditPort } from '@hmedic/audit';

/**
 * Risk-acceptance gates (DATABASE-IMPLEMENTATION §3.15 `platform_gate_decisions`, ADR-018 §2). Append-only,
 * hash-chained on `gate:platform`. Written only by the `ops:record-risk-decision` CLI (DB access; no HTTP
 * route). Effective state = latest row by seq for (gate, environment); the gate is closed only if that row
 * is ACCEPTED and not expired.
 */
export const GATE_CODES = ['GATE-SMS-HTTP', 'GATE-PAY-PLATFORM-COLLECTION'] as const;
export type GateCode = (typeof GATE_CODES)[number];
export type GateEnvironment = 'staging' | 'production';
export const GATE_CHAIN_KEY = 'gate:platform';

interface GateRow {
  id: string;
  seq: bigint;
  gateCode: string;
  environment: string;
  decision: string;
  ownerName: string;
  evidenceRef: string;
  notes: string | null;
  decidedBy: string;
  decidedAt: Date;
  expiresAt: Date | null;
}

export function gateHashInput(r: GateRow) {
  return {
    id: r.id,
    seq: r.seq,
    gateCode: r.gateCode,
    environment: r.environment,
    decision: r.decision,
    ownerName: r.ownerName,
    evidenceRef: r.evidenceRef,
    notes: r.notes,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    expiresAt: r.expiresAt,
  };
}

/** Chain source for VerifyAppendOnlyChains. */
export const gateChainSource: ChainSource = {
  prefix: GATE_CHAIN_KEY,
  chainType: 'gate',
  async rowHashAt(prisma, _key, seq) {
    const row = await prisma.platformGateDecision.findUnique({ where: { seq }, select: { rowHash: true } });
    return row?.rowHash ?? null;
  },
  async rows(prisma, _key, afterSeq, throughSeq, limit) {
    const rows = await prisma.platformGateDecision.findMany({
      where: { seq: { gt: afterSeq, lte: throughSeq } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      seq: r.seq,
      prevRowHash: r.prevRowHash,
      rowHash: r.rowHash,
      hashInput: gateHashInput(r),
    }));
  },
};

export interface RecordDecisionInput {
  gateCode: GateCode;
  environment: GateEnvironment;
  decision: 'ACCEPTED' | 'REVOKED';
  ownerName: string;
  evidenceRef: string;
  notes?: string | null;
  decidedBy: string;
  expiresAt?: Date | null;
}

export class GateDecisionRecorder {
  private readonly appender = new ChainAppender();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort = new PrismaAuditPort(),
    private readonly clock: Clock = systemClock,
  ) {}

  async record(input: RecordDecisionInput): Promise<{ id: string; seq: bigint }> {
    const now = this.clock.now();
    if (input.decision === 'ACCEPTED' && (!input.expiresAt || input.expiresAt <= now)) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'expiresAt', code: 'required_future', message: 'validation.gate_expiry' }],
      });
    }
    if (!input.ownerName.trim() || !input.evidenceRef.trim()) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'ownerName', code: 'required', message: 'validation.gate_owner_evidence' }],
      });
    }
    return withTransaction(this.prisma, async (tx: Tx) => {
      const base = {
        id: newId(),
        gateCode: input.gateCode,
        environment: input.environment,
        decision: input.decision,
        ownerName: input.ownerName.trim().slice(0, 120),
        evidenceRef: input.evidenceRef.trim().slice(0, 500),
        notes: input.notes?.slice(0, 1000) ?? null,
        decidedBy: input.decidedBy.slice(0, 128),
        decidedAt: new Date(Math.floor(now.getTime())),
        expiresAt: input.expiresAt ?? null,
      };
      const { slot } = await this.appender.append(
        tx,
        GATE_CHAIN_KEY,
        now,
        (s) => gateHashInput({ ...base, seq: s.seq }),
        (s, rowHash) =>
          tx.platformGateDecision.create({
            data: { ...base, seq: s.seq, prevRowHash: s.prevRowHash, rowHash },
          }),
      );
      await this.audit.append(tx, {
        tenantId: null,
        actorUserId: null,
        actorType: 'SYSTEM',
        action: 'GATE_DECISION_RECORDED',
        resourceType: 'platform_gate_decision',
        resourceId: base.id,
        outcome: 'SUCCESS',
        metadata: {
          gateCode: base.gateCode,
          environment: base.environment,
          decision: base.decision,
          expiresAt: base.expiresAt?.toISOString() ?? null,
          decidedBy: base.decidedBy,
        },
      });
      return { id: base.id, seq: slot.seq };
    });
  }
}

/** GateDecisionReader: closed iff the latest decision is ACCEPTED and unexpired; cached ≤ 60 s. */
export class GateDecisionReader {
  private readonly cache = new Map<string, { closed: boolean; until: number }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock = systemClock,
    private readonly cacheMs = 60_000,
  ) {}

  async isClosed(gateCode: GateCode, environment: GateEnvironment): Promise<boolean> {
    const key = `${gateCode}:${environment}`;
    const now = this.clock.now();
    const hit = this.cache.get(key);
    if (hit && hit.until > now.getTime()) return hit.closed;
    const latest = await this.prisma.platformGateDecision.findFirst({
      where: { gateCode, environment },
      orderBy: { seq: 'desc' },
      select: { decision: true, expiresAt: true },
    });
    const closed = latest?.decision === 'ACCEPTED' && latest.expiresAt !== null && latest.expiresAt > now;
    this.cache.set(key, { closed, until: now.getTime() + this.cacheMs });
    return closed;
  }

  invalidate(): void {
    this.cache.clear();
  }
}
