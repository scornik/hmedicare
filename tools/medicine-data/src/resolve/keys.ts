import crypto from 'node:crypto';
import { genericSetKey } from '../normalize/generics.js';
import type { NormalizedFact } from '../schemas.js';

/** Brand key: NFKC, lowercase, punctuation removed, whitespace collapsed. */
export function brandKey(brand: string): string {
  return brand.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Record key = brand | generic set | strength | dosage form | manufacturer, all normalized.
 * Human-readable on purpose so review-queue entries can be read without a lookup.
 * Deviation from the five-part key: when a source explicitly states a route inside the form label
 * (DGDA "IM Injection" vs "IV Injection" are separate registrations), it is appended as "#route" so
 * distinct registered products are not merged. Route-less facts reach them only via fuzzy review.
 */
export function recordKey(fact: Pick<NormalizedFact, 'brand_name' | 'generics' | 'strength' | 'dosage_form' | 'manufacturer' | 'route'>): string {
  const base = [brandKey(fact.brand_name), genericSetKey(fact.generics), fact.strength.key, fact.dosage_form, fact.manufacturer.key].join('|');
  // Only parenteral routes distinguish registrations; oral/topical/ophthalmic are implied by the form.
  return fact.route && /^(IV|IM|SC|IV\/IM)$/i.test(fact.route) ? `${base}#${fact.route.toLowerCase()}` : base;
}

/**
 * Dosage-form families. The first form of each family is its unspecific "parent": a source that only says
 * "Tablet" may match a registry "SR Tablet" (fuzzy, with the difference recorded as a conflict), but two
 * different specific forms (SR vs chewable) are never auto-merged.
 */
const FORM_FAMILIES: string[][] = [
  ['tablet', 'modified_release_tablet', 'chewable_tablet', 'dispersible_tablet', 'effervescent_tablet', 'orally_disintegrating_tablet'],
  ['capsule', 'modified_release_capsule'],
  ['injection', 'infusion'],
  ['powder', 'powder_for_suspension', 'powder_for_solution', 'granules'],
  ['oral_solution', 'oral_liquid', 'syrup', 'elixir', 'linctus']
];
const FAMILY_OF = new Map(FORM_FAMILIES.flatMap(family => family.map(form => [form, family] as const)));

export function formFamily(form: string): string {
  return FAMILY_OF.get(form)?.[0] ?? form;
}

export type FormRelation = 'equal' | 'parent' | 'sibling' | 'different';

export function formRelation(a: string, b: string): FormRelation {
  if (a === b) return 'equal';
  const family = FAMILY_OF.get(a);
  if (!family || family !== FAMILY_OF.get(b)) return 'different';
  return a === family[0] || b === family[0] ? 'parent' : 'sibling';
}

/** Blocking key for fuzzy candidate generation: same active ingredients and same dosage-form family. */
export function blockKey(fact: Pick<NormalizedFact, 'generics' | 'dosage_form'>): string {
  return `${genericSetKey(fact.generics)}|${formFamily(fact.dosage_form)}`;
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}
