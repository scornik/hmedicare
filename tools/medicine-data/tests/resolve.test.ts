import { describe, expect, it } from 'vitest';
import { normalizeFacts } from '../src/normalize/index.js';
import { AUTO_MERGE_THRESHOLD, decide, genericSimilarity, jaroWinkler, REVIEW_THRESHOLD, scorePair } from '../src/resolve/fuzzy.js';
import { formRelation, recordKey } from '../src/resolve/keys.js';
import { mergeFacts } from '../src/resolve/merge.js';
import type { RawFact } from '../src/schemas.js';

const HASH = 'a'.repeat(64);
let n = 0;
function fact(source: string, over: Partial<RawFact>): RawFact {
  n++;
  return {
    source_id: source, source_url: `https://${source}.test-host.org/p/${n}`, source_record_id: `r${n}`, fetched_at: '2026-09-17T00:00:00.000Z', content_hash: HASH,
    brand_name: 'Testocil', generic_names: ['Testamycin'], strength_raw: '500 mg', dosage_form_raw: 'Tablet', manufacturer_raw: 'Example Pharma Ltd.',
    monograph_available: false, ...over
  };
}

describe('record keys', () => {
  it('are order-independent for generics and ignore case/suffix noise', () => {
    const { facts } = normalizeFacts([
      fact('a', { brand_name: 'DUOFIX', generic_names: ['Alphazole', 'Betamide'], manufacturer_raw: 'Sample Labs PLC' }),
      fact('b', { brand_name: 'Duofix', generic_names: ['betamide', 'ALPHAZOLE'], manufacturer_raw: 'Sample Labs Ltd.' })
    ]);
    expect(facts[0].record_key).toBe(facts[1].record_key);
    expect(facts[0].record_key).toBe('duofix|alphazole+betamide|500mg|tablet|sample lab');
  });

  it('keeps explicitly different parenteral routes apart', () => {
    const { facts } = normalizeFacts([fact('dgda', { dosage_form_raw: 'IM Injection' }), fact('dgda', { dosage_form_raw: 'IV Injection' })]);
    expect(facts[0].record_key).not.toBe(facts[1].record_key);
    expect(recordKey(facts[0])).toMatch(/#im$/);
  });
});

describe('fuzzy thresholds', () => {
  it('relates dosage forms within a family', () => {
    expect(formRelation('tablet', 'modified_release_tablet')).toBe('parent');
    expect(formRelation('chewable_tablet', 'modified_release_tablet')).toBe('sibling');
    expect(formRelation('tablet', 'capsule')).toBe('different');
    const base = { brandKey: 'apeclo sr', strengthKey: '200mg', manufacturerKey: 'apex pharma' };
    expect(decide(scorePair({ ...base, form: 'tablet' }, { ...base, form: 'modified_release_tablet' }))).toBe('auto_merge');
    expect(decide(scorePair({ ...base, form: 'chewable_tablet' }, { ...base, form: 'modified_release_tablet' }))).toBe('review');
  });

  it('treats a contained manufacturer name as compatible, not conflicting', () => {
    const s = scorePair({ brandKey: 'x', strengthKey: '1mg', manufacturerKey: 'ibn sina pharma' }, { brandKey: 'x', strengthKey: '1mg', manufacturerKey: 'ibn sina pharma ind' });
    expect(s.manufacturerConflict).toBe(false);
    expect(decide(s)).toBe('auto_merge');
  });

  it('sends same brand and strength from a different company to review', () => {
    const s = scorePair({ brandKey: 'alofen', strengthKey: '100mg', manufacturerKey: 'orbit pharma' }, { brandKey: 'alofen', strengthKey: '100mg', manufacturerKey: 'avarox pharma' });
    expect(decide(s)).toBe('review');
  });

  it('computes Jaro-Winkler', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.9611, 3);
    expect(jaroWinkler('same', 'same')).toBe(1);
    expect(jaroWinkler('abc', '')).toBe(0);
    expect(genericSimilarity(['melitracen', 'flupentixol'], ['flupenthixol', 'melitracen'])).toBeGreaterThan(0.93);
    expect(genericSimilarity(['a'], ['a', 'b'])).toBe(0);
  });

  it('auto-merges only near-identical brands with equal strength and compatible manufacturer', () => {
    const base = { brandKey: 'testocil', strengthKey: '500mg', manufacturerKey: 'example pharma' };
    expect(decide(scorePair(base, { ...base, manufacturerKey: '' }))).toBe('auto_merge');
    expect(scorePair(base, { ...base, manufacturerKey: '' }).score).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
    expect(decide(scorePair(base, { ...base, brandKey: 'testocyl' }))).toBe('review');
    expect(decide(scorePair(base, { ...base, strengthKey: '250mg' }))).toBe('distinct');
    expect(decide(scorePair(base, { ...base, manufacturerKey: 'other labs' }))).toBe('distinct');
    const review = scorePair(base, { ...base, brandKey: 'testocyl' });
    // Score clears the auto threshold, but brand similarity (0.95) is below the auto-merge guard.
    expect(review.score).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    expect(review.brand).toBeLessThan(0.96);
  });
});

describe('merge', () => {
  it('applies precedence DGDA > open dataset > pharmacies and records conflicts', () => {
    const { facts } = normalizeFacts([
      fact('lazzpharma', { brand_name: 'TESTOCIL', manufacturer_raw: undefined, unit_price_bdt: 9, price_label: 'Listed price' }),
      fact('mendeley_bd_meds', { brand_name: 'Testocil', strength_raw: '500mg', pack_price_bdt: 90, price_label: 'Dataset price (unverified)' }),
      fact('dgda', { brand_name: 'Testocil', registration_number: '999-0001-001', manufacturer_raw: 'Example Pharma Limited' })
    ]);
    const result = mergeFacts(facts);
    expect(result.medications).toHaveLength(1);
    const med = result.medications[0] as Record<string, any>;
    expect(med.source_ids).toEqual(['dgda', 'lazzpharma', 'mendeley_bd_meds']);
    expect(med.brand_name.value).toBe('Testocil');
    expect(med.manufacturer.value).toBe('Example Pharma Limited');
    expect(med.dgda_match).toBe('MATCHED');
    expect(med.status).toBe('UNVERIFIED');
    // Prices are never merged: one observation per source record.
    expect(result.prices).toHaveLength(2);
    expect(result.prices.every(p => p.is_official_mrp === false)).toBe(true);
    expect(result.provenance.find(p => p.source_id === 'lazzpharma')?.match_method).toBe('fuzzy_auto');
  });

  it('keeps every conflicting value and names the rule', () => {
    const { facts } = normalizeFacts([
      fact('dgda', { registration_number: '999-0001-001' }),
      fact('mendeley_bd_meds', { registration_number: '111-2222-333' })
    ]);
    const result = mergeFacts(facts);
    const conflict = result.conflicts.find(c => c.field === 'registration_number') as Record<string, any>;
    expect(conflict.chosen).toBe('999-0001-001');
    expect(conflict.rule).toBe('source_precedence');
    expect(conflict.values).toHaveLength(2);
  });

  it('uses the majority among pharmacies when no higher-precedence source exists', () => {
    const { facts } = normalizeFacts([
      fact('lazzpharma', { pack_size_raw: '10 x 10' }),
      fact('pharmacy_x', { pack_size_raw: '10 x 10' }),
      fact('pharmacy_y', { pack_size_raw: '1 x 30' })
    ]);
    const med = mergeFacts(facts).medications[0] as Record<string, any>;
    expect(med.pack_size.value).toBe('10 x 10');
    expect(med.pack_size.agreement_count).toBe(2);
  });

  it('sends near matches to the review queue instead of merging', () => {
    const { facts } = normalizeFacts([fact('dgda', {}), fact('mendeley_bd_meds', { brand_name: 'Testocyl' })]);
    const result = mergeFacts(facts);
    expect(result.medications).toHaveLength(2);
    expect(result.reviewQueue.some(r => r.type === 'fuzzy_match')).toBe(true);
    const mendeley = result.medications.find(m => (m.source_ids as string[]).includes('mendeley_bd_meds')) as Record<string, any>;
    expect(mendeley.dgda_match).toBe('AMBIGUOUS');
  });

  it('merges generic spelling variants of the same brand in the second pass', () => {
    const result = mergeFacts(normalizeFacts([
      fact('dgda', { brand_name: 'Acitrin L', generic_names: ['Levocetrizine'], strength_raw: '2.5 mg/5 ml', dosage_form_raw: 'Syrup', manufacturer_raw: 'Example Pharma Ltd.', registration_number: '9' }),
      fact('mendeley_bd_meds', { brand_name: 'Acitrin L', generic_names: ['Levocetirizine'], strength_raw: '2.5 mg/5 ml', dosage_form_raw: 'Syrup' })
    ]).facts);
    expect(result.medications).toHaveLength(1);
    expect(result.conflicts.some(c => c.field === 'generic_names')).toBe(true);
  });

  it('does not merge different drugs that share a brand name', () => {
    const result = mergeFacts(normalizeFacts([
      fact('dgda', { brand_name: 'Abac', generic_names: ['Cefalexin'], registration_number: '9' }),
      fact('mendeley_bd_meds', { brand_name: 'Abac', generic_names: ['Cephradine'] })
    ]).facts);
    expect(result.medications).toHaveLength(2);
  });

  it('never merges two DGDA registrations and marks NOT_CHECKED without DGDA data', () => {
    const withDgda = mergeFacts(normalizeFacts([fact('dgda', { registration_number: '1' }), fact('dgda', { brand_name: 'Testocill', registration_number: '2' })]).facts);
    expect(withDgda.medications).toHaveLength(2);
    const without = mergeFacts(normalizeFacts([fact('mendeley_bd_meds', {})]).facts);
    expect((without.medications[0] as Record<string, any>).dgda_match).toBe('NOT_CHECKED');
  });

  it('combines listing and detail facts for the same source record', () => {
    const { facts, report } = normalizeFacts([
      fact('lazzpharma', { source_record_id: '/product/details/x', source_url: 'https://lazzpharma.com/', manufacturer_raw: undefined, unit_price_bdt: 9 }),
      fact('lazzpharma', { source_record_id: '/product/details/x', source_url: 'https://lazzpharma.com/product/details/x' })
    ]);
    expect(report.collapsed).toBe(1);
    expect(facts[0]).toMatchObject({ unit_price_bdt: 9, manufacturer_raw: 'Example Pharma Ltd.', source_url: 'https://lazzpharma.com/product/details/x' });
  });

  it('logs manufacturer merges made by name normalization', () => {
    const result = mergeFacts(normalizeFacts([fact('dgda', { manufacturer_raw: 'Sample Labs PLC.' }), fact('mendeley_bd_meds', { brand_name: 'Other', manufacturer_raw: 'Sample Labs Ltd' })]).facts);
    const mfr = result.manufacturers.find(m => m.key === 'sample lab') as Record<string, any>;
    expect(mfr.aliases).toEqual([{ raw: 'Sample Labs Ltd', rule: 'name_normalization', sources: ['mendeley_bd_meds'] }]);
  });
});
