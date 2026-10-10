import { test, expect, type Page } from '@playwright/test';
const token = 'SyntheticLinkToken1234',
  tenant = '00000000-0000-4000-8000-00000000000a',
  remembered = '00000000-0000-4000-8000-00000000000b',
  patient = '00000000-0000-4000-8000-000000000101';
async function prepare(page: Page, authenticated = true, expired = false) {
  let denied = false,
    timelineRequests = 0;
  const headers = {
    'access-control-allow-origin': 'http://localhost:4173',
    'access-control-allow-credentials': 'true',
    'content-type': 'application/json',
  };
  const user = { id: 'u1', displayName: 'Demo User', email: 'demo@example.invalid', phoneMasked: null };
  const session = () => ({
    accessToken: 'mock-token',
    accessTokenExpiresAt: new Date(Date.now() + 900000).toISOString(),
    csrfToken: 'mock-csrf',
    user,
  });
  await page.addInitScript((t) => localStorage.setItem('hm.tenant', t), remembered);
  await page.route('http://localhost:3999/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, headers, body: JSON.stringify(status === 200 ? { data } : data) });
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          ...headers,
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    if (path === '/auth/session/csrf')
      return authenticated ? json({ csrfToken: 'mock-csrf' }) : json({ code: 'UNAUTHENTICATED' }, 401);
    if (path === '/auth/session/refresh')
      return authenticated ? json(session()) : json({ code: 'UNAUTHENTICATED' }, 401);
    if (path === '/auth/password/login') {
      authenticated = true;
      return json(session());
    }
    if (path === '/me/patient-contexts') {
      expect(route.request().headers()['x-tenant-id']).toBeUndefined();
      if (denied) return json({ code: 'FORBIDDEN' }, 403);
      return json([
        {
          tenantId: tenant,
          tenantName: 'Demo Clinic',
          patientId: patient,
          patientDisplayName: 'Demo Patient',
          relationship: 'SELF',
          authorityScope: [],
        },
        {
          tenantId: remembered,
          tenantName: 'Other Clinic',
          patientId: remembered,
          patientDisplayName: 'Other Patient',
          relationship: 'PARENT',
          authorityScope: ['BOOK_APPOINTMENTS'],
        },
      ]);
    }
    if (path === '/communication-links/' + token || path === '/patients/' + patient + '/timeline') {
      expect(route.request().headers()['x-tenant-id']).toBe(tenant);
      expect(route.request().headers()['x-patient-context']).toBe(patient);
      if (denied) return json({ code: 'FORBIDDEN' }, 403);
      if (path.startsWith('/communication-links/'))
        return expired
          ? json({ code: 'RESOURCE_NOT_FOUND' }, 404)
          : json({ targetType: 'PATIENT_TIMELINE', patientId: patient });
      timelineRequests++;
      return json({
        items: [
          {
            id: patient,
            eventType: 'prescription_finalized',
            occurredAt: '2026-10-08T00:00:00Z',
            summary: 'Prescription approved',
            visibility: 'PATIENT_SHARED',
            source: null,
          },
        ],
        nextCursor: null,
        stale: false,
        projectionVersion: 1,
      });
    }
    return json({ code: 'RESOURCE_NOT_FOUND' }, 404);
  });
  await page.goto('/r/' + token);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  return {
    revoke: () => {
      denied = true;
    },
    timelineRequests: () => timelineRequests,
  };
}
test('reminder selects a scoped patient independently of the staff tenant and clears revoked records', async ({
  page,
}) => {
  const state = await prepare(page);
  const panel = page.getByTestId('communication-link');
  await expect(panel).toContainText('Choose whose records');
  await expect(panel.getByRole('button', { name: /Other Patient/ })).toHaveCount(0);
  await panel.getByRole('button', { name: /Demo Patient/ }).click();
  await expect(page.getByTestId('patient-timeline')).toContainText('Prescription approved');
  expect(
    await page.evaluate(() =>
      JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }),
    ),
  ).not.toContain(token);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/reminder-phone.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  state.revoke();
  await panel.getByRole('button', { name: 'Check link again' }).click();
  await expect(panel.getByRole('alert')).toContainText('cannot be opened');
  await expect(page.getByTestId('patient-timeline')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Refresh patients' }).click();
  await expect(panel).not.toContainText('Demo Patient');
});
test('expired reminder does not request timeline records', async ({ page }) => {
  const state = await prepare(page, true, true);
  await page.getByRole('button', { name: /Demo Patient/ }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be opened');
  expect(state.timelineRequests()).toBe(0);
});
test('login returns to the opaque reminder before patient selection', async ({ page }) => {
  await prepare(page, false);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email', { exact: true }).fill('demo@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-login-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/r/' + token);
  await expect(page.getByRole('button', { name: /Demo Patient/ })).toBeVisible();
});
