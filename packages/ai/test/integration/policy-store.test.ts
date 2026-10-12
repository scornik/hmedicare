import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppError, newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort, VerifyAppendOnlyChains, auditChainSource } from '@hmedic/audit';
import {
  type AIPolicyActor,
  type AIPolicyDecisionInput,
  TenantAIPolicyStore,
  aiPolicyChainSource,
} from '../../src/public';
import { openTestDatabase, rawConnection, truncateAll } from '../../../../tests/support/db';

/**
 * Tenant AI policy (AIPOL-001, ADR-017 §3).
 *
 * The decisions worth asserting are the ones somebody would revisit after a complaint: who turned AI
 * on, whether free-tier use was allowed, and whether the record of that can be trusted. So the weight
 * here is on authorization, on the hash chain actually detecting an edit, and on the production gate
 * being reported rather than silently applied.
 */
let db: Database;
const now = new Date('2026-10-12T00:00:00Z');

function store(over: { environment?: string; gateClosed?: boolean } = {}) {
  return new TenantAIPolicyStore({
    prisma: db.prisma,
    audit: new PrismaAuditPort({ now: () => now }),
    environment: over.environment ?? 'test',
    freeTierProductionGateClosed: over.gateClosed ?? false,
    enabledProviderCodes: ['mock', 'mock_alt'],
    currentPolicyTextVersion: 'ai-terms-v1',
    clock: { now: () => now },
  });
}

beforeAll(() => {
  db = openTestDatabase();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

/**
 * A tenant with one member in the given role.
 *
 * The role, not an explicit grant list: `tenant_owner` already carries `ai.policy.manage` and
 * `clinic_admin` carries only `ai.policy.read`, so adding grants on top would test a permission set
 * nobody actually has. `CLINIC_ADMIN_CANNOT_GRANT` lists `ai.policy.manage` for the same reason.
 */
async function actor(role: 'tenant_owner' | 'clinic_admin' = 'tenant_owner'): Promise<AIPolicyActor> {
  const tenantId = newId();
  const userId = newId();
  await db.prisma.tenant.create({
    data: {
      id: tenantId,
      name: 'AI policy fixture',
      slug: `aipol-${tenantId.slice(-8)}`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@example.invalid`,
      emailNormalized: `${userId}@example.invalid`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.prisma.tenantMembership.create({
    data: {
      id: newId(),
      tenantId,
      userId,
      role,
      permissions: { grants: [] },
      clinicIds: [],
      chamberIds: [],
      status: 'ACTIVE',
      rolePermissionsVersion: 2,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { tenantId, userId, requestId: newId() };
}

const decision = (over: Partial<AIPolicyDecisionInput> = {}): AIPolicyDecisionInput => ({
  aiEnabled: true,
  freeTierAiAllowed: false,
  minimizationRequiredForNoTraining: true,
  rawOutputRetentionDays: 30,
  allowedProviderCodes: ['mock'],
  minAiConsentPolicyVersion: 1,
  policyTextVersion: 'ai-terms-v1',
  reason: 'SYNTHETIC: enabling for the pilot clinic',
  ...over,
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return (e as AppError).code;
  }
};

describe('tenant AI policy', () => {
  it('starts off for a tenant that has never decided', async () => {
    const a = await actor();
    const view = await store().get(a);

    // ADR-017 §3: the default is off, and nothing here is permissive.
    expect(view.aiEnabled).toBe(false);
    expect(view.freeTierAiAllowed).toBe(false);
    expect(view.minimizationRequiredForNoTraining).toBe(true);
    expect(view.allowedProviderCodes).toEqual([]);
    expect(view.policyVersion).toBe(0);
  });

  it('records a decision, its reason and who made it', async () => {
    const a = await actor();

    const view = await store().decide(a, decision());

    expect(view.aiEnabled).toBe(true);
    expect(view.policyVersion).toBe(1);
    expect(view.decidedByUserId).toBe(a.userId);

    const events = await store().events(a);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      seq: 1,
      policyVersion: 1,
      reason: 'SYNTHETIC: enabling for the pilot clinic',
      actorUserId: a.userId,
    });
    // The before/after pair is what makes the event reviewable on its own.
    expect(events[0]!.before.aiEnabled).toBe(false);
    expect(events[0]!.after.aiEnabled).toBe(true);
  });

  it('refuses a reader without the manage permission', async () => {
    // A clinic admin may read the policy and may not decide it.
    const a = await actor('clinic_admin');
    expect(await code(store().decide(a, decision()))).toBe('FORBIDDEN');
    expect(await db.prisma.tenantAiPolicy.count()).toBe(0);
    // Nothing recorded either: a refused decision is not a decision.
    expect(await db.prisma.tenantAiPolicyEvent.count()).toBe(0);
  });

  it('refuses a member whose membership is no longer active', async () => {
    const a = await actor();
    await db.prisma.tenantMembership.updateMany({
      where: { tenantId: a.tenantId, userId: a.userId },
      data: { status: 'SUSPENDED' },
    });
    // Re-resolved inside the transaction, so a role lost since the screen opened does not decide.
    expect(await code(store().decide(a, decision()))).toBe('FORBIDDEN');
  });

  it('refuses a decision with no reason', async () => {
    const a = await actor();
    expect(await code(store().decide(a, decision({ reason: '   ' })))).toBe('VALIDATION_FAILED');
  });

  it('refuses a provider this deployment cannot compose', async () => {
    const a = await actor();
    // Allowing an absent provider would read as enabled and behave as missing.
    expect(await code(store().decide(a, decision({ allowedProviderCodes: ['nope'] })))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('refuses a stale row version rather than overwriting another owner', async () => {
    const a = await actor();
    const first = await store().decide(a, decision());

    await store().decide(a, decision({ expectedRowVersion: first.rowVersion, reason: 'SYNTHETIC: two' }));

    expect(await code(store().decide(a, decision({ expectedRowVersion: first.rowVersion })))).toBe(
      'STALE_VERSION',
    );
  });

  it('keeps one event per decision, in order', async () => {
    const a = await actor();
    await store().decide(a, decision({ reason: 'SYNTHETIC: one' }));
    await store().decide(a, decision({ reason: 'SYNTHETIC: two', freeTierAiAllowed: true }));
    await store().decide(a, decision({ reason: 'SYNTHETIC: three', aiEnabled: false }));

    const events = await store().events(a);
    expect(events.map((e) => e.seq)).toEqual([3, 2, 1]);
    expect(events.map((e) => e.policyVersion)).toEqual([3, 2, 1]);
    // The row carries the latest; the chain carries how it got there.
    const view = await store().get(a);
    expect(view.aiEnabled).toBe(false);
    expect(view.policyVersion).toBe(3);
  });

  it('reports free tier as forced off in production while the research gate is open', async () => {
    const a = await actor();
    const production = store({ environment: 'production', gateClosed: false });

    const view = await production.decide(a, decision({ freeTierAiAllowed: true }));

    // The tenant's choice is recorded as made — the screen must not pretend they did not choose it —
    // and the effective value is false, with a flag saying why (ADR-017 §3).
    expect(view.freeTierAiAllowed).toBe(true);
    expect(view.freeTierEffective).toBe(false);
    expect(view.freeTierForcedOffByProductionGate).toBe(true);

    const closed = store({ environment: 'production', gateClosed: true });
    const after = await closed.get(a);
    expect(after.freeTierEffective).toBe(true);
    expect(after.freeTierForcedOffByProductionGate).toBe(false);
  });

  it('verifies as an intact chain, and fails once an event is edited', async () => {
    const a = await actor();
    await store().decide(a, decision({ reason: 'SYNTHETIC: one' }));
    await store().decide(a, decision({ reason: 'SYNTHETIC: two', freeTierAiAllowed: true }));

    const verifier = new VerifyAppendOnlyChains(db.prisma, [auditChainSource, aiPolicyChainSource], {
      clock: { now: () => now },
    });
    const clean = await verifier.run();
    expect(clean.every((c) => c.ok)).toBe(true);
    // The AI chain was actually walked, rather than the assertion passing on an empty list.
    expect(clean.some((c) => c.checkpointKey.startsWith('ai-policy:') && c.rows > 0)).toBe(true);

    // What the chain exists to catch: somebody rewriting the reason for a decision afterwards.
    //
    // Through a direct connection rather than Prisma, as `audit-chain.test.ts` does. The repo's own
    // `hmedic/no-append-only-mutation` rule forbids `updateMany` on this table, and that rule is right —
    // the tamper has to come from outside the application, which is also the only way it could really
    // happen.
    const conn = await rawConnection();
    try {
      await conn.query('UPDATE tenant_ai_policy_events SET reason = ? WHERE tenant_id = ? AND seq = 1', [
        'SYNTHETIC: not what was agreed',
        a.tenantId,
      ]);
    } finally {
      await conn.end();
    }

    const tampered = await new VerifyAppendOnlyChains(
      db.prisma,
      [auditChainSource, aiPolicyChainSource],
      { clock: { now: () => now } },
      // `full`, not an incremental run: the clean verification above advanced this chain's checkpoint,
      // so a default run would start past the edited row and report a chain it never looked at.
    ).run({ full: true });
    const aiChain = tampered.find((c) => c.checkpointKey.startsWith('ai-policy:'));
    expect(aiChain?.ok).toBe(false);
    expect(aiChain?.break?.seq).toBe(1n);
    expect(aiChain?.break?.reason).toBe('HASH_MISMATCH');
  });
});
