/**
 * Fuzzy matching between record groups that did not share an exact record key.
 *
 * Algorithm (documented in README and DATASET-CARD):
 *   1. Blocking: only groups with the same generic-set key AND the same dosage-form family are compared.
 *   2. Score = 0.45 × JaroWinkler(brand keys)
 *            + 0.25 × strength agreement (1 if canonical strength keys are equal, else 0)
 *            + 0.30 × manufacturer agreement (1 equal key; 0.95 if one key's tokens contain the other's;
 *                                             0.9 if one side is missing; token Jaccard otherwise = conflict)
 *   3. score ≥ AUTO_MERGE_THRESHOLD (0.97) AND strength equal AND brand JW ≥ 0.96 AND no manufacturer
 *      conflict AND forms equal or one is the family parent ("Tablet" vs "SR Tablet") AND it is the only
 *      such candidate → automatic merge (match_method "fuzzy_auto").
 *   4. REVIEW_THRESHOLD (0.80) ≤ score, or several auto candidates → review_queue.jsonl, never merged.
 *   5. Second pass over the remaining groups, blocked by brand key + form family, for generic sets that differ
 *      only by spelling: ingredients are aligned by Jaro-Winkler; similarity ≥ 0.93 may auto-merge (same rules
 *      as above), 0.85–0.93 goes to review, lower is ignored.
 */
import { formRelation, type FormRelation } from './keys.js';

export const AUTO_MERGE_THRESHOLD = 0.97;
export const REVIEW_THRESHOLD = 0.8;
export const MIN_BRAND_SIMILARITY_FOR_AUTO = 0.96;

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - window); j < Math.min(b.length, i + window + 1); j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function tokenJaccard(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter(t => tb.has(t)).length;
  return inter / (ta.size + tb.size - inter);
}

export interface MatchCandidate { brandKey: string; strengthKey: string; manufacturerKey: string; form?: string }

export interface MatchScore { score: number; brand: number; strength: number; manufacturer: number; manufacturerConflict: boolean; form: FormRelation; generic?: number }

/** Second pass (same brand, different generic-set key): generic spelling similarity gates the decision. */
export const GENERIC_AUTO_SIMILARITY = 0.93;
export const GENERIC_REVIEW_SIMILARITY = 0.85;

/** Aligns ingredients greedily by Jaro-Winkler and returns the weakest pairing (0 when counts differ). */
export function genericSimilarity(a: string[], b: string[]): number {
  if (!a.length || a.length !== b.length) return 0;
  const remaining = [...b];
  let min = 1;
  for (const name of a) {
    let bestIndex = 0;
    let best = -1;
    remaining.forEach((other, i) => { const s = jaroWinkler(name, other); if (s > best) { best = s; bestIndex = i; } });
    remaining.splice(bestIndex, 1);
    min = Math.min(min, best);
  }
  return min;
}

export function scorePair(a: MatchCandidate, b: MatchCandidate): MatchScore {
  const brand = jaroWinkler(a.brandKey, b.brandKey);
  const strength = a.strengthKey === b.strengthKey ? 1 : 0;
  let manufacturer: number;
  let manufacturerConflict = false;
  if (!a.manufacturerKey || !b.manufacturerKey) manufacturer = 0.9;
  else if (a.manufacturerKey === b.manufacturerKey) manufacturer = 1;
  else if (tokenContains(a.manufacturerKey, b.manufacturerKey)) manufacturer = 0.95; // "ibn sina pharma" ⊂ "ibn sina pharma ind"
  else { manufacturer = tokenJaccard(a.manufacturerKey, b.manufacturerKey); manufacturerConflict = true; }
  const form = a.form && b.form ? formRelation(a.form, b.form) : 'equal';
  const score = Math.round((0.45 * brand + 0.25 * strength + 0.3 * manufacturer) * 10_000) / 10_000;
  return { score, brand, strength, manufacturer, manufacturerConflict, form };
}

export function tokenContains(a: string, b: string): boolean {
  const ta = a.split(' ').filter(Boolean);
  const tb = b.split(' ').filter(Boolean);
  const [small, large] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return small.length > 0 && small.every(t => large.has(t));
}

export type MatchDecision = 'auto_merge' | 'review' | 'distinct';

export function decide(s: MatchScore): MatchDecision {
  const formOk = s.form === 'equal' || s.form === 'parent';
  if (s.score >= AUTO_MERGE_THRESHOLD && s.strength === 1 && s.brand >= MIN_BRAND_SIMILARITY_FOR_AUTO && !s.manufacturerConflict && formOk) return 'auto_merge';
  if (s.score >= REVIEW_THRESHOLD && s.form !== 'different') return 'review';
  return 'distinct';
}
