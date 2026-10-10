import { test, expect, type Page } from '@playwright/test';
const tenant = '00000000-0000-4000-8000-00000000000a',
  patient = '00000000-0000-4000-8000-000000000101';
async function prepare(page: Page, permissions = ['patient.read', 'timeline.read']) {
  let denied = false;
  let allowReminders = true;
  let allowSms = true;
  let smsAccount: Record<string, unknown> | null = null;
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
    if (path.startsWith('/tenant/sms-credentials')) {
      if (denied) return json({ code: 'FORBIDDEN' }, 403);
      expect(route.request().headers()['x-tenant-id']).toBe(tenant);
      if (path === '/tenant/sms-credentials' && route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        expect(body.apiKey).toBe('synthetic-sms-setting-key-1234');
        smsAccount = {
          id: '00000000-0000-4000-8000-000000000123',
          tenantId: tenant,
          providerKind: 'SMS',
          providerCode: 'zamanit',
          status: 'PENDING_VALIDATION',
          secretLast4: '1234',
          publicIdentifier: body.senderId,
          senderIdStatus: 'UNVERIFIED',
          validatedAt: null,
          lastErrorClass: null,
          rowVersion: 1,
          balanceAlertBdt: body.balanceAlertBdt,
        };
        return json(smsAccount);
      }
      if (path.endsWith('/validate')) {
        expect(route.request().postDataJSON().rowVersion).toBe(1);
        smsAccount = { ...smsAccount, status: 'ACTIVE', rowVersion: 2 };
        return json({
          credential: smsAccount,
          balance: {
            balance: '500.00',
            currencyText: 'BDT',
            parseStatus: 'PARSED',
            errorClass: null,
            checkedAt: '2026-10-10T04:00:00Z',
          },
        });
      }
      if (route.request().method() === 'DELETE') {
        smsAccount = { ...smsAccount, status: 'REVOKED', rowVersion: 3 };
        return json(smsAccount);
      }
      return json(smsAccount ? [smsAccount] : []);
    }
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

    if (path === `/patients/${patient}/communications`) {
      if (denied) return json({ code: 'FORBIDDEN' }, 403);
      return json([
        {
          id: 'notification-1',
          channel: 'email',
          purpose: 'follow_up_reminder',
          status: 'DELIVERED',
          businessType: 'follow_up_plan',
          businessId: 'plan-1',
          createdAt: '2026-10-10T04:00:00Z',
          updatedAt: '2026-10-10T04:00:00Z',
          rowVersion: 1,
        },
      ]);
    }
    if (path === `/patients/${patient}/communication-preferences`) {
      if (denied) return json({ code: 'FORBIDDEN' }, 403);
      const preference = {
        id: 'preference-1',
        channel: 'email',
        preference: allowReminders ? 'OPT_IN' : 'OPT_OUT',
        contactId: null,
        consentVersion: 1,
        effectiveFrom: '2026-10-10T04:00:00Z',
        effectiveTo: null,
        rowVersion: 1,
      };
      if (route.request().method() === 'PUT') {
        expect(route.request().headers()['x-tenant-id']).toBe(tenant);
        const body = route.request().postDataJSON();
        expect(['email', 'sms']).toContain(body.channel);
        if (body.channel === 'sms') allowSms = body.preference === 'OPT_IN';
        else allowReminders = body.preference === 'OPT_IN';
        return json({ ...preference, channel: body.channel, preference: body.preference });
      }
      return json([
        preference,
        { ...preference, id: 'sms-preference', channel: 'sms', preference: allowSms ? 'OPT_IN' : 'OPT_OUT' },
      ]);
    }

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

test('notification statuses, preference updates and revoked-access clearing', async ({ page }) => {
  const state = await prepare(page, ['patient.read', 'communication.read', 'communication.send']);
  const panel = page.getByTestId('patient-communications');
  await expect(panel).toContainText('Delivered');
  const email = panel.getByRole('checkbox', { name: 'Email' });
  await expect(email).toBeChecked();
  await email.click();
  await expect(email).not.toBeChecked();
  await expect(email).toBeEnabled();
  await email.click();
  await expect(email).toBeChecked();
  const sms = panel.getByRole('checkbox', { name: 'SMS', exact: true });
  await expect(sms).toBeChecked();
  await sms.click();
  await expect(sms).not.toBeChecked();
  await expect(sms).toBeEnabled();
  await page.screenshot({ path: 'test-results/communication-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-results/communication-phone.png', fullPage: true });
  state.revoke();
  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect(panel.getByRole('alert')).toContainText('You do not have access');
  await expect(panel).not.toContainText('Delivered');
  await expect(panel.getByRole('checkbox')).toHaveCount(0);
});
test('notification preferences are read-only without send permission', async ({ page }) => {
  await prepare(page, ['patient.read', 'communication.read']);
  const panel = page.getByTestId('patient-communications');
  await expect(panel).toContainText('Delivered');
  await expect(panel.getByRole('checkbox', { name: 'Email' })).toBeDisabled();
});

test('SMS account settings clear the key, validate freely, revoke and hide records after access loss', async ({
  page,
}) => {
  const { revoke } = await prepare(page, ['sms.credentials.manage']);
  await page.goto('/settings/sms');
  const panel = page.getByTestId('sms-settings');
  const key = 'synthetic-sms-setting-key-1234';
  const input = panel.getByLabel('API key (write-only)');
  await input.fill(key);
  await panel.getByLabel('Sender ID', { exact: true }).fill('DEMO');
  await panel.getByRole('button', { name: 'Save account', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(panel.getByText('Needs validation', { exact: false })).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }),
    ),
  ).not.toContain(key);
  await panel.getByRole('button', { name: 'Validate / check balance (no SMS sent)', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('500.00');
  await panel.getByRole('button', { name: 'Revoke account', exact: true }).click();
  await expect(panel.getByRole('listitem').filter({ hasText: 'Revoked' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/sms-settings-phone.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  revoke();
  await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(input).toHaveCount(0);
  await expect(panel.getByRole('listitem').filter({ hasText: 'Revoked' })).toHaveCount(0);
});
test('SMS settings require the tenant account-management permission', async ({ page }) => {
  await prepare(page, ['patient.read']);
  await page.goto('/settings/sms');
  await expect(page).toHaveURL(/\/forbidden$/);
  await expect(page.getByLabel('API key (write-only)')).toHaveCount(0);
});
