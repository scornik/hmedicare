/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(cell => cell !== '')) rows.push(row);
  return rows;
}

/** Sniffs delimiter from the header line (comma, semicolon or tab). */
export function sniffDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map(d => [d, header.split(d).length] as const).sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

/** CSV rows keyed by header, with header names lowercased and trimmed. */
export function csvRecords(text: string): { header: string[]; records: Array<Record<string, string>> } {
  const rows = parseCsv(text, sniffDelimiter(text));
  const header = (rows.shift() ?? []).map(h => h.trim().toLowerCase());
  return { header, records: rows.map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

export function bnDigitsToAscii(value: string): string {
  return value.replace(/[০-৯]/g, d => String(BN_DIGITS.indexOf(d)));
}

/** Collapses whitespace, strips zero-width chars, NFC-normalizes (keeps Bangla intact). */
export function cleanText(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const cleaned = value.normalize('NFC').replace(/[​‌‍﻿]/g, m => (m === '‌' || m === '‍' ? m : '')).replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

/** Parses "৳ 1,665.00", "Tk. 12", "1665" → 1665. Returns undefined for anything non-numeric. */
export function parsePrice(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /(\d[\d,]*(?:\.\d+)?)/.exec(bnDigitsToAscii(value));
  if (!match) return undefined;
  const n = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function hasBengali(value: string): boolean {
  return /[ঀ-৿]/.test(value);
}

/**
 * Splits DGDA-style "Generic A + Generic B 500 mg + 125 mg" into generic text and strength text:
 * the strength starts at the first number that is followed by a unit.
 */
const STRENGTH_START = /(?:^|[\s(])((?:\d+(?:[.,]\d+)?|[.,]\d+)\s*(?:mg|mcg|µg|μg|gm|g|ml|l|iu|i\.u\.|%|units?|mmol|meq|million|billion|lac|lakh|cfu|w\/w|w\/v)(?![a-z]))/i;

export function splitGenericStrength(value: string): { generic: string; strength?: string } {
  const text = cleanText(value) ?? '';
  const match = STRENGTH_START.exec(text);
  if (!match || match.index === undefined) return { generic: text };
  const start = match.index + match[0].indexOf(match[1]);
  const generic = text.slice(0, start).replace(/[\s(+,-]+$/, '').trim();
  if (!generic) return { generic: text };
  return { generic, strength: text.slice(start).trim() };
}

/** Splits a combination generic string on "+", " and " (only when both sides look like names), "/" and ";". */
export function splitGenerics(value: string): string[] {
  return value.split(/\s*\+\s*|\s*;\s*|\s+&\s+/).map(part => cleanText(part)).filter((part): part is string => !!part);
}
