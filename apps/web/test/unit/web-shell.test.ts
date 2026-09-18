import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../src/i18n/messages';
import { assertNoSecretNames } from '../../vite.config';

const session = () => import('../../src/auth/session');

describe('web shell', () => {
  it('bn-BD and en-BD have identical message keys and no empty strings', () => {
    const bn = Object.keys(MESSAGES['bn-BD']).sort();
    const en = Object.keys(MESSAGES['en-BD']).sort();
    expect(en).toEqual(bn);
    for (const l of Object.values(MESSAGES)) for (const v of Object.values(l)) expect(v.trim()).not.toBe('');
  });

  it('refuses to build with secret-looking VITE_* names (WEB-IMPLEMENTATION §3)', () => {
    expect(() => assertNoSecretNames({ VITE_API_BASE_URL: 'x', VITE_APP_ENV: 'dev' })).not.toThrow();
    for (const name of ['VITE_API_KEY', 'VITE_SECRET', 'VITE_AUTH_TOKEN', 'VITE_DB_PASSWORD']) {
      expect(() => assertNoSecretNames({ [name]: 'x' })).toThrow(name);
    }
    expect(() => assertNoSecretNames({ ZAMANIT_API_KEY: 'x' })).not.toThrow(); // not exposed to the bundle
  });

  describe('AuthSession', () => {
    const body = (token: string) => ({
      data: {
        accessToken: token,
        accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        csrfToken: 'csrf-1',
        user: { id: 'u', displayName: 'Demo', email: null, phoneMasked: null },
      },
    });
    const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });

    beforeEach(() => vi.resetModules());
    afterEach(() => vi.unstubAllGlobals());

    it('single-flights concurrent refreshes and keeps tokens out of web storage', async () => {
      const storage = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
      vi.stubGlobal('localStorage', storage);
      vi.stubGlobal('sessionStorage', storage);
      const calls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => {
          calls.push(url.replace(/^.*\/api\/v1/, ''));
          if (url.endsWith('/auth/session/csrf')) return ok({ data: { csrfToken: 'csrf-1' } });
          expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-1');
          expect(init.credentials).toBe('include');
          return ok(body('access-1'));
        }),
      );
      const s = await session();
      const results = await Promise.all([s.refresh(), s.refresh(), s.refresh()]);
      expect(results).toEqual([true, true, true]);
      expect(calls).toEqual(['/auth/session/csrf', '/auth/session/refresh']);
      expect(s.getAccessToken()).toBe('access-1');
      expect(storage.setItem).not.toHaveBeenCalled();
      s.clear(false);
    });

    it('a failed refresh signs out; logout sends CSRF and clears memory', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status: 401 })),
      );
      const s = await session();
      expect(await s.refresh()).toBe(false);
      expect(s.getAccessToken()).toBeNull();

      const seen: Array<{ url: string; init: RequestInit }> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => {
          seen.push({ url, init });
          return ok(body('access-2'));
        }),
      );
      await s.loginWithPassword('owner@example.invalid', 'not-a-real-password');
      expect(s.getAccessToken()).toBe('access-2');
      await s.logout();
      const del = seen.find((x) => x.init.method === 'DELETE')!;
      expect(del.url).toMatch(/\/api\/v1\/auth\/session$/);
      expect((del.init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-1');
      expect(s.getAccessToken()).toBeNull();
    });
  });
});
