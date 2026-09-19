/**
 * Medical record number (DATABASE §3.4 `medical_record_number`, unique per tenant). Derived from the
 * patient's UUIDv7 so allocation needs no counter row or lock: the last 10 bytes of the id (the random part)
 * in Crockford base32, grouped for reading aloud at a desk: `P-XXXX-XXXX-XXXX-XXXX`.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const MRN_RE =
  /^P-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export function mrnFromId(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('mrnFromId: not a uuid');
  // 10 bytes = 80 bits = 16 base32 characters.
  const bytes = Buffer.from(hex.slice(12), 'hex');
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out = ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return `P-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

/** Normalizes user input (`p-abcd 1234…`, Bangla digits handled upstream) to the canonical MRN or null. */
export function normalizeMrn(input: string): string | null {
  const raw = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/^P/, '');
  const fixed = raw.replace(/I/g, '1').replace(/L/g, '1').replace(/O/g, '0');
  if (fixed.length !== 16) return null;
  const mrn = `P-${fixed.slice(0, 4)}-${fixed.slice(4, 8)}-${fixed.slice(8, 12)}-${fixed.slice(12, 16)}`;
  return MRN_RE.test(mrn) ? mrn : null;
}
