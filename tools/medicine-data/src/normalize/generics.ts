/**
 * Generic-name normalization. The original text is always kept; salt/hydrate/pharmacopoeia
 * qualifiers move to `salt_form` only when a real active moiety remains
 * ("Metformin Hydrochloride" → metformin + hydrochloride, but "Sodium Chloride" stays whole).
 */
const SALT_WORDS = new Set([
  'hydrochloride', 'hcl', 'dihydrochloride', 'hydrobromide', 'sodium', 'potassium', 'calcium', 'magnesium', 'zinc',
  'sulphate', 'sulfate', 'maleate', 'fumarate', 'tartrate', 'bitartrate', 'citrate', 'succinate', 'mesylate',
  'mesilate', 'besylate', 'besilate', 'acetate', 'phosphate', 'dipropionate', 'propionate', 'valerate', 'butyrate',
  'furoate', 'bromide', 'chloride', 'nitrate', 'lactate', 'gluconate', 'malate', 'oxalate', 'tosylate', 'napsylate',
  'pamoate', 'embonate', 'stearate', 'palmitate', 'decanoate', 'enanthate', 'cypionate', 'benzoate', 'salicylate',
  'carbonate', 'bicarbonate', 'trihydrate', 'dihydrate', 'monohydrate', 'hemihydrate', 'sesquihydrate', 'hydrate',
  'anhydrous', 'bp', 'usp', 'inn', 'ph', 'eur', 'ip', 'micronized', 'micronised', 'tromethamine', 'meglumine',
  'disodium', 'dipotassium', 'monosodium', 'hemifumarate', 'hyclate', 'sodium,', 'as', 'base', 'dihydrogen',
  'hydrogen', 'bisulphate', 'bisulfate', 'medoxomil', 'axetil', 'pivoxil', 'proxetil', 'estolate', 'ethylsuccinate'
]);

/** Words that are the active moiety themselves when they stand with only other salt words. */
const ION_WORDS = new Set(['sodium', 'potassium', 'calcium', 'magnesium', 'zinc', 'ferrous', 'ferric', 'aluminium', 'aluminum', 'lithium', 'silver', 'copper', 'chloride', 'bicarbonate', 'carbonate', 'sulphate', 'sulfate', 'phosphate', 'citrate', 'gluconate', 'lactate', 'acetate', 'bromide', 'hydroxide', 'oxide', 'iodide', 'fluoride']);

/**
 * Ester/prodrug suffixes are treated like salts (moved to salt_form) because sources are inconsistent:
 * DGDA lists "Cefuroxime" for a brand another source calls "Cefuroxime Axetil". The original is kept.
 */
const PRODRUG = new Set<string>();

export interface NormalizedGeneric { name: string; key: string; salt_form?: string; original: string }

const SPELLING: Record<string, string> = { sulfate: 'sulphate', aluminum: 'aluminium', cephalexin: 'cefalexin', amoxycillin: 'amoxicillin', paracetamol: 'paracetamol', acetaminophen: 'paracetamol', 'valporic': 'valproic', 'femotidine': 'famotidine' };

export function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s(\-/])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function normalizeGeneric(original: string): NormalizedGeneric {
  const cleaned = original.normalize('NFKC').replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.toLowerCase().split(' ').filter(Boolean).map(w => SPELLING[w] ?? w);
  const moiety: string[] = [];
  const salts: string[] = [];
  for (const word of words) {
    if (SALT_WORDS.has(word) && !PRODRUG.has(word)) salts.push(word); else moiety.push(word);
  }
  // Nothing but salt/ion words (e.g. "Sodium Chloride", "Ferrous Sulphate", "Calcium Carbonate"): keep whole.
  const onlyIons = moiety.length === 0 || moiety.every(w => ION_WORDS.has(w));
  const keptWords = onlyIons ? words.filter(w => !['bp', 'usp', 'inn', 'ip', 'ph', 'eur'].includes(w)) : moiety;
  const saltForm = onlyIons ? undefined : salts.filter(w => !['bp', 'usp', 'inn', 'ip', 'ph', 'eur', 'as', 'base'].includes(w)).join(' ') || undefined;
  const key = keptWords.join(' ') || words.join(' ');
  return { name: titleCase(key), key, ...(saltForm ? { salt_form: saltForm } : {}), original };
}

/** Order-independent key for a set of generics. */
export function genericSetKey(generics: NormalizedGeneric[]): string {
  return [...new Set(generics.map(g => g.key))].sort().join('+');
}
