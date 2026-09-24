import { toLatinDigits } from './digits';

/**
 * Patient-name search normalization **v1** (BANGLADESH-LOCALIZATION-SPEC §3, audit C-41). Produces ASCII
 * tokens for `patient_search_tokens` and for queries, so Bangla, English and Banglish spellings of a name
 * meet on the same index. Deterministic and versioned: any change to the tables below bumps
 * `SEARCH_NORMALIZATION_VERSION` and triggers a token rebuild. It never alters stored names.
 */
export const SEARCH_NORMALIZATION_VERSION = 1;

/** Honorifics and religious prefixes that carry no identity (Latin forms already folded/lowercased). */
const HONORIFICS = new Set([
  'md',
  'mohammad',
  'mohammed',
  'muhammad',
  'mst',
  'mosammat',
  'mosammot',
  'mossammat',
  'sk',
  'sheikh',
  'dr',
  'mr',
  'mrs',
  'ms',
  'miss',
  'sri',
  'shri',
  'smt',
  'kazi',
  'syed',
  'sayed',
  'sayeed',
  'begum',
  'khatun',
  'khan',
  // Bangla honorific abbreviations map to these after transliteration
  'mo',
  'mos',
  'mosa',
  'mochha',
  'mocha',
]);

/**
 * Bangla → Latin transliteration (v1). Units are consonants, vowel signs, independent vowels and modifiers.
 * Rules (Banglish name spelling, not a reversible scheme):
 * - a consonant carries the inherent vowel \`o\` unless it is followed by a vowel sign or hasant, or ends
 *   the word;
 * - hasant (virama) joins consonants without a vowel;
 * - nukta letters (ড়, ঢ়, য়) are matched as base + nukta because NFC decomposes them;
 * - anusvara keeps the inherent vowel of the consonant before it ("rong"); visarga and chandrabindu are dropped.
 */
const cp = (...codes: number[]) => String.fromCharCode(...codes);
const NUKTA = cp(0x09bc);
const HASANT = cp(0x09cd);
const ANUSVARA = cp(0x0982);
const DROPPED = new Set([cp(0x0983), cp(0x0981), NUKTA]); // visarga, chandrabindu, stray nukta

/** Two-character consonant units checked before single characters (longest first). */
const CONSONANT_MULTI: Array<[string, string]> = [
  [cp(0x09a1) + NUKTA, 'r'],
  [cp(0x09a2) + NUKTA, 'rh'],
  [cp(0x09af) + NUKTA, 'y'],
  [cp(0x0995, 0x09cd, 0x09b7), 'kkh'], // ক্ষ
  [cp(0x099c, 0x09cd, 0x099e), 'gg'], // জ্ঞ
];

const CONSONANTS: Record<string, string> = {
  [cp(0x0995)]: 'k',
  [cp(0x0996)]: 'kh',
  [cp(0x0997)]: 'g',
  [cp(0x0998)]: 'gh',
  [cp(0x0999)]: 'ng',
  [cp(0x099a)]: 'ch',
  [cp(0x099b)]: 'chh',
  [cp(0x099c)]: 'j',
  [cp(0x099d)]: 'jh',
  [cp(0x099e)]: 'n',
  [cp(0x099f)]: 't',
  [cp(0x09a0)]: 'th',
  [cp(0x09a1)]: 'd',
  [cp(0x09a2)]: 'dh',
  [cp(0x09a3)]: 'n',
  [cp(0x09a4)]: 't',
  [cp(0x09a5)]: 'th',
  [cp(0x09a6)]: 'd',
  [cp(0x09a7)]: 'dh',
  [cp(0x09a8)]: 'n',
  [cp(0x09aa)]: 'p',
  [cp(0x09ab)]: 'f',
  [cp(0x09ac)]: 'b',
  [cp(0x09ad)]: 'bh',
  [cp(0x09ae)]: 'm',
  [cp(0x09af)]: 'j',
  [cp(0x09b0)]: 'r',
  [cp(0x09b2)]: 'l',
  [cp(0x09b6)]: 'sh',
  [cp(0x09b7)]: 'sh',
  [cp(0x09b8)]: 's',
  [cp(0x09b9)]: 'h',
  [cp(0x09ce)]: 't', // ৎ (never carries a vowel)
  [cp(0x09f0)]: 'r',
  [cp(0x09f1)]: 'w',
};
const NO_INHERENT = new Set([cp(0x09ce)]);

const VOWELS: Record<string, string> = {
  [cp(0x0985)]: 'o',
  [cp(0x0986)]: 'a',
  [cp(0x0987)]: 'i',
  [cp(0x0988)]: 'i',
  [cp(0x0989)]: 'u',
  [cp(0x098a)]: 'u',
  [cp(0x098b)]: 'ri',
  [cp(0x098f)]: 'e',
  [cp(0x0990)]: 'oi',
  [cp(0x0993)]: 'o',
  [cp(0x0994)]: 'ou',
};
const VOWEL_SIGNS: Record<string, string> = {
  [cp(0x09be)]: 'a',
  [cp(0x09bf)]: 'i',
  [cp(0x09c0)]: 'i',
  [cp(0x09c1)]: 'u',
  [cp(0x09c2)]: 'u',
  [cp(0x09c3)]: 'ri',
  [cp(0x09c7)]: 'e',
  [cp(0x09c8)]: 'oi',
  [cp(0x09cb)]: 'o',
  [cp(0x09cc)]: 'ou',
};

const BANGLA_RE = /[ঀ-৿]/;

type Unit = { kind: 'C' | 'V' | 'X'; latin: string; joined?: boolean };

function units(s: string): Unit[] {
  const out: Unit[] = [];
  let i = 0;
  while (i < s.length) {
    const multi = CONSONANT_MULTI.find(([from]) => s.startsWith(from, i));
    if (multi) {
      out.push({ kind: 'C', latin: multi[1] });
      i += multi[0].length;
      continue;
    }
    const ch = s[i] ?? '';
    i++;
    if (CONSONANTS[ch] !== undefined)
      out.push({ kind: 'C', latin: CONSONANTS[ch], joined: NO_INHERENT.has(ch) });
    else if (VOWEL_SIGNS[ch] !== undefined) out.push({ kind: 'V', latin: VOWEL_SIGNS[ch] });
    else if (VOWELS[ch] !== undefined) out.push({ kind: 'V', latin: VOWELS[ch] });
    else if (ch === HASANT) {
      const prev = out[out.length - 1];
      if (prev?.kind === 'C') prev.joined = true;
    } else if (ch === ANUSVARA) out.push({ kind: 'C', latin: 'ng', joined: true });
    else if (DROPPED.has(ch)) continue;
    else if (ch === cp(0x0964)) out.push({ kind: 'X', latin: ' ' });
    else out.push({ kind: 'X', latin: ch });
  }
  return out;
}

/** Transliterates Bangla script to a Banglish-style Latin string (v1). Non-Bangla characters pass through. */
export function transliterateBangla(input: string): string {
  const u = units(input.normalize('NFC'));
  let out = '';
  for (let i = 0; i < u.length; i++) {
    const cur = u[i]!;
    out += cur.latin;
    if (cur.kind !== 'C' || cur.joined) continue;
    const next = u[i + 1];
    if (next && next.kind === 'C') out += 'o';
  }
  return out;
}

/** Strips diacritics and non-alphanumerics, lowercases; Bangla digits become Latin. */
export function foldLatin(input: string): string {
  return toLatinDigits(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Phonetic skeleton of one Latin name token: digraph folding, then every vowel after the first character
 * dropped, then runs collapsed. `rahim`, `raheem` and `rohim` → `rhm`; `mohammad` and `muhammed` → `mhmd`.
 */
export function skeleton(token: string): string {
  let t = token.toLowerCase();
  t = t
    .replace(/ph/g, 'f')
    .replace(/kh|gh|q/g, 'k')
    .replace(/ch|sh|ss|ce|ci|cy/g, 's')
    .replace(/th|tt/g, 't')
    .replace(/dh|dd/g, 'd')
    .replace(/bh/g, 'b')
    .replace(/jh|z|zz|j/g, 'j')
    .replace(/w|v/g, 'b')
    .replace(/ck|c|k/g, 'k')
    .replace(/y|ii|ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/x/g, 'ks');
  if (t.length <= 1) return t;
  const head = t[0] ?? '';
  const rest = t.slice(1).replace(/[aeiou]/g, '');
  return (head + rest).replace(/(.)\1+/g, '$1');
}

export interface SearchTokens {
  /** Folded Latin name tokens (Bangla transliterated), honorifics removed, unique, ≥ 2 chars. */
  names: string[];
  /** Phonetic skeletons of `names`, unique. */
  skeletons: string[];
  version: number;
}

/** Tokenizes a name (Bangla, Latin or mixed) into indexable and queryable tokens. */
export function nameSearchTokens(...inputs: Array<string | null | undefined>): SearchTokens {
  const names = new Set<string>();
  for (const input of inputs) {
    if (!input) continue;
    const latin = BANGLA_RE.test(input) ? transliterateBangla(input) : input;
    for (const raw of foldLatin(latin).split(' ')) {
      const tok = raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
      if (tok.length < 2 || HONORIFICS.has(tok)) continue;
      names.add(tok.slice(0, 64));
    }
  }
  const skeletons = new Set<string>();
  for (const n of names) {
    const s = skeleton(n);
    if (s.length >= 2) skeletons.add(s.slice(0, 64));
  }
  return { names: [...names], skeletons: [...skeletons], version: SEARCH_NORMALIZATION_VERSION };
}

/** Jaccard similarity of two skeleton sets (0–1); 0 when either is empty. Used by duplicate scoring. */
export function skeletonSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Medication catalog search key (DATABASE-IMPLEMENTATION.md §3.8, ADR-020; MEDDATA-001).
 *
 * NFKC → lowercase → Bangla digits to ASCII → punctuation and whitespace runs collapsed to one space.
 *
 * Deliberately *not* `foldLatin`. That one folds everything to `[a-z0-9]` for patient-name matching, which
 * would erase a Bangla brand name entirely — and `brand_bn_search_key` exists precisely so a doctor can
 * type the brand as it appears on the packet. This keeps every script and only normalizes the things that
 * vary without meaning: width, case, digit system, and punctuation a person would not think about when
 * typing "Napa-500" versus "napa 500".
 */
export function medicationSearchKey(input: string | null | undefined): string {
  if (!input) return '';
  return (
    toLatinDigits(input.normalize('NFKC'))
      .toLowerCase()
      // `\p{M}` matters: Bangla vowel signs and the hasant are combining marks, not letters, so a class of
      // letters and numbers alone tears "ন্যাপা" into "ন য প" — three disconnected consonants that would
      // never match what a doctor typed. The class keeps marks attached to the letters they belong to.
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
