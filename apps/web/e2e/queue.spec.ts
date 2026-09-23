import { type Page, type Route, expect, test } from '@playwright/test';

/**
 * Stage 5 CP5 queue board (WEB-IMPLEMENTATION §7, QUEUE §3.5) against a mocked API: the board polls and
 * reconciles, a call carries the row's `rowVersion`, a stale click shows the reload prompt instead of
 * retrying, and a drag reorder that loses the race shows the conflict rather than overwriting. Every value
 * below is synthetic.
 */
const API = 'http://localhost:3999/api/v1';
const TENANT = '00000000-0000-4000-8000-00000000000a';
const DAY = '00000000-0000-4000-8000-000000000401';
const S1 = '00000000-0000-4000-8000-000000000501';
const S2 = '00000000-0000-4000-8000-000000000502';
const ACCESS = 'mock-access-token-value';

const session = {
  accessToken: ACCESS,
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  csrfToken: 'mock-csrf',
  user: { id: 'u1', displayName: 'Demo Reception', email: 'r@example.invalid', phoneMasked: null },
};

const entry = (id: string, serialNumber: number, status: string, position: number, rowVersion = 1) => ({
  serialId: id,
  serialNumber,
  queuePosition: position,
  status,
  careMode: 'PHYSICAL',
  source: serialNumber === 1 ? 'WALK_IN' : 'ADVANCE_BOOKING',
  patientId: `00000000-0000-4000-8000-00000000060${serialNumber}`,
  patientDisplayName: serialNumber === 1 ? 'Demo Patient One' : 'Demo Patient Two',
  medicalRecordNumber: `P-000${serialNumber}-AAAA-BBBB-CCCC`,
  lateArrival: false,
  recallCount: 0,
  recallDeadlineAt: null,
  remoteReady: false,
  duplicateOverride: false,
  encounterId: null,
  rowVersion,
});

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

interface Seen {
  callVersions: number[];
  reorderBodies: Array<{ expectedQueueOrderVersion: number; orderedSerialIds: string[] }>;
  idempotencyKeys: string[];
}

async function mockApi(
  page: Page,
  opts: { permissions?: string[]; callStatus?: number; reorderStatus?: number } = {},
) {
  const seen: Seen = { callVersions: [], reorderBodies: [], idempotencyKeys: [] };
  const entries = [entry(S1, 1, 'WAITING', 1), entry(S2, 2, 'CHECKED_IN', 2)];
  let orderVersion = 3;

  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/v1', '');
    if (req.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
      });
    if (path === '/auth/session/csrf') return json(route, 200, { data: { csrfToken: 'mock-csrf' } });
    if (path === '/auth/session/refresh') return json(route, 200, { data: session });
    expect(req.headers()['authorization']).toBe(`Bearer ${ACCESS}`);
    if (path === '/me')
      return json(route, 200, {
        data: {
          user: session.user,
          memberships: [
            { membershipId: TENANT, tenantId: TENANT, tenantName: 'Demo Clinic', role: 'receptionist' },
          ],
          platformOperator: false,
        },
      });
    if (path === '/me/tenant-context')
      return json(route, 200, {
        data: {
          tenantId: TENANT,
          role: 'receptionist',
          permissions: opts.permissions ?? ['queue.read', 'queue.call', 'queue.manage', 'serial.manage'],
        },
      });
    if (path === `/chamber-days/${DAY}/queue` && req.method() === 'GET')
      return json(route, 200, {
        data: {
          chamberDayId: DAY,
          localDate: '2026-09-20',
          status: 'OPEN',
          queueOrderVersion: orderVersion,
          expectedDelayMinutes: 10,
          avgConsultationMinutes: 8,
          counts: {
            waiting: entries.filter((e) => e.status === 'WAITING').length,
            called: entries.filter((e) => e.status === 'CALLED').length,
            inConsultation: 0,
            completed: 0,
            totalSerials: entries.length,
          },
          entries,
          asOf: new Date().toISOString(),
          etag: `"v${orderVersion}-${entries.map((e) => e.status).join('')}"`,
        },
      });
    if (path === `/serials/${S1}/call` && req.method() === 'POST') {
      const body = req.postDataJSON() as { expectedRowVersion: number };
      seen.callVersions.push(body.expectedRowVersion);
      seen.idempotencyKeys.push(req.headers()['idempotency-key'] ?? '');
      if (opts.callStatus === 409)
        return json(route, 409, { code: 'STALE_VERSION', details: { currentRowVersion: 7 } });
      entries[0]!.status = 'CALLED';
      entries[0]!.rowVersion += 1;
      return json(route, 200, { data: { ...entries[0], id: S1 } });
    }
    if (path === `/chamber-days/${DAY}/reorder` && req.method() === 'POST') {
      seen.reorderBodies.push(
        req.postDataJSON() as { expectedQueueOrderVersion: number; orderedSerialIds: string[] },
      );
      if (opts.reorderStatus === 409)
        return json(route, 409, {
          code: 'QUEUE_VERSION_CONFLICT',
          details: { currentQueueOrderVersion: 9 },
        });
      orderVersion += 1;
      entries.reverse();
      return json(route, 200, { data: { chamberDayId: DAY, queueOrderVersion: orderVersion } });
    }
    return json(route, 404, { code: 'RESOURCE_NOT_FOUND' });
  });

  return seen;
}

/** Session restored from the (mocked) refresh cookie, then the tenant picked, as in patients.spec. */
async function signIn(page: Page) {
  await page.goto('/select-tenant');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: /Demo Clinic/ }).click();
  await expect(page.getByTestId('role')).toHaveText('receptionist');
}

test('the board lists the day, calls a waiting serial and reflects the answer', async ({ page }) => {
  const seen = await mockApi(page);
  await signIn(page);
  await page.goto(`/queue/${DAY}`);

  await expect(page.getByTestId('queue-row-1')).toHaveAttribute('data-status', 'WAITING');
  await expect(page.getByTestId('queue-row-2')).toHaveAttribute('data-status', 'CHECKED_IN');
  await expect(page.getByTestId('queue-counts')).toContainText('1');

  await page.getByTestId('queue-row-1').getByRole('button', { name: 'Call', exact: true }).click();
  await expect(page.getByTestId('queue-row-1')).toHaveAttribute('data-status', 'CALLED');

  // The command carried the version the row was rendered from, under a fresh Idempotency-Key.
  expect(seen.callVersions).toEqual([1]);
  expect(seen.idempotencyKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
});

test('a stale call shows the reload prompt and leaves the row alone', async ({ page }) => {
  await mockApi(page, { callStatus: 409 });
  await signIn(page);
  await page.goto(`/queue/${DAY}`);

  await page.getByTestId('queue-row-1').getByRole('button', { name: 'Call', exact: true }).click();
  await expect(page.getByTestId('queue-row-1').getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('queue-row-1')).toHaveAttribute('data-status', 'WAITING');
});

test('a reorder that loses the race shows the conflict instead of overwriting', async ({ page }) => {
  const seen = await mockApi(page, { reorderStatus: 409 });
  await signIn(page);
  await page.goto(`/queue/${DAY}`);

  await page.getByTestId('queue-row-2').dragTo(page.getByTestId('queue-row-1'));

  await expect(page.getByTestId('queue-conflict')).toBeVisible();
  expect(seen.reorderBodies).toHaveLength(1);
  expect(seen.reorderBodies[0]!.expectedQueueOrderVersion).toBe(3);
  expect(seen.reorderBodies[0]!.orderedSerialIds).toEqual([S2, S1]);
});
