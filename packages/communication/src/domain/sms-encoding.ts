/**
 * SMS encoding and segment estimates (ADR-018 §3). `text` when every character is in the GSM 03.38 default
 * alphabet or its extension table, else `unicode` (any Bangla forces unicode). Segments:
 * GSM-7 ≤ 160 septets → 1, else ⌈septets / 153⌉ (extension characters count 2);
 * UCS-2 ≤ 70 UTF-16 code units → 1, else ⌈units / 67⌉. Labelled an estimate until ZAMANIT-VER-07.
 */
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENSION = '^{}\\[~]|€\f';

const BASIC = new Set([...GSM_BASIC]);
const EXTENSION = new Set([...GSM_EXTENSION]);

export type SmsEncoding = 'text' | 'unicode';

export function smsEncoding(text: string): SmsEncoding {
  for (const ch of text) {
    if (!BASIC.has(ch) && !EXTENSION.has(ch)) return 'unicode';
  }
  return 'text';
}

export function gsmSeptets(text: string): number {
  let n = 0;
  for (const ch of text) n += EXTENSION.has(ch) ? 2 : 1;
  return n;
}

export function estimateSegments(text: string): { encoding: SmsEncoding; segments: number; units: number } {
  const encoding = smsEncoding(text);
  if (encoding === 'text') {
    const units = gsmSeptets(text);
    return { encoding, units, segments: units <= 160 ? 1 : Math.ceil(units / 153) };
  }
  const units = text.length; // UTF-16 code units
  return { encoding, units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}
