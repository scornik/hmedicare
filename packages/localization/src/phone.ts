import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { toLatinDigits } from './digits';

/**
 * Bangladesh phone normalization (AUTH-IMPLEMENTATION.md §2.1). Accepted inputs: `01XXXXXXXXX`,
 * `8801XXXXXXXXX`, `+8801XXXXXXXXX`, `008801…`, with spaces, dashes, dots or parentheses, in ASCII or
 * Bangla digits. Output: E.164 `+8801XXXXXXXXX` for valid BD **mobile** numbers only (OTP-capable).
 */
export const BD_MOBILE_E164_RE = /^\+8801[3-9]\d{8}$/;

export function normalizeBdMobile(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  let s = toLatinDigits(input.trim()).replace(/[\s\-.()]/g, '');
  if (s.length === 0 || s.length > 20) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^8801\d{9}$/.test(s)) s = `+${s}`;
  if (!/^\+?\d+$/.test(s)) return null;
  const parsed = parsePhoneNumberFromString(s, 'BD');
  if (!parsed || parsed.country !== 'BD' || !parsed.isValid()) return null;
  const type = parsed.getType();
  if (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') return null;
  const e164 = parsed.number;
  return BD_MOBILE_E164_RE.test(e164) ? e164 : null;
}

export function isBdMobileE164(value: string): boolean {
  return BD_MOBILE_E164_RE.test(value);
}

/** Display mask for staff UIs and support: `+8801*******45`. Never used as an identifier. */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return '*'.repeat(e164.length);
  return `${e164.slice(0, 5)}${'*'.repeat(e164.length - 7)}${e164.slice(-2)}`;
}
