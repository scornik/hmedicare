import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes, base64url (refresh tokens, reset tokens, CSRF nonces). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const SEPARATOR = String.fromCharCode(1);

/** HMAC-SHA-256 hex with a pepper (token hashes, OTP code hashes, destination hashes). */
export function hmacHex(pepper: string, ...parts: string[]): string {
  const h = createHmac('sha256', pepper);
  parts.forEach((p, i) => {
    if (i > 0) h.update(SEPARATOR);
    h.update(p);
  });
  return h.digest('hex');
}

/** Constant-time string equality (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
