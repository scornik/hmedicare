import { describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import {
  DUPLICATE_REVIEW_THRESHOLD,
  MRN_RE,
  mrnFromId,
  normalizeMrn,
  rankDuplicates,
  requiresReview,
  scoreDuplicate,
} from '../../src/public/index';

// Synthetic names and reserved-range phones only.
describe('duplicate scoring (audit C-41)', () => {
  const probe = {
    legalName: 'Rahima Khatun',
    phones: ['+8801700000010'],
    dateOfBirth: '1990-05-01',
  };

  it('phone + name + DOB is a certain duplicate; name alone is a warning; nothing shared scores 0', () => {
    const same = scoreDuplicate(probe, { ...probe, legalNameBn: 'রহিমা খাতুন' });
    expect(same.score).toBe(1);
    expect(same.reasons).toEqual(['PHONE_MATCH', 'NAME_MATCH', 'DOB_MATCH']);

    const nameOnly = scoreDuplicate(probe, { legalName: 'Rohima Khatun', phones: [] });
    expect(nameOnly.score).toBeCloseTo(0.35, 4);
    expect(nameOnly.reasons).toEqual(['NAME_MATCH']);
    expect(nameOnly.score).toBeLessThan(DUPLICATE_REVIEW_THRESHOLD);

    const none = scoreDuplicate(probe, {
      legalName: 'Karim Uddin',
      phones: ['+8801700000011'],
      birthYear: 1970,
    });
    expect(none.score).toBe(0);
  });

  it('Bangla record vs Banglish probe matches on the name skeleton', () => {
    const r = scoreDuplicate(probe, { legalName: 'মোছাঃ রহিমা খাতুন', phones: ['+8801700000010'] });
    expect(r.reasons).toContain('NAME_MATCH');
    expect(r.score).toBeGreaterThanOrEqual(DUPLICATE_REVIEW_THRESHOLD);
  });

  it('DOB proximity: exact 0.15, ±1 year 0.10, ±2 years 0.05, beyond 0', () => {
    const base = { legalName: 'X Y', phones: [] as string[] };
    expect(
      scoreDuplicate({ ...base, dateOfBirth: '1990-05-01' }, { ...base, dateOfBirth: '1990-05-01' }).score,
    ).toBe(0.15);
    expect(scoreDuplicate({ ...base, birthYear: 1990 }, { ...base, birthYear: 1991 }).score).toBe(0.1);
    expect(scoreDuplicate({ ...base, birthYear: 1990 }, { ...base, dateOfBirth: '1992-01-01' }).score).toBe(
      0.05,
    );
    expect(scoreDuplicate({ ...base, birthYear: 1990 }, { ...base, birthYear: 1993 }).score).toBe(0);
  });

  it('rankDuplicates keeps warnings and above, highest first; requiresReview honours the threshold', () => {
    const a = newId();
    const b = newId();
    const c = newId();
    const ranked = rankDuplicates(probe, [
      { patientId: a, legalName: 'Rahima Khatun', phones: [], dateOfBirth: '1990-05-01' }, // 0.50
      { patientId: b, legalName: 'Rahima Khatun', phones: ['+8801700000010'] }, // 0.85
      { patientId: c, legalName: 'Unrelated Person', phones: [] }, // 0
    ]);
    expect(ranked.map((r) => r.patientId)).toEqual([b, a]);
    expect(requiresReview(ranked)).toBe(true);
    expect(requiresReview(ranked.slice(1))).toBe(false);
  });
});

describe('medical record numbers', () => {
  it('derives a stable, readable MRN from the patient id', () => {
    const id = newId();
    const mrn = mrnFromId(id);
    expect(mrn).toMatch(MRN_RE);
    expect(mrnFromId(id)).toBe(mrn);
    expect(mrnFromId(newId())).not.toBe(mrn);
    expect(() => mrnFromId('nope')).toThrow();
  });

  it('normalizes typed input (case, separators, I/L/O confusions)', () => {
    const mrn = mrnFromId(newId());
    const sloppy = mrn.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
    expect(normalizeMrn(sloppy)).toBe(mrn);
    expect(normalizeMrn('P-1234')).toBeNull();
  });
});
