import { type Page, type Route, expect, test } from '@playwright/test';

const API = 'http://localhost:3999/api/v1';
const TENANT = '00000000-0000-4000-8000-00000000000a';
const ACCESS = 'mock-access-token-value';

const session = {
  accessToken: ACCESS,
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  csrfToken: 'mock-csrf',
  user: {
    id: 'u1',
    displayName: 'Demo Owner',
    email: 'owner@example.invalid',
    phoneMasked: null,
    emailVerified: true,
    phoneVerified: false,
  },
};

interface MockState {
  loggedOut: boolean;
  forbidden: boolean;
  deleteSawCsrf: boolean;
}

const cors = {
  'access-control-allow-origin': 'http://localhost:4173',
  'access-control-allow-credentials': 'true',
};
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    headers: { ...cors, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Mocked API: no refresh cookie at first (reload → /login), then password or OTP login. */
async function mockApi(page: Page, opts: Partial<MockState> = {}) {
  const state: MockState = { loggedOut: false, forbidden: false, deleteSawCsrf: false, ...opts };
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    if (req.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
      });
    if (path === '/auth/session/csrf') return json(route, 401, { code: 'UNAUTHENTICATED' });
    if (path === '/auth/password/login' || path === '/auth/otp/verify')
      return json(route, 200, { data: session });
    if (path === '/auth/otp/request')
      return json(route, 202, {
        data: { challengeId: TENANT, expiresAt: session.accessTokenExpiresAt, hint: 'SENT' },
      });
    if (path === '/auth/session' && req.method() === 'DELETE') {
      state.loggedOut = true;
      state.deleteSawCsrf = req.headers()['x-csrf-token'] === 'mock-csrf';
      return route.fulfill({ status: 204, headers: cors });
    }
    expect(req.headers()['authorization']).toBe(`Bearer ${ACCESS}`);
    if (path === '/me')
      return json(route, 200, {
        data: {
          user: session.user,
          memberships: [
            { membershipId: TENANT, tenantId: TENANT, tenantName: 'Demo Clinic', role: 'tenant_owner' },
          ],
          platformOperator: false,
        },
      });
    if (path === '/me/tenant-context') {
      expect(req.headers()['x-tenant-id']).toBe(TENANT);
      if (state.forbidden) return json(route, 403, { code: 'FORBIDDEN' });
      return json(route, 200, {
        data: {
          tenantId: TENANT,
          role: 'tenant_owner',
          permissions: ['tenant.read', 'membership.manage'],
          rolePermissionsVersion: 2,
        },
      });
    }
    return json(route, 404, { code: 'NOT_FOUND' });
  });
  return state;
}

async function passwordLogin(page: Page) {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByLabel('Email').fill('owner@example.invalid');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/select-tenant$/);
}

test('password login → tenant picker → dashboard; token never in web storage; logout', async ({ page }) => {
  const state = await mockApi(page);
  await passwordLogin(page);
  await page.getByRole('button', { name: /Demo Clinic/ }).click();
  await expect(page.getByTestId('role')).toHaveText('tenant_owner');
  await expect(page.getByTestId('permission-count')).toHaveText('2');

  const stored = await page.evaluate(
    () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie,
  );
  expect(stored).not.toContain(ACCESS);
  expect(stored).not.toContain('mock-csrf');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(state.loggedOut).toBe(true);
  expect(state.deleteSawCsrf).toBe(true);
});

test('patient OTP login (mock) defaults to Bangla', async ({ page }) => {
  await mockApi(page);
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await page.getByRole('tab', { name: 'রোগী (ফোন)' }).click();
  await page.getByLabel('মোবাইল নম্বর').fill('01700000001');
  await page.getByRole('button', { name: 'কোড পাঠান' }).click();
  await expect(page.getByRole('status')).toHaveText('কোড পাঠানো হয়েছে।');
  await page.getByLabel('ছয় অঙ্কের কোড').fill('123456');
  await page.getByRole('button', { name: 'যাচাই করুন' }).click();
  await expect(page).toHaveURL(/\/select-tenant$/);
});

test('403 when the tenant context is forbidden; 404 for unknown deep links (SPA fallback)', async ({
  page,
}) => {
  await mockApi(page, { forbidden: true });
  await passwordLogin(page);
  await page.getByRole('button', { name: /Demo Clinic/ }).click();
  await expect(page).toHaveURL(/\/forbidden$/);
  await expect(page.getByRole('heading', { name: '403' })).toBeVisible();

  const res = await page.goto('/no/such/page');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
});

test('offline page when the network drops', async ({ page, context }) => {
  await mockApi(page);
  await page.goto('/login');
  await context.setOffline(true);
  await expect(page.getByRole('alert')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
