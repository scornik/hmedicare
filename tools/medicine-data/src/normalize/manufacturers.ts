import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { VOCAB_DIR } from '../config.js';

const LEGAL_SUFFIXES = new Set(['plc', 'ltd', 'limited', 'pvt', 'private', 'inc', 'co', 'company', 'corp', 'corporation', 'llc', 'bd', 'bangladesh', 'the']);
/** Spelling variants of the same word in company names. */
const WORD_SYNONYMS: Record<string, string> = {
  pharmaceuticals: 'pharma', pharmaceutical: 'pharma', pharmaceutics: 'pharma',
  laboratories: 'lab', laboratory: 'lab', labs: 'lab',
  industries: 'ind', industry: 'ind', chemicals: 'chemical', works: 'work'
};
const LEGAL_SUFFIX_RE = /\b(plc|ltd|limited|inc|llc|corporation|corp)\b\.?/i;

/**
 * Company key used for matching. Removes:
 *   - parenthetical qualifiers: "(Dhamrai Unit)", "(Suspended)", "(Veterinary)", "(Pvt.)"
 *   - a manufacturing site written after the legal suffix: "Square Pharmaceuticals PLC, Pabna"
 *   - punctuation, legal-entity suffixes, and spelling variants (Pharma = Pharmaceutical(s), Labs = Laboratories)
 * The raw name (with site and status) is always preserved in the dataset.
 */
export function manufacturerKey(raw: string): string {
  let text = raw.normalize('NFKC').replace(/\([^)]*\)/g, ' ');
  const suffix = LEGAL_SUFFIX_RE.exec(text);
  // Anything after the legal suffix is a site or division ("PLC, Pabna", "Ltd. Chandana, Gazipur").
  if (suffix && suffix.index > 0) text = text.slice(0, suffix.index + suffix[0].length);
  return text.toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ')
    .filter(word => word && !LEGAL_SUFFIXES.has(word))
    .map(word => WORD_SYNONYMS[word] ?? word)
    .join(' ');
}

export type ManufacturerRule = 'alias_table' | 'name_normalization' | 'exact';
export interface ManufacturerResolution { raw?: string; name?: string; key: string; alias_rule?: ManufacturerRule }
export interface ManufacturerResolver { resolve(raw?: string): ManufacturerResolution }

export function loadManufacturerResolver(file = path.join(VOCAB_DIR, 'manufacturers.yaml')): ManufacturerResolver {
  const doc = YAML.parse(fs.readFileSync(file, 'utf8')) as { canonical?: Record<string, string[]> };
  const aliasToCanonical = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(doc.canonical ?? {})) {
    aliasToCanonical.set(manufacturerKey(canonical), canonical);
    for (const alias of aliases ?? []) aliasToCanonical.set(manufacturerKey(alias), canonical);
  }
  return {
    resolve(raw) {
      const text = raw?.trim();
      if (!text) return { key: '' };
      const key = manufacturerKey(text);
      const canonical = aliasToCanonical.get(key);
      if (canonical) {
        const rule: ManufacturerRule = canonical === text ? 'exact' : manufacturerKey(canonical) === key ? 'name_normalization' : 'alias_table';
        return { raw: text, name: canonical, key: manufacturerKey(canonical), alias_rule: rule };
      }
      return { raw: text, name: text, key, alias_rule: 'exact' };
    }
  };
}
