import { test, expect, type Page } from '@playwright/test';
const tenant = '00000000-0000-4000-8000-00000000000a',
  patient = '00000000-0000-4000-8000-000000000101';
async function prepare(page: Page, permissions = ['patient.read', 'timeline.read']) {
  let denied = false;
  const headers = {
    'access-control-allow-origin': 'http://localhost:4173',
    'access-control-allow-credentials': 'true',
    'content-type': 'application/json',
  };
  const user = { id: 'u1', displayName: 'Demo Doctor', email: 'demo@example.invalid', phoneMasked: null };
  await page.addInitScript((t) => localStorage.setItem('hm.tenant', t), tenant);
  await page.route('http://localhost:3999/api/v1/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace('/api/v1', '');
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
      return json({ tenantId: tenant, role: 'doctor', permissions, rolePermissionsVersion: 2 });
    if (path === `/patients/${patient}`)
      return json({
        id: patient,
        legalName: 'SYNTHETIC Patient',
        displayName: 'SYNTHETIC Patient',
        medicalRecordNumber: 'P-DEMO',
        legalNameBn: null,
        sex: null,
        dateOfBirth: null,
        birthYear: null,
        status: 'ACTIVE',
        contacts: [],
        preferredLocale: 'bn-BD',
        rowVersion: 1,
        mergedIntoPatientId: null,
      });
    if (path === `/patients/${patient}/timeline`) {
      expect(route.request().headers()['x-tenant-id']).toBe(tenant);
      if (denied) return json({ code: 'FORBIDDEN' }, 403);
      const next = url.searchParams.get('cursor');
      return json({
        items: [
          {
            id: next ? 'second' : 'first',
            eventType: next ? 'REDACTED' : 'prescription_finalized',
            occurredAt: '2026-10-08T00:00:00Z',
            summary: next ? 'Entry removed' : 'Prescription approved',
            visibility: 'PATIENT_SHARED',
            source: null,
          },
        ],
        nextCursor: next ? null : 'opaque-next',
        stale: true,
        projectionVersion: 1,
      });
    }
    return json({ code: 'RESOURCE_NOT_FOUND' }, 404);
  });
  await page.goto(`/patients/${patient}`);
  await page.getByRole('button', { name: 'English' }).click();
  return {
    revoke: () => {
      denied = true;
    },
  };
}
test('timeline pagination, update notice, and revoked-access clearing', async ({ page }) => {
  const state = await prepare(page);
  const panel = page.getByTestId('patient-timeline');
  await expect(panel).toContainText('Prescription approved');
  await expect(panel).toContainText('Recent entries may still be arriving');
  await panel.getByRole('button', { name: 'Load more' }).click();
  await expect(panel).toContainText('Entry removed');
  await expect(panel.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/timeline-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/timeline-phone.png', fullPage: true });
  state.revoke();
  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect(panel.getByRole('alert')).toContainText('You do not have access');
  await expect(panel).not.toContainText('Prescription approved');
  await expect(panel).not.toContainText('Entry removed');
});
test('patient detail omits timeline without its permission', async ({ page }) => {
  await prepare(page, ['patient.read']);
  await expect(page.getByTestId('patient-timeline')).toHaveCount(0);
});
