import * as cheerio from 'cheerio';
import { cleanText, parsePrice, splitGenerics } from '../shared.js';
import type { ExtractedFact, FetchedDoc, ParseResult } from '../types.js';
import { LAZZ_ORIGIN } from './discover.js';

/** Trailing dosage-form words as LazzPharma writes them in product names. */
const FORM_WORDS = /\b((?:eye |ear |nasal |oral )?drops?|oral solution|mouth wash|tab(?:let)?s?|cap(?:sule)?s?|syrup|suspension|susp|injection|inj|cream|ointment|oint|gel|inhaler|suppository|supp|powder|solution|sachet|lotion|spray|pfs|insulin|vial|ampoule)\.?$/i;
/** Card sub-labels that are merchandising categories, not generic names. */
const NON_GENERIC = /^(surgical|device|food|toiletries|shampoo|soap|hair oil|face wash|beauty cream|condom|napkine|brush|tooth paste|unani medic?h?ine|lotion|capsule|syrup|tablet|\.+)\b/i;

export function splitProductName(name: string): { brand: string; strength?: string; form?: string } {
  let rest = cleanText(name) ?? '';
  let form: string | undefined;
  const formMatch = FORM_WORDS.exec(rest);
  if (formMatch && formMatch.index > 0) {
    form = formMatch[1];
    rest = rest.slice(0, formMatch.index).trim();
  }
  let strength: string | undefined;
  const strengthMatch = /\s(\d[\d.]*\s*(?:mg|mcg|gm|g|ml|iu|%)?(?:\s*[/+]\s*\d[\d.]*\s*(?:mg|mcg|gm|g|ml|iu|%)?)*)$/i.exec(rest);
  if (strengthMatch) {
    strength = strengthMatch[1].trim();
    rest = rest.slice(0, strengthMatch.index).trim();
  }
  return { brand: rest, strength, form };
}

/** Generic labels must contain letters (the site sometimes shows an internal numeric code). */
const cleanGenerics = (value: string) => splitGenerics(value).filter(g => /\p{L}{2,}/u.test(g));
/** "FOREIGN" is an origin label, not a manufacturer. */
const cleanManufacturer = (value?: string) => (value && !/^(foreign|local|n\/?a|none|\.+)$/i.test(value) ? value : undefined);
const cleanBrand = (value: string) => value.replace(/[\s.,;:-]+$/, '').trim();

function recordId(href: string): string {
  return new URL(href, LAZZ_ORIGIN).pathname;
}

/** Homepage cards: name, generic sub-label and observed price. Non-medicine cards are skipped. */
export function parseListing(html: string): ParseResult {
  const $ = cheerio.load(html);
  const facts: ExtractedFact[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  $('#ssr-home a.product-top-area[href*="/product/details/"]').each((_, el) => {
    const card = $(el);
    const id = recordId(card.attr('href')!);
    const name = cleanText(card.find('.product_heading_info h3').first().text());
    const sub = cleanText(card.find('.product_heading_info span').first().text());
    if (!name || seen.has(id)) { skipped++; return; }
    seen.add(id);
    const { brand, strength, form } = splitProductName(name);
    const generics = sub ? cleanGenerics(sub) : [];
    if (!form || !brand || !sub || NON_GENERIC.test(sub) || !generics.length) { skipped++; return; }
    const now = parsePrice(card.find('.item__price--now').first().text());
    const crossed = parsePrice(card.find('del.cross_price').first().text());
    facts.push({
      source_record_id: id,
      brand_name: cleanBrand(brand),
      generic_names: generics,
      strength_raw: strength,
      dosage_form_raw: form,
      unit_price_bdt: now,
      price_label: now === undefined ? undefined : crossed !== undefined ? `Discounted (listed BDT ${crossed})` : 'Listed price'
    });
  });
  return { facts, skipped, warnings: [] };
}

/** Detail pages are client-rendered; the server <title> is "NAME | GENERIC | MANUFACTURER | Lazz Pharma ...". */
export function parseDetail(html: string, url: string): ParseResult {
  const $ = cheerio.load(html);
  const parts = ($('title').first().text() || '').split('|').map(p => cleanText(p)).filter((p): p is string => !!p);
  if (parts.length < 4 || !/lazz pharma/i.test(parts[parts.length - 1])) return { facts: [], skipped: 1, warnings: [`unexpected title on ${url}`] };
  const [name, generic, manufacturer] = parts;
  const { brand, strength, form } = splitProductName(name);
  const generics = cleanGenerics(generic);
  if (!form || !brand || NON_GENERIC.test(generic) || !generics.length) return { facts: [], skipped: 1, warnings: [] };
  return {
    facts: [{
      source_record_id: recordId(url),
      brand_name: cleanBrand(brand),
      generic_names: generics,
      strength_raw: strength,
      dosage_form_raw: form,
      manufacturer_raw: cleanManufacturer(manufacturer)
    }],
    skipped: 0,
    warnings: []
  };
}

export function parse(doc: FetchedDoc, kind: string): ParseResult {
  const html = doc.body.toString('utf8');
  return kind === 'listing' ? parseListing(html) : parseDetail(html, doc.url);
}
