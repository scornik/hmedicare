import { test, expect, type Page } from '@playwright/test';
const tenant = '00000000-0000-4000-8000-00000000000a';
const doctor = '00000000-0000-4000-8000-00000000000b';
const credentialId = '00000000-0000-4000-8000-00000000000c';
const ackId = '00000000-0000-4000-8000-00000000000d';
const secret = 'synthetic-provider-key-123456789';
async function prepare(page: Page, unknown?: 'ack' | 'create') {
  const state = { denied: false, creates: 0, acknowledgements: 0, actions: [] as string[] };
  let credential: Record<string, unknown> | null = null;
  const user = { id: 'u1', displayName: 'Demo Doctor', email: 'demo@example.invalid', phoneMasked: null };
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
        memberships: [{ membershipId: tenant, tenantId: tenant, tenantName: 'Demo Clinic', role: 'doctor' }],
        platformOperator: false,
      });
    if (path === '/me/tenant-context')
      return json({
        tenantId: tenant,
        role: 'doctor',
        permissions: ['ai.use', 'ai.policy.read'],
        rolePermissionsVersion: 1,
      });
    expect(route.request().headers()['x-tenant-id']).toBe(tenant);
    if (state.denied) return json({ code: 'FORBIDDEN' }, 403);
    if (path === '/me/ai/credentials')
      return json({ doctorProfileId: doctor, items: credential ? [credential] : [] });
    if (path === '/tenant/ai-policy')
      return json({ aiEnabled: true, freeTierEffective: false, allowedProviderCodes: ['mock'] });
    if (path === '/ai/acknowledgement-texts')
      return json({
        items: ['FREE', 'PAID'].map((tier) => ({
          version: 'account-1',
          tier,
          locale: 'en-BD',
          body: `SYNTHETIC ${tier} data-use statement`,
          sha256: 'a'.repeat(64),
        })),
      });
    if (path === '/ai/acknowledgements') {
      state.acknowledgements++;
      expect(route.request().postDataJSON()).toEqual({
        doctorProfileId: doctor,
        providerCode: 'mock',
        tier: 'PAID',
        locale: 'en-BD',
        termsTextVersion: 'account-1',
      });
      if (unknown === 'ack') return json({ code: 'INTERNAL_ERROR' }, 503);
      return json({ id: ackId });
    }
    if (path === `/doctors/${doctor}/ai/credentials`) {
      state.creates++;
      expect(state.acknowledgements).toBe(1);
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      expect(route.request().postDataJSON()).toEqual({
        providerCode: 'mock',
        declaredTier: 'PAID',
        billingMode: 'DOCTOR_BYOK_PAID',
        secret,
        dataUseAckId: ackId,
      });
      credential = {
        id: credentialId,
        doctorProfileId: doctor,
        providerCode: 'mock',
        declaredTier: 'PAID',
        billingMode: 'DOCTOR_BYOK_PAID',
        status: 'PENDING_VALIDATION',
        secretLast4: '6789',
        rowVersion: 1,
        validatedAt: null,
        lastErrorClass: null,
      };
      if (unknown === 'create') return json({ code: 'INTERNAL_ERROR' }, 503);
      return json(credential);
    }
    if (path === `/doctors/${doctor}/ai/credentials/${credentialId}/actions`) {
      const body = route.request().postDataJSON();
      expect(body.expectedRowVersion).toBe(credential!.rowVersion);
      state.actions.push(body.action);
      credential = {
        ...credential,
        rowVersion: Number(credential!.rowVersion) + 1,
        status: body.action === 'REVOKE' ? 'REVOKED' : 'PENDING_VALIDATION',
      };
      return json(credential);
    }
    return json({ code: 'NOT_FOUND' }, 404);
  });
  await page.goto('/settings/ai/accounts');
  await expect(page.getByText('No AI account saved yet.')).toBeVisible();
  return state;
}
async function fill(page: Page) {
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('mock');
  await page.getByLabel('API key (write-only)', { exact: true }).fill(secret);
  await expect(page.getByRole('button', { name: 'Save account', exact: true })).toBeDisabled();
  await expect(page.getByTestId('ai-account-data-use')).toHaveText('SYNTHETIC PAID data-use statement');
  await page.getByRole('checkbox').check();
}
test('doctor reads data-use statement, saves a cleared key and manages versioned credentials', async ({
  page,
}) => {
  const state = await prepare(page);
  await fill(page);
  await page.getByRole('button', { name: 'Save account', exact: true }).click();
  await expect(page.getByLabel('API key (write-only)', { exact: true })).toHaveValue('');
  await expect(page.getByRole('listitem')).toContainText('PENDING_VALIDATION');
  expect(state.creates).toBe(1);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }),
    ),
  ).not.toContain(secret);
  await page.getByRole('button', { name: 'Request validation', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByRole('listitem')).toContainText('REVOKED');
  expect(state.actions).toEqual(['REVALIDATE', 'REVOKE']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/ai-accounts-phone.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  state.denied = true;
  await page.getByRole('button', { name: 'Refresh accounts', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByLabel('API key (write-only)', { exact: true })).toHaveCount(0);
});
test('an unconfirmed acknowledgement clears the key and never retries account creation', async ({ page }) => {
  const state = await prepare(page, 'ack');
  await fill(page);
  await page.getByRole('button', { name: 'Save account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('could not be confirmed');
  await expect(page.getByLabel('API key (write-only)', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Save account', exact: true })).toBeDisabled();
  expect(state.acknowledgements).toBe(1);
  expect(state.creates).toBe(0);
});

test('a lost create response recovers the saved account with reads only', async ({ page }) => {
  const state = await prepare(page, 'create');
  await fill(page);
  await page.getByRole('button', { name: 'Save account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('could not be confirmed');
  await expect(page.getByLabel('API key (write-only)', { exact: true })).toHaveValue('');
  expect(state.creates).toBe(1);
  await page.getByRole('button', { name: 'Refresh accounts', exact: true }).click();
  await expect(page.getByRole('listitem')).toContainText('PENDING_VALIDATION');
  expect(state.creates).toBe(1);
  expect(state.acknowledgements).toBe(1);
});
