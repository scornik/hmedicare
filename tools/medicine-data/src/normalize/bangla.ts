/**
 * Bangla helpers. Real Bangla names come only from sources. `transliterateBnToLatin` produces
 * machine-generated Banglish search aliases, which must be stored with alias_origin "generated"
 * and never shown as an official name.
 */
export function normalizeBangla(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

const INDEPENDENT_VOWELS: Record<string, string> = { 'অ': 'o', 'আ': 'a', 'ই': 'i', 'ঈ': 'i', 'উ': 'u', 'ঊ': 'u', 'ঋ': 'ri', 'এ': 'e', 'ঐ': 'oi', 'ও': 'o', 'ঔ': 'ou' };
const VOWEL_SIGNS: Record<string, string> = { 'া': 'a', 'ি': 'i', 'ী': 'i', 'ু': 'u', 'ূ': 'u', 'ৃ': 'ri', 'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou' };
const CONSONANTS: Record<string, string> = {
  'ক': 'k', 'খ': 'kh', 'গ': 'g', 'ঘ': 'gh', 'ঙ': 'ng', 'চ': 'ch', 'ছ': 'chh', 'জ': 'j', 'ঝ': 'jh', 'ঞ': 'n',
  'ট': 't', 'ঠ': 'th', 'ড': 'd', 'ঢ': 'dh', 'ণ': 'n', 'ত': 't', 'থ': 'th', 'দ': 'd', 'ধ': 'dh', 'ন': 'n',
  'প': 'p', 'ফ': 'f', 'ব': 'b', 'ভ': 'bh', 'ম': 'm', 'য': 'j', 'র': 'r', 'ল': 'l', 'শ': 'sh', 'ষ': 'sh',
  'স': 's', 'হ': 'h', 'ড়': 'r', 'ঢ়': 'rh', 'য়': 'y', 'ৎ': 't'
};
const MARKS: Record<string, string> = { 'ং': 'ng', 'ঃ': 'h', 'ঁ': 'n' };
const HASANTA = '্';
const DIGITS = '০১২৩৪৫৬৭৮৯';

export function transliterateBnToLatin(input: string): string {
  const text = normalizeBangla(input).normalize('NFC');
  let out = '';
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (CONSONANTS[ch] !== undefined) {
      out += CONSONANTS[ch];
      if (next === HASANTA) { i++; continue; }
      if (next && VOWEL_SIGNS[next] !== undefined) { out += VOWEL_SIGNS[next]; i++; continue; }
      // Inherent vowel (schwa-deletion approximation): dropped at word end and before a consonant that
      // carries its own vowel sign (সেকলো → seklo), kept otherwise (কমল → komol).
      const atWordEnd = !next || !/[ঀ-৿]/.test(next) || MARKS[next] !== undefined;
      const nextHasVowelSign = CONSONANTS[next] !== undefined && chars[i + 2] !== undefined && VOWEL_SIGNS[chars[i + 2]] !== undefined;
      if (!atWordEnd && !(nextHasVowelSign && i > 0)) out += 'o';
      continue;
    }
    if (INDEPENDENT_VOWELS[ch] !== undefined) { out += INDEPENDENT_VOWELS[ch]; continue; }
    if (VOWEL_SIGNS[ch] !== undefined) { out += VOWEL_SIGNS[ch]; continue; }
    if (MARKS[ch] !== undefined) { out += MARKS[ch]; continue; }
    if (ch === HASANTA) continue;
    const digit = DIGITS.indexOf(ch);
    out += digit >= 0 ? String(digit) : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}
