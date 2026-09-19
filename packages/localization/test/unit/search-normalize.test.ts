import { describe, expect, it } from 'vitest';
import {
  SEARCH_NORMALIZATION_VERSION,
  foldLatin,
  nameSearchTokens,
  skeleton,
  skeletonSimilarity,
  transliterateBangla,
} from '../../src/index';

// Search normalization v1 (BANGLADESH-LOCALIZATION-SPEC §3, audit C-41). Names are synthetic.
describe('nameSearchTokens', () => {
  it('folds Latin names, drops honorifics and short tokens, keeps order-independent unique tokens', () => {
    const t = nameSearchTokens('Md. Rahim Uddin', 'Dr Rahim  UDDIN');
    expect(t.names).toEqual(['rahim', 'uddin']);
    expect(t.version).toBe(SEARCH_NORMALIZATION_VERSION);
  });

  it('Bangla name round trip: the Bangla record and the Banglish query meet on the same tokens', () => {
    const stored = nameSearchTokens('মোছাঃ রহিমা খাতুন'.normalize('NFC'));
    const banglish = nameSearchTokens('Rahima Khatun');
    const loose = nameSearchTokens('Raheema');
    // v1 transliteration spells the inherent vowel as `o`; the honorific মোছাঃ is dropped.
    expect(stored.names).toEqual(['rohima']);
    expect(banglish.names).toEqual(['rahima']);
    // Bangla record and Banglish query meet on the skeleton index.
    expect(stored.skeletons).toEqual(banglish.skeletons);
    expect(stored.skeletons).toContain(loose.skeletons[0]!);
  });

  it('transliterates with the inherent-vowel rule, hasant and nukta letters deterministically', () => {
    expect(transliterateBangla('করিম')).toBe('korim');
    expect(transliterateBangla('আব্দুল')).toBe('abdul');
    expect(transliterateBangla('সুলতানা')).toBe('sulotana'); // v1 does not model schwa deletion
    expect(transliterateBangla('মোহাম্মদ')).toBe('mohammod');
    expect(transliterateBangla('রং')).toBe('rong');
    expect(transliterateBangla('বড়')).toBe('bor');
    expect(transliterateBangla('ক্ষমা')).toBe('kkhoma');
    // The same name in precomposed and decomposed nukta form gives one result.
    const pre = `ব${String.fromCharCode(0x09dc)}`;
    const dec = `বড়`;
    expect(transliterateBangla(pre)).toBe(transliterateBangla(dec));
  });

  it('Bangla digits and mixed input fold to Latin; punctuation is removed', () => {
    expect(foldLatin('Rahim-১২ (Uddin)')).toBe('rahim 12 uddin');
    expect(nameSearchTokens('আব্দুল Karim').names).toEqual(['abdul', 'karim']);
  });

  it('skeletons collapse common Banglish spelling variants', () => {
    expect(skeleton('rahim')).toBe(skeleton('raheem'));
    expect(skeleton('rahim')).toBe(skeleton('rohim'));
    expect(skeleton('mohammad')).toBe(skeleton('muhammed'));
    expect(skeleton('sultana')).toBe(skeleton('soltana'));
    expect(skeleton('khatun')).toBe(skeleton('katun'));
    expect(skeleton('rahim')).not.toBe(skeleton('karim'));
  });

  it('skeletonSimilarity is Jaccard and zero for empty sets', () => {
    expect(skeletonSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
    expect(skeletonSimilarity([], ['b'])).toBe(0);
    expect(skeletonSimilarity(['x'], ['x'])).toBe(1);
  });

  it('never emits non-ASCII tokens (index column is ascii_bin)', () => {
    const t = nameSearchTokens('মোঃ আবু বকর সিদ্দিক', 'José Müller', 'Nusrat Jahan');
    for (const tok of [...t.names, ...t.skeletons]) expect(tok).toMatch(/^[a-z0-9]{2,64}$/);
  });
});
