import { cleanText, csvRecords, parsePrice, splitGenerics, splitGenericStrength } from '../shared.js';
import type { ExtractedFact, FetchedDoc, ParseResult } from '../types.js';

/** Column resolution by header name, so a column re-order does not break parsing. */
export const COLUMN_PATTERNS = {
  form: [/dosage.?form/, /dosage.?type/, /^form$/, /^type$/],
  brand: [/^brand/, /brand.?name/, /trade/],
  generic: [/^generic/, /generic.?name/],
  strength: [/strength/, /^dosages?$/, /^dose/],
  manufacturer: [/manufactur/, /company/],
  price: [/price/],
  // V1 has "packageMark", a slug of brand+form+strength (not a pack size): deliberately not matched.
  pack: [/pack.?size/, /^pack$/]
} as const;

type Column = keyof typeof COLUMN_PATTERNS;

export function resolveColumns(header: string[]): Partial<Record<Column, string>> {
  const resolved: Partial<Record<Column, string>> = {};
  const used = new Set<string>();
  for (const [field, patterns] of Object.entries(COLUMN_PATTERNS) as Array<[Column, readonly RegExp[]]>) {
    for (const pattern of patterns) {
      const column = header.find(h => !used.has(h) && pattern.test(h));
      if (column) { resolved[field] = column; used.add(column); break; }
    }
  }
  return resolved;
}

export function parse(doc: FetchedDoc): ParseResult {
  const { header, records } = csvRecords(doc.body.toString('utf8'));
  const cols = resolveColumns(header);
  if (!cols.brand || !cols.generic) throw new Error(`Mendeley CSV header not recognized: ${header.join(' | ')}`);
  const facts: ExtractedFact[] = [];
  let skipped = 0;
  records.forEach((record, index) => {
    const brand = cleanText(record[cols.brand!]);
    let generic = cleanText(record[cols.generic!]);
    let strength = cols.strength ? cleanText(record[cols.strength]) : undefined;
    if (!brand || !generic) { skipped++; return; }
    if (!strength) {
      const split = splitGenericStrength(generic);
      generic = split.generic;
      strength = split.strength;
    }
    const generics = splitGenerics(generic);
    if (!generics.length) { skipped++; return; }
    const price = cols.price ? record[cols.price] : undefined;
    facts.push({
      source_record_id: `row-${index + 2}`,
      brand_name: brand,
      generic_names: generics,
      strength_raw: strength,
      dosage_form_raw: cols.form ? cleanText(record[cols.form]) : undefined,
      manufacturer_raw: cols.manufacturer ? cleanText(record[cols.manufacturer]) : undefined,
      pack_size_raw: cols.pack ? cleanText(record[cols.pack]) : undefined,
      pack_price_bdt: parsePrice(price),
      price_label: parsePrice(price) !== undefined ? 'Dataset price (unverified)' : undefined
    });
  });
  return { facts, skipped, warnings: skipped ? [`${skipped} rows without brand or generic`] : [] };
}
