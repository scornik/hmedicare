import type { ChainSource } from '@hmedic/audit';

/**
 * Chain source for `VerifyAppendOnlyChains` (AI-001).
 *
 * An AI approval is the record that a named doctor read a specific suggestion and put it into a
 * patient's chart. It is the single most consequential row the AI feature writes: everything upstream
 * of it is a draft nobody has to believe, and everything downstream is clinical record. So it is
 * hash-chained like the audit log — a row edited after the fact breaks the link, and the periodic
 * verifier walks this chain beside the others.
 *
 * `approved_content_sha256` is part of the hashed input on purpose. It fixes what the doctor actually
 * attested, so a later edit of the suggestion cannot be presented as the thing that was approved.
 *
 * One chain per tenant, keyed `ai-approval:<tenantId>`.
 */
export const AI_APPROVAL_CHAIN_PREFIX = 'ai-approval:';

export interface AiApprovalHashRow {
  id: string;
  tenantId: string;
  seq: number;
  aiSuggestionId: string;
  suggestionRowVersion: number;
  approvedTarget: string;
  approvedRecordType: string;
  approvedRecordId: string;
  approvedSection: string | null;
  reviewerDoctorProfileId: string;
  attestationVersion: number;
  approvedContentSha256: string;
  approvedAt: Date;
}

/**
 * The canonical hashed input.
 *
 * Identifiers, the attested content hash and the time — never the approved content itself. A chain row
 * holding the text would be a second copy of a clinical record in a table nobody reads for care.
 */
export function approvalHashInput(row: AiApprovalHashRow): string {
  return JSON.stringify({
    id: row.id,
    tenantId: row.tenantId,
    seq: row.seq,
    aiSuggestionId: row.aiSuggestionId,
    suggestionRowVersion: row.suggestionRowVersion,
    approvedTarget: row.approvedTarget,
    approvedRecordType: row.approvedRecordType,
    approvedRecordId: row.approvedRecordId,
    approvedSection: row.approvedSection,
    reviewerDoctorProfileId: row.reviewerDoctorProfileId,
    attestationVersion: row.attestationVersion,
    approvedContentSha256: row.approvedContentSha256,
    approvedAt: row.approvedAt.toISOString(),
  });
}

export const aiApprovalChainSource: ChainSource = {
  prefix: AI_APPROVAL_CHAIN_PREFIX,
  chainType: 'ai_approval',
  async rowHashAt(prisma, checkpointKey, seq) {
    const row = await prisma.aiApproval.findFirst({
      where: { tenantId: checkpointKey.slice(AI_APPROVAL_CHAIN_PREFIX.length), seq: Number(seq) },
      select: { rowHash: true },
    });
    return row?.rowHash ?? null;
  },
  async rows(prisma, checkpointKey, afterSeq, throughSeq, limit) {
    const rows = await prisma.aiApproval.findMany({
      where: {
        tenantId: checkpointKey.slice(AI_APPROVAL_CHAIN_PREFIX.length),
        seq: { gt: Number(afterSeq), lte: Number(throughSeq) },
      },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map((row) => ({
      seq: BigInt(row.seq),
      prevRowHash: row.prevRowHash,
      rowHash: row.rowHash,
      hashInput: approvalHashInput(row),
    }));
  },
};
