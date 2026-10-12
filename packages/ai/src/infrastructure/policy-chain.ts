import type { ChainSource } from '@hmedic/audit';
import { AI_POLICY_CHAIN_PREFIX, policyEventHashInput } from './policy-store';

/**
 * Chain source for `VerifyAppendOnlyChains` (AIPOL-001).
 *
 * A tenant's AI policy events are the record that somebody with authority agreed their patients' data
 * could be sent to a provider — and, for a free-tier provider, to one that may train on it. That is the
 * kind of claim people revisit after something goes wrong, so it has to be checkable rather than
 * merely stored: the periodic verifier walks this chain beside the audit and platform-gate chains, and
 * a row edited afterwards breaks the hash link.
 *
 * One chain per tenant, keyed `ai-policy:<tenantId>`, because the sequence is per tenant.
 */
export const aiPolicyChainSource: ChainSource = {
  prefix: AI_POLICY_CHAIN_PREFIX,
  chainType: 'ai_policy',
  async rowHashAt(prisma, checkpointKey, seq) {
    const row = await prisma.tenantAiPolicyEvent.findFirst({
      where: { tenantId: checkpointKey.slice(AI_POLICY_CHAIN_PREFIX.length), seq: Number(seq) },
      select: { rowHash: true },
    });
    return row?.rowHash ?? null;
  },
  async rows(prisma, checkpointKey, afterSeq, throughSeq, limit) {
    const rows = await prisma.tenantAiPolicyEvent.findMany({
      where: {
        tenantId: checkpointKey.slice(AI_POLICY_CHAIN_PREFIX.length),
        seq: { gt: Number(afterSeq), lte: Number(throughSeq) },
      },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      seq: BigInt(r.seq),
      prevRowHash: r.prevRowHash,
      rowHash: r.rowHash,
      hashInput: policyEventHashInput(r),
    }));
  },
};
