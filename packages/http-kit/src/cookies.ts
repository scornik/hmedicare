/**
 * Minimal cookie parsing/serialization (no dependency). Used only by the web auth transport
 * (`__Host-hm_rt`, `__Host-hm_csrf`, ADR-013 §2). Values are opaque base64url tokens.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && !(name in out)) {
      try {
        out[name] = decodeURIComponent(value);
      } catch {
        /* ignore malformed values */
      }
    }
  }
  return out;
}

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax';
  path: string;
  /** Seconds; 0 expires the cookie. */
  maxAge: number;
}

export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${o.path}`,
    `Max-Age=${Math.max(0, Math.floor(o.maxAge))}`,
  ];
  if (o.maxAge <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (o.httpOnly) parts.push('HttpOnly');
  if (o.secure) parts.push('Secure');
  parts.push(`SameSite=${o.sameSite}`);
  return parts.join('; ');
}
