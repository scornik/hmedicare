import { nameSearchTokens, skeletonSimilarity } from '@hmedic/localization';

/**
 * Duplicate scoring (audit C-41; DOMAIN-SERVICE-CONTRACTS §1 `CreatePatient`). Pure and deterministic:
 *   score = phone match 0.50 + name-skeleton Jaccard × 0.35 + DOB component (exact 0.15; |Δyear| ≤ 1 0.10;
 *   |Δyear| ≤ 2 0.05).
 * ≥ REVIEW_THRESHOLD requires a staff decision (`DUPLICATE_PATIENT_REVIEW_REQUIRED`); ≥ WARN_THRESHOLD is
 * returned as a warning. Never merges anything.
 */
export const DUPLICATE_REVIEW_THRESHOLD = 0.65;
export const DUPLICATE_WARN_THRESHOLD = 0.4;

export interface DuplicateProbe {
  legalName: string;
  legalNameBn?: string | null;
  /** E.164 phones (active contacts). */
  phones: readonly string[];
  /** ISO date `YYYY-MM-DD` or null. */
  dateOfBirth?: string | null;
  birthYear?: number | null;
}

export interface DuplicateCandidateInput extends DuplicateProbe {
  patientId: string;
}

export type DuplicateReason = 'PHONE_MATCH' | 'NAME_MATCH' | 'DOB_MATCH' | 'DOB_NEAR';

export interface DuplicateCandidate {
  patientId: string;
  /** 0–1, four decimals. */
  score: number;
  reasons: DuplicateReason[];
}

function yearOf(p: DuplicateProbe): number | null {
  if (p.dateOfBirth) {
    const y = Number(p.dateOfBirth.slice(0, 4));
    return Number.isInteger(y) ? y : null;
  }
  return p.birthYear ?? null;
}

export function scoreDuplicate(
  probe: DuplicateProbe,
  candidate: DuplicateProbe,
): { score: number; reasons: DuplicateReason[] } {
  const reasons: DuplicateReason[] = [];
  let score = 0;
  const phones = new Set(probe.phones);
  if (candidate.phones.some((p) => phones.has(p))) {
    score += 0.5;
    reasons.push('PHONE_MATCH');
  }
  const a = nameSearchTokens(probe.legalName, probe.legalNameBn).skeletons;
  const b = nameSearchTokens(candidate.legalName, candidate.legalNameBn).skeletons;
  const sim = skeletonSimilarity(a, b);
  if (sim > 0) {
    score += sim * 0.35;
    if (sim >= 0.5) reasons.push('NAME_MATCH');
  }
  if (probe.dateOfBirth && candidate.dateOfBirth && probe.dateOfBirth === candidate.dateOfBirth) {
    score += 0.15;
    reasons.push('DOB_MATCH');
  } else {
    const ya = yearOf(probe);
    const yb = yearOf(candidate);
    if (ya !== null && yb !== null) {
      const d = Math.abs(ya - yb);
      if (d <= 1) {
        score += 0.1;
        reasons.push('DOB_NEAR');
      } else if (d <= 2) {
        score += 0.05;
        reasons.push('DOB_NEAR');
      }
    }
  }
  return { score: Math.round(Math.min(1, score) * 10_000) / 10_000, reasons };
}

/** Scores every candidate, keeps those at or above the warning threshold, highest first. */
export function rankDuplicates(
  probe: DuplicateProbe,
  candidates: readonly DuplicateCandidateInput[],
): DuplicateCandidate[] {
  return candidates
    .map((c) => ({ patientId: c.patientId, ...scoreDuplicate(probe, c) }))
    .filter((c) => c.score >= DUPLICATE_WARN_THRESHOLD)
    .sort((x, y) => y.score - x.score || x.patientId.localeCompare(y.patientId));
}

export function requiresReview(candidates: readonly DuplicateCandidate[]): boolean {
  return candidates.some((c) => c.score >= DUPLICATE_REVIEW_THRESHOLD);
}
