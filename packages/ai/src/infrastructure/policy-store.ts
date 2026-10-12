import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import {
  type PrismaClient,
  type Tx,
  advanceChainHead,
  lockChainHead,
  lockRow,
  withTransaction,
} from '@hmedic/database';
import { type PrismaAuditPort, computeRowHash } from '@hmedic/audit';
import { TenantContextResolver } from '@hmedic/identity-access';

/**
 * Tenant AI policy (AIPOL-001, ADR-017 §3).
 *
 * AI is off until a tenant owner turns it on, and the record of that decision is what the policy engine
 * and any later review both read. Two properties carry the weight.
 *
 * **Every change is an append-only, hash-chained event.** `tenant_ai_policy_events` keeps the before and
 * after snapshots, the reason, the actor and the time, linked by row hashes and verified by
 * `VerifyAppendOnlyChains` alongside the audit and platform-gate chains. The point is not bookkeeping:
 * "this tenant agreed their patients' data could go to a provider that may train on it" has to be a
 * claim somebody can check later, and a mutable row cannot carry that.
 *
 * **The stored decision and the effective one are reported separately.** ADR-017 §3 makes free-tier AI
 * in production depend on an open research gate: while that gate is open the policy engine forces
 * `free_tier_ai_allowed` to false regardless of what the tenant chose. This store records the choice
 * faithfully and reports both values, so the screen can say "you enabled this, and it is off because of
 * the production gate" rather than silently showing one and meaning the other.
 */
export const AI_POLICY_CHAIN_PREFIX = 'ai-policy:';

export interface AIPolicyActor {
  tenantId: string;
  userId: string;
  requestId?: string;
}

/** The fields a tenant owner may set. Everything else about a policy row is bookkeeping. */
export interface AIPolicyDecisionInput {
  aiEnabled: boolean;
  freeTierAiAllowed: boolean;
  minimizationRequiredForNoTraining: boolean;
  rawOutputRetentionDays: number;
  allowedProviderCodes: readonly string[];
  minAiConsentPolicyVersion: number;
  policyTextVersion: string;
  /** Why, in the owner's words. Recorded in the event and never defaulted. */
  reason: string;
  /** The version the caller believes it is changing, so two owners cannot overwrite each other. */
  expectedRowVersion?: number;
}

export interface AIPolicySnapshot {
  aiEnabled: boolean;
  freeTierAiAllowed: boolean;
  minimizationRequiredForNoTraining: boolean;
  rawOutputRetentionDays: number;
  allowedProviderCodes: string[];
  minAiConsentPolicyVersion: number;
  policyTextVersion: string;
}

export interface AIPolicyView extends AIPolicySnapshot {
  policyVersion: number;
  rowVersion: number;
  decidedByUserId: string | null;
  decidedAt: string | null;
  /**
   * What the policy engine will actually apply. Differs from `freeTierAiAllowed` only while the
   * production research gate is open (ADR-017 §3).
   */
  freeTierEffective: boolean;
  /** True when the stored choice is being overridden, so a screen can explain itself. */
  freeTierForcedOffByProductionGate: boolean;
}

type PolicyRow = Awaited<ReturnType<PrismaClient['tenantAiPolicy']['findFirstOrThrow']>>;

/** Defaults for a tenant that has never decided. Off, per ADR-017 §3; nothing here is permissive. */
export function defaultPolicySnapshot(policyTextVersion: string): AIPolicySnapshot {
  return {
    aiEnabled: false,
    freeTierAiAllowed: false,
    minimizationRequiredForNoTraining: true,
    rawOutputRetentionDays: 30,
    allowedProviderCodes: [],
    minAiConsentPolicyVersion: 1,
    policyTextVersion,
  };
}

const snapshotOf = (row: PolicyRow): AIPolicySnapshot => ({
  aiEnabled: row.aiEnabled,
  freeTierAiAllowed: row.freeTierAiAllowed,
  minimizationRequiredForNoTraining: row.minimizationRequiredForNoTraining,
  rawOutputRetentionDays: row.rawOutputRetentionDays,
  allowedProviderCodes: Array.isArray(row.allowedProviderCodes) ? (row.allowedProviderCodes as string[]) : [],
  minAiConsentPolicyVersion: row.minAiConsentPolicyVersion,
  policyTextVersion: row.policyTextVersion,
});

/**
 * The bytes a policy event hashes over.
 *
 * Exported so the chain source recomputes exactly what was written. Field order is explicit rather than
 * taken from the row, because a column added later must not silently change the hash of history.
 */
export function policyEventHashInput(row: {
  tenantId: string;
  seq: number;
  policyVersion: number;
  before: unknown;
  after: unknown;
  policyTextVersion: string;
  reason: string;
  actorUserId: string;
  occurredAt: Date;
}): Record<string, unknown> {
  return {
    tenantId: row.tenantId,
    seq: row.seq,
    policyVersion: row.policyVersion,
    before: row.before,
    after: row.after,
    policyTextVersion: row.policyTextVersion,
    reason: row.reason,
    actorUserId: row.actorUserId,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export interface AIPolicyStoreDeps {
  prisma: PrismaClient;
  audit: PrismaAuditPort;
  /** `APP_ENV`. */
  environment: string;
  /** `AI_FREE_TIER_PRODUCTION_GATE_CLOSED`. Open until the legal research gate closes (ADR-017 §3). */
  freeTierProductionGateClosed: boolean;
  /** Provider codes this deployment composes at all; a tenant cannot allow one that does not exist. */
  enabledProviderCodes: readonly string[];
  /** The acknowledgement text version in force, used when a tenant has never decided. */
  currentPolicyTextVersion: string;
  clock?: Clock;
}

export class TenantAIPolicyStore {
  private readonly clock: Clock;

  constructor(private readonly deps: AIPolicyStoreDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  /** True when production is running with the free-tier research gate still open (ADR-017 §3). */
  private forcedOff(): boolean {
    return this.deps.environment === 'production' && this.deps.freeTierProductionGateClosed !== true;
  }

  private view(snapshot: AIPolicySnapshot, row: PolicyRow | null): AIPolicyView {
    const forced = this.forcedOff();
    return {
      ...snapshot,
      policyVersion: row?.policyVersion ?? 0,
      rowVersion: row?.rowVersion ?? 0,
      decidedByUserId: row?.decidedByUserId ?? null,
      decidedAt: row?.decidedAt?.toISOString() ?? null,
      freeTierEffective: snapshot.freeTierAiAllowed && !forced,
      freeTierForcedOffByProductionGate: forced && snapshot.freeTierAiAllowed,
    };
  }

  /**
   * Authorizes against the live membership inside the transaction.
   *
   * Re-resolved rather than trusted from the request: a tenant owner who lost the role between opening
   * the screen and pressing save must not record a policy decision.
   */
  private async authorize(tx: Tx, actor: AIPolicyActor, permission: string): Promise<void> {
    await lockRow(tx, 'tenants', actor.tenantId);
    const membership = await tx.tenantMembership.findFirst({
      where: { tenantId: actor.tenantId, userId: actor.userId, status: 'ACTIVE' },
    });
    if (!membership) throw new AppError('FORBIDDEN');
    await lockRow(tx, 'tenant_memberships', membership.id, actor.tenantId);
    const active = await tx.user.count({ where: { id: actor.userId, status: 'ACTIVE' } });
    const context = await new TenantContextResolver(tx).resolve(actor.userId, actor.tenantId);
    if (!active || !context?.effectivePermissions.has(permission)) throw new AppError('FORBIDDEN');
  }

  /** The tenant's policy, or the defaults when it has never decided. */
  async get(actor: AIPolicyActor): Promise<AIPolicyView> {
    return withTransaction(
      this.deps.prisma,
      async (tx) => {
        await this.authorize(tx, actor, 'ai.policy.read');
        const row = await tx.tenantAiPolicy.findFirst({ where: { tenantId: actor.tenantId } });
        return this.view(
          row ? snapshotOf(row) : defaultPolicySnapshot(this.deps.currentPolicyTextVersion),
          row,
        );
      },
      { context: 'ai:policy:get' },
    );
  }

  /**
   * Records a decision and appends its event.
   *
   * The write and the event are one transaction. An event without the row it describes, or a row whose
   * change left no event, would each make the chain a record of something other than what happened.
   */
  async decide(actor: AIPolicyActor, input: AIPolicyDecisionInput): Promise<AIPolicyView> {
    const reason = input.reason.trim();
    if (!reason) {
      // A policy change with no stated reason is unreviewable, so it is refused rather than defaulted.
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [{ path: 'reason', code: 'required', message: 'validation.ai_policy_reason' }],
      });
    }
    if (input.rawOutputRetentionDays < 0 || input.rawOutputRetentionDays > 3650) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [
          { path: 'rawOutputRetentionDays', code: 'out_of_range', message: 'validation.ai_retention' },
        ],
      });
    }
    const allowed = [...new Set(input.allowedProviderCodes.map((c) => c.trim()).filter(Boolean))].sort();
    const unknown = allowed.filter((c) => !this.deps.enabledProviderCodes.includes(c));
    if (unknown.length > 0) {
      // Allowing a provider this deployment cannot compose would read as enabled and behave as absent.
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: [
          {
            path: 'allowedProviderCodes',
            code: 'invalid_enum_value',
            message: 'validation.ai_provider_unknown',
          },
        ],
      });
    }

    const now = this.clock.now();
    return withTransaction(
      this.deps.prisma,
      async (tx) => {
        await this.authorize(tx, actor, 'ai.policy.manage');

        const existing = await tx.tenantAiPolicy.findFirst({ where: { tenantId: actor.tenantId } });
        if (existing) await lockRow(tx, 'tenant_ai_policies', existing.id, actor.tenantId);
        if (
          input.expectedRowVersion !== undefined &&
          (existing?.rowVersion ?? 0) !== input.expectedRowVersion
        ) {
          throw new AppError('STALE_VERSION');
        }

        const before = existing
          ? snapshotOf(existing)
          : defaultPolicySnapshot(this.deps.currentPolicyTextVersion);
        const after: AIPolicySnapshot = {
          aiEnabled: input.aiEnabled,
          freeTierAiAllowed: input.freeTierAiAllowed,
          minimizationRequiredForNoTraining: input.minimizationRequiredForNoTraining,
          rawOutputRetentionDays: input.rawOutputRetentionDays,
          allowedProviderCodes: allowed,
          minAiConsentPolicyVersion: input.minAiConsentPolicyVersion,
          policyTextVersion: input.policyTextVersion,
        };
        const policyVersion = (existing?.policyVersion ?? 0) + 1;

        const row = existing
          ? await tx.tenantAiPolicy.update({
              where: { id: existing.id },
              data: {
                ...after,
                policyVersion,
                decidedByUserId: actor.userId,
                decidedAt: now,
                updatedAt: now,
                updatedByUserId: actor.userId,
                rowVersion: { increment: 1 },
              },
            })
          : await tx.tenantAiPolicy.create({
              data: {
                id: newId(),
                tenantId: actor.tenantId,
                ...after,
                policyVersion,
                decidedByUserId: actor.userId,
                decidedAt: now,
                createdAt: now,
                updatedAt: now,
                createdByUserId: actor.userId,
                updatedByUserId: actor.userId,
              },
            });

        await this.appendEvent(tx, actor, {
          policyVersion,
          before,
          after,
          policyTextVersion: input.policyTextVersion,
          reason,
          occurredAt: now,
        });

        await this.deps.audit.append(tx, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          actorType: 'USER',
          action: 'AI_POLICY_DECIDED',
          resourceType: 'tenant_ai_policy',
          resourceId: row.id,
          outcome: 'SUCCESS',
          requestId: actor.requestId ?? null,
          // Flags and versions only. The reason is the owner's prose and lives in the event, which is
          // the record built to hold it.
          metadata: {
            policyVersion,
            aiEnabled: after.aiEnabled,
            freeTierAiAllowed: after.freeTierAiAllowed,
            providerCount: allowed.length,
          },
        });

        return this.view(after, row);
      },
      { context: 'ai:policy:decide' },
    );
  }

  /** The tenant's decision history, newest first. */
  async events(actor: AIPolicyActor, limit = 50) {
    return withTransaction(
      this.deps.prisma,
      async (tx) => {
        await this.authorize(tx, actor, 'ai.policy.read');
        const rows = await tx.tenantAiPolicyEvent.findMany({
          where: { tenantId: actor.tenantId },
          orderBy: { seq: 'desc' },
          take: Math.min(Math.max(limit, 1), 200),
        });
        return rows.map((r) => ({
          seq: r.seq,
          policyVersion: r.policyVersion,
          before: r.before as unknown as AIPolicySnapshot,
          after: r.after as unknown as AIPolicySnapshot,
          policyTextVersion: r.policyTextVersion,
          reason: r.reason,
          actorUserId: r.actorUserId,
          occurredAt: r.occurredAt.toISOString(),
        }));
      },
      { context: 'ai:policy:events' },
    );
  }

  /**
   * Appends the next event in this tenant's chain.
   *
   * The sequence and the previous hash are read inside the caller's transaction, and the unique
   * `(tenant_id, seq)` is what makes two concurrent decisions resolve to one order rather than two
   * events claiming the same position.
   */
  private async appendEvent(
    tx: Tx,
    actor: AIPolicyActor,
    event: {
      policyVersion: number;
      before: AIPolicySnapshot;
      after: AIPolicySnapshot;
      policyTextVersion: string;
      reason: string;
      occurredAt: Date;
    },
  ): Promise<void> {
    // `lockChainHead` rather than reading `max(seq)`: it creates the checkpoint row this chain is
    // verified through, locks it for the duration, and hands back the previous hash. Allocating the
    // sequence by query instead would race two concurrent decisions into the same position, and — the
    // mistake this replaces — would leave no checkpoint at all, so `VerifyAppendOnlyChains` would skip
    // the chain silently and report a clean run over nothing.
    const chainKey = `${AI_POLICY_CHAIN_PREFIX}${actor.tenantId}`;
    const head = await lockChainHead(tx, chainKey, event.occurredAt);
    const seq = Number(head.lastSeq) + 1;
    const hashInput = policyEventHashInput({
      tenantId: actor.tenantId,
      seq,
      policyVersion: event.policyVersion,
      before: event.before,
      after: event.after,
      policyTextVersion: event.policyTextVersion,
      reason: event.reason,
      actorUserId: actor.userId,
      occurredAt: event.occurredAt,
    });
    // Null for the first row, matching every other chain here and what the verifier anchors a full run
    // against. `lockChainHead` reports the genesis constant for an empty chain; that is the checkpoint's
    // representation, not the row's.
    const prevRowHash = head.lastSeq === 0n ? null : head.lastRowHash;
    const rowHash = computeRowHash(prevRowHash, hashInput);
    await tx.tenantAiPolicyEvent.create({
      data: {
        id: newId(),
        tenantId: actor.tenantId,
        seq,
        policyVersion: event.policyVersion,
        before: event.before as never,
        after: event.after as never,
        policyTextVersion: event.policyTextVersion,
        reason: event.reason,
        actorUserId: actor.userId,
        occurredAt: event.occurredAt,
        prevRowHash,
        rowHash,
      },
    });
    await advanceChainHead(tx, head, BigInt(seq), rowHash, event.occurredAt);
  }
}
