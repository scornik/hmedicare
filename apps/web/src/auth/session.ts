/**
 * AuthSession (WEB-IMPLEMENTATION §2, ADR-013 §2). The access token and CSRF token live ONLY in this module
 * closure: never in React state, localStorage or sessionStorage. The refresh token is the httpOnly
 * `__Host-hm_rt` cookie on the API origin, reachable only through the auth endpoints below.
 * - single-flight refresh at 80% of the access-token lifetime and on 401;
 * - after a reload: POST /auth/session/csrf (cookie) then refresh;
 * - logout (credentials + CSRF) clears memory and broadcasts to other tabs over BroadcastChannel('hm-auth').
 */
export interface SessionUser {
  id: string;
  displayName: string | null;
  email: string | null;
  phoneMasked: string | null;
}

interface SessionState {
  accessToken: string;
  expiresAt: number;
  csrfToken: string | null;
  user: SessionUser;
}

type Listener = (signedIn: boolean) => void;

let state: SessionState | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<boolean> | null = null;
const listeners = new Set<Listener>();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('hm-auth') : null;

/**
 * Where the API lives, in one place (DEPLOY-001, ADR-023).
 *
 * Empty means same origin, which is what the deployed single-app profile serves: this client comes from
 * the same Node app as the API, so relative requests reach it and no CORS applies. `pnpm dev` runs the
 * client on 5173 and the API on 3000, so development keeps an explicit origin.
 *
 * Splitting the client onto its own subdomain later is this one variable plus `CORS_ALLOWED_ORIGINS` on
 * the server — no code change.
 */
export const apiBase = (): string =>
  (import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:3000' : '')).replace(
    /\/+$/,
    '',
  );

function notify() {
  for (const l of listeners) l(state !== null);
}

export function onAuthChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getAccessToken(): string | null {
  return state?.accessToken ?? null;
}

export function currentUser(): SessionUser | null {
  return state?.user ?? null;
}

function schedule() {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!state) return;
  const lifetime = state.expiresAt - Date.now();
  refreshTimer = setTimeout(() => void refresh(), Math.max(5_000, lifetime * 0.8));
}

interface SessionBody {
  accessToken: string;
  accessTokenExpiresAt: string;
  csrfToken?: string;
  user: SessionUser;
}

export function establish(body: SessionBody): void {
  state = {
    accessToken: body.accessToken,
    expiresAt: Date.parse(body.accessTokenExpiresAt),
    csrfToken: body.csrfToken ?? state?.csrfToken ?? null,
    user: body.user,
  };
  schedule();
  notify();
}

export function clear(broadcast = true): void {
  state = null;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (broadcast) channel?.postMessage({ type: 'logout' });
  notify();
}

channel?.addEventListener('message', (e: MessageEvent<{ type?: string }>) => {
  if (e.data?.type === 'logout') clear(false);
});

async function post(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${apiBase()}/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  });
}

/** Single-flight refresh; returns false (signed out) on failure. */
export function refresh(): Promise<boolean> {
  inFlight ??= (async () => {
    try {
      let csrf = state?.csrfToken ?? null;
      if (!csrf) {
        const r = await post('/auth/session/csrf', { body: '{}' });
        if (!r.ok) throw new Error('no session');
        csrf = ((await r.json()) as { data: { csrfToken: string } }).data.csrfToken;
      }
      const r = await post('/auth/session/refresh', { body: '{}', headers: { 'x-csrf-token': csrf } });
      if (!r.ok) throw new Error('refresh failed');
      establish(((await r.json()) as { data: SessionBody }).data);
      return true;
    } catch {
      clear(false);
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function idempotencyKey(): string {
  return crypto.randomUUID();
}

export async function loginWithPassword(email: string, password: string): Promise<void> {
  const r = await post('/auth/password/login', {
    body: JSON.stringify({ email, password, client: 'web' }),
    headers: { 'idempotency-key': idempotencyKey() },
  });
  if (!r.ok) throw Object.assign(new Error('login failed'), { status: r.status });
  establish(((await r.json()) as { data: SessionBody }).data);
}

export async function requestOtp(phone: string, locale: string): Promise<{ hint: string }> {
  const r = await post('/auth/otp/request', {
    body: JSON.stringify({ phone, locale }),
    headers: { 'idempotency-key': idempotencyKey() },
  });
  if (!r.ok) throw Object.assign(new Error('otp request failed'), { status: r.status });
  return ((await r.json()) as { data: { hint: string } }).data;
}

export async function verifyOtp(phone: string, code: string): Promise<void> {
  const r = await post('/auth/otp/verify', {
    body: JSON.stringify({ phone, code, client: 'web' }),
    headers: { 'idempotency-key': idempotencyKey() },
  });
  if (!r.ok) throw Object.assign(new Error('otp verify failed'), { status: r.status });
  establish(((await r.json()) as { data: SessionBody }).data);
}

export async function logout(): Promise<void> {
  const token = getAccessToken();
  try {
    if (token) {
      await fetch(`${apiBase()}/api/v1/auth/session`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          authorization: `Bearer ${token}`,
          ...(state?.csrfToken ? { 'x-csrf-token': state.csrfToken } : {}),
        },
      });
    }
  } finally {
    clear(true);
  }
}
