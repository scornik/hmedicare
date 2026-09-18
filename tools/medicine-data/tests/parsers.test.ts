import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractLinks as dgdaLinks } from '../src/sources/dgda/discover.js';
import { parse as parseDgda } from '../src/sources/dgda/parse.js';
import { extractLinks as lazzLinks } from '../src/sources/lazzpharma/discover.js';
import { parseDetail, parseListing, splitProductName } from '../src/sources/lazzpharma/parse.js';
import { parse as parseMendeley } from '../src/sources/mendeley_bd_meds/parse.js';
import { parseCsv } from '../src/sources/shared.js';
import type { FetchedDoc } from '../src/sources/types.js';

const fixture = (source: string, name: string) => fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'sources', source, 'fixtures', name));
const doc = (url: string, body: Buffer): FetchedDoc => ({ url, body, fetchedAt: '2026-09-17T00:00:00.000Z', contentHash: 'a'.repeat(64) });

describe('csv', () => {
  it('handles quotes, escaped quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\r\n')).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  });
});

describe('dgda parser', () => {
  it('parses the CSV export', () => {
    const { facts, skipped } = parseDgda(doc('http://x/export', fixture('dgda', 'export.csv')));
    expect(skipped).toBe(1);
    expect(facts).toHaveLength(5);
    expect(facts[0]).toEqual({ source_record_id: '999-0001-001', brand_name: 'Testocil', generic_names: ['Testamycin'], strength_raw: '500 mg', dosage_form_raw: 'Tablet', manufacturer_raw: 'Example Pharma Ltd.', registration_number: '999-0001-001' });
    expect(facts[2]).toMatchObject({ generic_names: ['Alphazole', 'Betamide'], strength_raw: '500 mcg + 10 mg' });
  });

  it('parses the DataTables JSON fallback and pages through it', () => {
    const body = fixture('dgda', 'list-page-0.json');
    const url = 'http://180.211.137.202:9310/Allopathic/Medicine_Information_Ajax.php?action=list&draw=1&start=0&length=500';
    expect(parseDgda(doc(url, body)).facts[0]).toMatchObject({ brand_name: 'Testocil', generic_names: ['Testamycin Hydrochloride'], strength_raw: '10 mg/ml' });
    expect(dgdaLinks(body, url).map(l => l.url.match(/start=(\d+)/)![1])).toEqual(['500', '1000']);
  });

  it('fails loudly on an unexpected document instead of producing garbage', () => {
    expect(() => parseDgda(doc('http://x', Buffer.from('<html>login</html>')))).toThrow(/HTML/);
    expect(() => parseDgda(doc('http://x', Buffer.from('foo,bar\n1,2')))).toThrow(/header not recognized/);
  });
});

describe('lazzpharma parser', () => {
  it('splits product names into brand, strength and form', () => {
    expect(splitProductName('TESTOCIL 500MG Tab')).toEqual({ brand: 'TESTOCIL', strength: '500MG', form: 'Tab' });
    expect(splitProductName('DUOFIX 325MG/37.5MG Tab')).toEqual({ brand: 'DUOFIX', strength: '325MG/37.5MG', form: 'Tab' });
    expect(splitProductName('EXAMPLE 200 ML Syrup')).toEqual({ brand: 'EXAMPLE', strength: '200 ML', form: 'Syrup' });
  });

  it('parses homepage cards, skipping non-medicine and duplicate cards', () => {
    const { facts, skipped } = parseListing(fixture('lazzpharma', 'home.html').toString('utf8'));
    expect(facts).toHaveLength(2);
    expect(skipped).toBe(2);
    expect(facts[0]).toMatchObject({ source_record_id: '/product/details/testocil-500mg-tab-0000aaaa', brand_name: 'TESTOCIL', generic_names: ['TESTAMYCIN'], unit_price_bdt: 9, price_label: 'Discounted (listed BDT 10)' });
    expect(facts[1]).toMatchObject({ generic_names: ['ALPHAZOLE', 'BETAMIDE'], unit_price_bdt: 7.2, price_label: 'Listed price' });
  });

  it('extracts detail links from the server-rendered homepage only', () => {
    const links = lazzLinks(doc('https://lazzpharma.com/', fixture('lazzpharma', 'home.html')));
    expect(links).toHaveLength(3);
    expect(links.every(l => l.kind === 'detail' && l.url.startsWith('https://lazzpharma.com/product/details/'))).toBe(true);
  });

  it('parses the manufacturer from the detail page title', () => {
    const { facts } = parseDetail(fixture('lazzpharma', 'detail.html').toString('utf8'), 'https://lazzpharma.com/product/details/testocil-500mg-tab-0000aaaa');
    expect(facts[0]).toMatchObject({ brand_name: 'TESTOCIL', manufacturer_raw: 'EXAMPLE PHARMA LTD.', source_record_id: '/product/details/testocil-500mg-tab-0000aaaa' });
  });
});

describe('mendeley parser', () => {
  it('resolves columns by header and skips incomplete rows', () => {
    const { facts, skipped } = parseMendeley(doc('https://data.mendeley.com/x', fixture('mendeley_bd_meds', 'sample.csv')));
    expect(skipped).toBe(1);
    expect(facts[1]).toMatchObject({ source_record_id: 'row-3', brand_name: 'Duofix', generic_names: ['Alphazole', 'Betamide'], strength_raw: '500 mcg + 10 mg', dosage_form_raw: 'Tablet', manufacturer_raw: 'Sample Labs PLC' });
    expect(facts[1].pack_size_raw).toBeUndefined(); // packageMark is a slug, not a pack size
  });
});
