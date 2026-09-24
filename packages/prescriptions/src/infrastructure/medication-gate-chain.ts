import type { ChainSource } from '@hmedic/audit';
import { GATE_CHAIN_KEY, gateAttestationHashInput } from '../application/medication-catalog-admin';

/**
 * Chain source for `VerifyAppendOnlyChains` (MEDDATA-003).
 *
 * Gate attestations are the only reason a production import is allowed at all, so "these four rows were
 * recorded by these four people and have not been edited since" has to be a checkable claim rather than
 * a promise. The periodic verifier walks this chain alongside the audit and platform-gate chains; a row
 * rewritten in the database breaks the hash link and the verification fails, which is exactly the alarm
 * that should sound.
 */
export const medicationGateChainSource: ChainSource = {
  prefix: GATE_CHAIN_KEY,
  chainType: 'meddata_gate',
  async rowHashAt(prisma, _key, seq) {
    const row = await prisma.medicationDatasetGateAttestation.findUnique({
      where: { seq },
      select: { rowHash: true },
    });
    return row?.rowHash ?? null;
  },
  async rows(prisma, _key, afterSeq, throughSeq, limit) {
    const rows = await prisma.medicationDatasetGateAttestation.findMany({
      where: { seq: { gt: afterSeq, lte: throughSeq } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      seq: r.seq,
      prevRowHash: r.prevRowHash,
      rowHash: r.rowHash,
      hashInput: gateAttestationHashInput(r),
    }));
  },
};
