import { hmacHex, randomToken, safeEqual } from './crypto';

/**
 * Signed double-submit CSRF tokens for cookie-authenticated web endpoints (ADR-013 §2, AUTH §1):
 * `token = nonce "." HMAC(CSRF_SECRET, sessionId ‖ nonce)`. The same value is set in the
 * `__Host-hm_csrf` cookie (HttpOnly, SameSite=Strict) and returned in the body; the client echoes it in
 * `X-CSRF-Token`. Valid only when header == cookie and the signature binds it to the session.
 */
export class CsrfService {
  constructor(private readonly secret: string) {}

  issue(sessionId: string): string {
    const nonce = randomToken(16);
    return `${nonce}.${hmacHex(this.secret, 'csrf', sessionId, nonce)}`;
  }

  verify(sessionId: string, header: string | undefined, cookie: string | undefined): boolean {
    if (!header || !cookie || !safeEqual(header, cookie)) return false;
    const dot = header.indexOf('.');
    if (dot <= 0) return false;
    const nonce = header.slice(0, dot);
    const sig = header.slice(dot + 1);
    return safeEqual(sig, hmacHex(this.secret, 'csrf', sessionId, nonce));
  }
}
