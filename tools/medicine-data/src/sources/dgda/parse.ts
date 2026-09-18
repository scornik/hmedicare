import * as cheerio from 'cheerio';
import { cleanText, csvRecords, splitGenerics, splitGenericStrength } from '../shared.js';
import type { ExtractedFact, FetchedDoc, ParseResult } from '../types.js';

const pick = (record: Record<string, string>, ...patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const key = Object.keys(record).find(k => pattern.test(k));
    if (key && record[key]) return record[key];
  }
  return undefined;
};

/** Strips HTML that DataTables cells may carry. */
const cellText = (value: unknown) => cleanText(cheerio.load(`<x>${String(value ?? '')}</x>`)('x').text());

/** Registry rows that are active-ingredient raw materials, not finished products (form is a bulk unit). */
const NON_PRODUCT_FORMS = /^(raw materials?|kg|liter|litre)$/i;

export function rowToFact(row: { company?: string; trade?: string; genericStrength?: string; form?: string; dar?: string }): ExtractedFact | null {
  if (row.form && NON_PRODUCT_FORMS.test(row.form.trim())) return null;
  const brand = cleanText(row.trade);
  const genericStrength = cleanText(row.genericStrength);
  if (!brand || !genericStrength) return null;
  const { generic, strength } = splitGenericStrength(genericStrength);
  const generics = splitGenerics(generic);
  if (!generics.length) return null;
  return {
    source_record_id: cleanText(row.dar),
    brand_name: brand,
    generic_names: generics,
    strength_raw: strength,
    dosage_form_raw: cleanText(row.form),
    manufacturer_raw: cleanText(row.company),
    registration_number: cleanText(row.dar)
  };
}

export function parse(doc: FetchedDoc): ParseResult {
  const text = doc.body.toString('utf8');
  const facts: ExtractedFact[] = [];
  let skipped = 0;
  const warnings: string[] = [];
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed) as { data?: unknown[] };
    for (const item of json.data ?? []) {
      const cells = Array.isArray(item) ? item.map(cellText) : Object.values(item as Record<string, unknown>).map(cellText);
      // Columns: SL, Company, Trade Name, Generic Name With Strength, Dosage Form, DAR No, Price
      const fact = rowToFact({ company: cells[1], trade: cells[2], genericStrength: cells[3], form: cells[4], dar: cells[5] });
      if (fact) facts.push(fact); else skipped++;
    }
    return { facts, skipped, warnings };
  }
  if (/^<(!doctype|html)/i.test(trimmed)) throw new Error('DGDA export returned HTML instead of CSV/JSON');
  const { header, records } = csvRecords(text);
  const required = [/company|manufactur/, /trade|brand/, /generic/, /dosage|form/, /dar|reg/];
  const missing = required.filter(r => !header.some(h => r.test(h)));
  if (missing.length) throw new Error(`DGDA export header not recognized: ${header.join(' | ')}`);
  for (const record of records) {
    const fact = rowToFact({
      company: pick(record, /company|manufactur/),
      trade: pick(record, /trade|brand/),
      genericStrength: pick(record, /generic/),
      form: pick(record, /dosage|form/),
      dar: pick(record, /^dar|dar no|reg/)
    });
    if (fact) facts.push(fact); else skipped++;
  }
  if (skipped) warnings.push(`${skipped} DGDA rows skipped (blank trade name/generic, or raw-material registrations)`);
  return { facts, skipped, warnings };
}
