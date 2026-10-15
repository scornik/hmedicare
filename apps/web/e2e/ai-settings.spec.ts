import { test, expect, type Page } from '@playwright/test';

const tenant = '00000000-0000-4000-8000-00000000000a';
async function prepare(page: Page, manage = true, conflict = false) {
  const state = { writes: [] as Record<string, unknown>[], denied: false };
  let policy = {
    aiEnabled: false,
    freeTierAiAllowed: true,
    freeTierEffective: false,
    freeTierForcedOffByProductionGate: true,
    minimizationRequiredForNoTraining: true,
    rawOutputRetentionDays: 30,
    minAiConsentPolicyVersion: 1,
    policyTextVersion: '1',
    allowedProviderCodes: ['mock'],
    policyVersion: 1,
    rowVersion: 4,
    decidedByUserId: null,
    decidedAt: null,
  };
  const user = { id: 'u1', displayName: 'Demo Owner', email: 'demo@example.invalid', phoneMasked: null };
  await page.addInitScript((t) => {
    localStorage.setItem('hm.tenant', t);
    localStorage.setItem('hm.locale', 'en-BD');
  }, tenant);
  await page.route('http://localhost:3999/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const headers = {
      'access-control-allow-origin': 'http://localhost:4173',
      'access-control-allow-credentials': 'true',
      'content-type': 'application/json',
    };
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, headers, body: JSON.stringify(status === 200 ? { data } : data) });
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: { ...headers, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
      });
    if (path === '/auth/session/csrf') return json({ csrfToken: 'mock-csrf' });
    if (path === '/auth/session/refresh')
      return json({
        accessToken: 'mock-token',
        accessTokenExpiresAt: new Date(Date.now() + 900000).toISOString(),
        csrfToken: 'mock-csrf',
        user,
      });
    if (path === '/me')
      return json({
        user,
        memberships: [
          { membershipId: tenant, tenantId: tenant, tenantName: 'Demo Clinic', role: 'tenant_owner' },
        ],
        platformOperator: false,
      });
    if (path === '/me/tenant-context')
      return json({
        tenantId: tenant,
        role: 'tenant_owner',
        permissions: manage ? ['ai.policy.read', 'ai.policy.manage'] : ['ai.policy.read'],
        rolePermissionsVersion: 1,
      });
    if (path === '/tenant/ai-policy') {
      expect(route.request().headers()['x-tenant-id']).toBe(tenant);
      if (state.denied) return json({ code: 'FORBIDDEN' }, 403);
      if (route.request().method() === 'PUT') {
        expect(route.request().headers()['idempotency-key']).toBeTruthy();
        const body = route.request().postDataJSON() as Record<string, unknown>;
        state.writes.push(body);
        if (conflict) return json({ code: 'STALE_VERSION' }, 409);
        policy = { ...policy, aiEnabled: body.aiEnabled as boolean, rowVersion: 5, policyVersion: 2 };
      }
      return json(policy);
    }
    return json({ code: 'NOT_FOUND' }, 404);
  });
  await page.goto('/settings/ai');
  await expect(page.getByTestId('ai-policy-settings')).toBeVisible();
  return state;
}

test('tenant owner sees effective policy and saves a versioned decision', async ({ page }) => {
  const state = await prepare(page);
  await expect(page.getByTestId('ai-free-effective')).toContainText('off');
  await expect(page.getByText('The server currently blocks free-tier use', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save policy', exact: true })).toBeDisabled();
  await page.getByLabel('Enable AI assistance', { exact: true }).check();
  await page.getByLabel('Reason for change').fill('Enable synthetic doctor workflow');
  await page.getByRole('button', { name: 'Save policy', exact: true }).click();
  await expect(page.getByText('Policy version: 2', { exact: true })).toBeVisible();
  expect(state.writes).toEqual([
    expect.objectContaining({
      expectedRowVersion: 4,
      aiEnabled: true,
      reason: 'Enable synthetic doctor workflow',
      rawOutputRetentionDays: 30,
      allowedProviderCodes: ['mock'],
    }),
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/ai-settings-phone.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  state.denied = true;
  await page.getByRole('button', { name: 'Reload policy' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.getByTestId('ai-policy-settings')).toHaveCount(0);
});

test('policy readers cannot save', async ({ page }) => {
  await prepare(page, false);
  await expect(page.getByLabel('Enable AI assistance', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save policy', exact: true })).toBeDisabled();
});

test('a stale policy decision never automatically retries the write', async ({ page }) => {
  const state = await prepare(page, true, true);
  await page.getByLabel('Reason for change').fill('Synthetic policy update');
  await page.getByRole('button', { name: 'Save policy', exact: true }).click();
  await expect(page.getByText('The save could not be confirmed.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save policy', exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Reload policy' }).click();
  await expect(page.getByLabel('Reason for change')).toHaveValue('');
});
