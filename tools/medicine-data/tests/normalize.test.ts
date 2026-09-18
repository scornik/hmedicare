import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonl, writeJsonl } from '../src/export/jsonl.js';
import { normalizeBangla, transliterateBnToLatin } from '../src/normalize/bangla.js';
import { loadFormMapper } from '../src/normalize/forms.js';
import { normalizeGeneric } from '../src/normalize/generics.js';
import { loadManufacturerResolver, manufacturerKey } from '../src/normalize/manufacturers.js';
import { parsePackSize, parseStrength, strengthKey } from '../src/normalize/units.js';
import { splitGenericStrength } from '../src/sources/shared.js';

describe('strength parsing', () => {
  it('parses single, ratio and percentage strengths', () => {
    expect(parseStrength('500 mg')).toEqual([{ value: 500, unit: 'mg' }]);
    expect(parseStrength('250 mg/5 ml')).toEqual([{ value: 250, unit: 'mg', per_value: 5, per_unit: 'ml' }]);
    expect(parseStrength('40 IU/ml')).toEqual([{ value: 40, unit: 'IU', per_value: 1, per_unit: 'ml' }]);
    expect(parseStrength('0.1% w/w')).toEqual([{ value: 0.1, unit: '%' }]);
    expect(parseStrength('1 gm')).toEqual([{ value: 1, unit: 'g' }]);
    expect(parseStrength('100 mcg/actuation')).toEqual([{ value: 100, unit: 'mcg', per_value: 1, per_unit: 'actuation' }]);
  });

  it('parses combination products into one component per ingredient', () => {
    expect(parseStrength('500 mg + 125 mg')).toEqual([{ value: 500, unit: 'mg' }, { value: 125, unit: 'mg' }]);
    expect(parseStrength('325MG/37.5MG', 2)).toEqual([{ value: 325, unit: 'mg' }, { value: 37.5, unit: 'mg' }]);
    expect(strengthKey('500 mcg + 10 mg', parseStrength('500 mcg + 10 mg', 2))).toBe('0.5mg+10mg');
    expect(parseStrength('3 gm/100 gm')).toEqual([{ value: 3, unit: 'g', per_value: 100, per_unit: 'g' }]);
    expect(parseStrength('175 mg + 225 mg/5 ml', 2)).toEqual([{ value: 175, unit: 'mg', per_value: 5, per_unit: 'ml' }, { value: 225, unit: 'mg', per_value: 5, per_unit: 'ml' }]);
  });

  it('builds canonical keys so equivalent notations compare equal', () => {
    expect(strengthKey('3%')).toBe(strengthKey('3 gm/100 gm'));
    expect(strengthKey('600 mg/3 ml')).toBe(strengthKey('200 mg/ml'));
    expect(strengthKey('1 gm')).toBe(strengthKey('1000 mg'));
    expect(strengthKey('400 IU/10 ml')).toBe('40IU/ml');
    expect(strengthKey('500 mg/vial')).toBe('500mg/vial');
    expect(strengthKey('0.5%', parseStrength('0.5%'), { liquid: true })).toBe(strengthKey('5 mg/ml'));
    expect(strengthKey('1% w/w', parseStrength('1% w/w'), { liquid: false })).toBe('1%');
    expect(strengthKey('65 mg + 500 mg', parseStrength('65 mg + 500 mg', 2), { ingredientKeys: ['caffeine', 'paracetamol'] }))
      .toBe(strengthKey('500 mg + 65 mg', parseStrength('500 mg + 65 mg', 2), { ingredientKeys: ['paracetamol', 'caffeine'] }));
  });

  it('never invents values', () => {
    expect(parseStrength('as directed')).toEqual([]);
    expect(parseStrength(undefined)).toEqual([]);
    expect(strengthKey('Forte')).toBe('forte');
  });

  it('accepts decimals without a leading zero (DGDA style)', () => {
    expect(parseStrength('.5 mg')).toEqual([{ value: 0.5, unit: 'mg' }]);
    expect(splitGenericStrength('Betamethasone + Calcipotriol .05 gm + .005 gm/100 gm')).toEqual({ generic: 'Betamethasone + Calcipotriol', strength: '.05 gm + .005 gm/100 gm' });
  });

  it('handles Bangla digits', () => {
    expect(parseStrength('৫০০ mg')).toEqual([{ value: 500, unit: 'mg' }]);
  });

  it('parses pack sizes only when counts are explicit', () => {
    expect(parsePackSize('10 x 10')).toEqual({ raw: '10 x 10', units_per_pack: 100 });
    expect(parsePackSize('30 tablets')).toEqual({ raw: '30 tablets', units_per_pack: 30 });
    expect(parsePackSize('100 ml bottle')).toEqual({ raw: '100 ml bottle' });
  });

  it('splits DGDA generic+strength text at the first numeric unit', () => {
    expect(splitGenericStrength('Flupenthixol + Melitracen 500 mcg + 10 mg')).toEqual({ generic: 'Flupenthixol + Melitracen', strength: '500 mcg + 10 mg' });
    expect(splitGenericStrength('Vitamin B1 100 mg')).toEqual({ generic: 'Vitamin B1', strength: '100 mg' });
    expect(splitGenericStrength('Omeprazole')).toEqual({ generic: 'Omeprazole' });
  });
});

describe('dosage form vocabulary', () => {
  const forms = loadFormMapper();
  it('maps aliases and ordered patterns to the controlled vocabulary', () => {
    expect(forms.map('Tab').form).toBe('tablet');
    expect(forms.map('Film Coated Tablet').form).toBe('tablet');
    expect(forms.map('IV/IM Injection').form).toBe('injection');
    expect(forms.map('Powder For Suspension').form).toBe('powder_for_suspension');
    expect(forms.map('Eye and Ear Drops').form).toBe('eye_ear_drops');
    expect(forms.map('SR Tablet').form).toBe('modified_release_tablet');
    expect(forms.map('Suppository').form).toBe('suppository');
  });

  it('sends unknown forms to unmapped instead of guessing', () => {
    expect(forms.map('Chewing Gum Strip').form).toBe('unmapped');
    expect(forms.map(undefined).form).toBe('unmapped');
  });

  it('extracts only explicitly stated routes', () => {
    expect(forms.explicitRoute('IM Injection')).toBe('IM');
    expect(forms.explicitRoute('IV/IM Injection')).toBe('IV/IM');
    expect(forms.explicitRoute('Injection')).toBeUndefined();
    expect(forms.explicitRoute('Tablet')).toBeUndefined();
  });
});

describe('generic names', () => {
  it('moves salts into salt_form but keeps the original', () => {
    expect(normalizeGeneric('Metformin Hydrochloride')).toEqual({ name: 'Metformin', key: 'metformin', salt_form: 'hydrochloride', original: 'Metformin Hydrochloride' });
    expect(normalizeGeneric('Esomeprazole Magnesium Trihydrate')).toMatchObject({ key: 'esomeprazole', salt_form: 'magnesium trihydrate' });
    expect(normalizeGeneric('PARACETAMOL BP')).toMatchObject({ key: 'paracetamol', name: 'Paracetamol' });
  });

  it('keeps ion-only substances whole', () => {
    expect(normalizeGeneric('Sodium Chloride')).toMatchObject({ key: 'sodium chloride' });
    expect(normalizeGeneric('Ferrous Sulfate')).toMatchObject({ key: 'ferrous sulphate' });
    expect(normalizeGeneric('Calcium Carbonate')).toMatchObject({ key: 'calcium carbonate' });
  });

  it('moves prodrug esters to salt_form (sources are inconsistent about them)', () => {
    expect(normalizeGeneric('Cefuroxime Axetil')).toMatchObject({ key: 'cefuroxime', salt_form: 'axetil' });
  });
});

describe('manufacturers', () => {
  const resolver = loadManufacturerResolver();
  it('ignores legal suffixes and punctuation in keys', () => {
    expect(manufacturerKey('Square Pharmaceuticals PLC')).toBe(manufacturerKey('Square Pharmaceuticals Ltd.'));
  });
  it('ignores manufacturing sites, unit/status qualifiers and spelling variants', () => {
    expect(manufacturerKey('Square Pharmaceuticals PLC, Pabna')).toBe('square pharma');
    expect(manufacturerKey('Incepta Pharmaceuticals Ltd. (Dhamrai Unit)')).toBe(manufacturerKey('Incepta Pharma Limited'));
    expect(manufacturerKey('Drug International Ltd., Squib Road')).toBe('drug international');
    expect(manufacturerKey('Eskayef Pharmaceuticals Ltd. Chandana, Gazipur')).toBe('eskayef pharma');
    expect(manufacturerKey('Square Formulations Ltd.')).not.toBe(manufacturerKey('Square Pharmaceuticals PLC'));
  });
  it('applies the alias table and reports the rule', () => {
    expect(resolver.resolve('ACI Limited')).toMatchObject({ name: 'Advanced Chemical Industries PLC.', alias_rule: 'alias_table' });
    expect(resolver.resolve('Square Pharmaceuticals Ltd.')).toMatchObject({ name: 'Square Pharmaceuticals PLC', alias_rule: 'name_normalization' });
    expect(resolver.resolve('Unknown Maker Ltd')).toMatchObject({ name: 'Unknown Maker Ltd', alias_rule: 'exact' });
  });
});

describe('Bangla text', () => {
  it('round-trips Bangla through JSONL byte-for-byte (NFC)', () => {
    const name = normalizeBangla('নাপা এক্সট্রা ৫০০');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'md-bn-')), 'x.jsonl');
    writeJsonl(file, [{ brand_name_bn: name }]);
    expect(fs.readFileSync(file, 'utf8')).toContain('নাপা এক্সট্রা ৫০০'); // written unescaped
    expect(readJsonl<{ brand_name_bn: string }>(file)[0].brand_name_bn).toBe(name);
  });

  it('normalizes decomposed input to NFC', () => {
    const decomposed = 'কো'; // ে + া (decomposed ো)
    expect(normalizeBangla(decomposed)).toBe('কো');
  });

  it('generates Banglish search transliterations', () => {
    expect(transliterateBnToLatin('নাপা')).toBe('napa');
    expect(transliterateBnToLatin('সেকলো')).toBe('seklo');
    expect(transliterateBnToLatin('কমল')).toBe('komol');
  });
});
