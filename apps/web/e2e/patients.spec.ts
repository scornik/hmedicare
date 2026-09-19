import { type Page, type Route, expect, test } from '@playwright/test';

/**
 * Stage 5 CP3 patient registry flows (WEB-IMPLEMENTATION §7 "Patient search") against a mocked API:
 * search never shows raw phones, create with duplicate review (409 → acknowledged retry), merge case
 * approve with a STALE_VERSION reload prompt. Every value below is synthetic.
 */
const API = 'http://localhost:3999/api/v1';
const TENANT = '00000000-0000-4000-8000-00000000000a';
const P1 = '00000000-0000-4000-8000-000000000101';
const P2 = '00000000-0000-4000-8000-000000000102';
const CASE = '00000000-0000-4000-8000-000000000201';
const ACCESS = 'mock-access-token-value';
const RAW_PHONE = '01700000123';

const session = {
  accessToken: ACCESS,
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  csrfToken: 'mock-csrf',
  user: { id: 'u1', displayName: 'Demo Reception', email: 'r@example.invalid', phoneMasked: null },
};
const summary = (id: string, name: string, bn: string | null, year: number) => ({
  id,
  medicalRecordNumber: id === P1 ? 'P-0001-AAAA-BBBB-CCCC' : 'P-0002-AAAA-BBBB-CCCC',
  displayName: name,
  legalName: name,
  legalNameBn: bn,
  sex: 'FEMALE',
  birthYear: year,
  phoneMasked: '+8801*******23',
  status: 'ACTIVE',
});
const patient = (id: string, name: string, bn: string | null, year: number, status = 'ACTIVE') => ({
  ...summary(id, name, bn, year),
  dateOfBirth: null,
  genderIdentity: null,
  address: null,
  preferredLocale: 'bn-BD',
  mergedIntoPatientId: status === 'MERGED' ? P1 : null,
  contacts: [
    {
      id: '00000000-0000-4000-8000-000000000301',
      type: 'PHONE',
      displayValue: '+8801*******23',
      verificationStatus: 'UNVERIFIED',
      isPreferred: true,
      relationship: 'SELF',
      status: 'ACTIVE',
      rowVersion: 1,
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  rowVersion: 1,
  status,
});

interface Seen {
  createBodies: unknown[];
  approveVersions: number[];
  searchQueries: string[];
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

async function mockApi(page: Page, opts: { permissions?: string[] } = {}) {
  const seen: Seen = { createBodies: [], approveVersions: [], searchQueries: [] };
  let p2Status = 'ACTIVE';
  let caseVersion = 1;
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/v1', '');
    if (req.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
      });
    // The httpOnly refresh cookie is mocked as present: a reload restores the session (WEB §2).
    if (path === '/auth/session/csrf') return json(route, 200, { data: { csrfToken: 'mock-csrf' } });
    if (path === '/auth/session/refresh') {
      expect(req.headers()['x-csrf-token']).toBe('mock-csrf');
      return json(route, 200, { data: session });
    }
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
          permissions: opts.permissions ?? ['patient.read', 'patient.write', 'patient.merge'],
          rolePermissionsVersion: 2,
        },
      });
    expect(req.headers()['x-tenant-id']).toBe(TENANT);
    if (path === '/patients' && req.method() === 'GET') {
      seen.searchQueries.push(url.search);
      const mrn = url.searchParams.get('mrn');
      const all = [
        summary(P1, 'Rahima Khatun', 'রহিমা খাতুন', 1990),
        summary(P2, 'Rohima Khatun', null, 1990),
      ];
      const items = mrn ? all.filter((s) => s.medicalRecordNumber === mrn) : [all[0]];
      return json(route, 200, { data: { items, nextCursor: null, hasMore: false } });
    }
    if (path === '/patients/duplicate-check')
      return json(route, 200, {
        data: {
          candidates: [
            {
              patient: summary(P1, 'Rahima Khatun', 'রহিমা খাতুন', 1990),
              score: 0.55,
              reasons: ['PHONE_MATCH'],
            },
          ],
          // Warn-level on the pre-check; the server's own scoring then answers the create with 409.
          reviewRequired: false,
        },
      });
    if (path === '/patients' && req.method() === 'POST') {
      expect(req.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      const body = req.postDataJSON() as {
        duplicateReview?: { acknowledgedCandidateIds: string[]; reason: string };
      };
      seen.createBodies.push(body);
      if (!body.duplicateReview)
        return json(route, 409, { code: 'DUPLICATE_PATIENT_REVIEW_REQUIRED', details: { candidateIds: P1 } });
      return json(route, 201, { data: patient(P2, 'Rohima Khatun', null, 1990) });
    }
    if (path === `/patients/${P1}`)
      return json(route, 200, { data: patient(P1, 'Rahima Khatun', 'রহিমা খাতুন', 1990) });
    if (path === `/patients/${P2}`)
      return json(route, 200, { data: patient(P2, 'Rohima Khatun', null, 1990, p2Status) });
    if (path === `/patients/${P2}/merge-cases` && req.method() === 'POST')
      return json(route, 201, { data: mergeCase(caseVersion) });
    if (path === '/merge-cases' && req.method() === 'GET')
      return json(route, 200, {
        data: {
          items: p2Status === 'MERGED' ? [] : [mergeCase(caseVersion)],
          nextCursor: null,
          hasMore: false,
        },
      });
    if (path === `/merge-cases/${CASE}/approve`) {
      const body = req.postDataJSON() as { expectedRowVersion: number };
      seen.approveVersions.push(body.expectedRowVersion);
      if (body.expectedRowVersion !== caseVersion) return json(route, 409, { code: 'STALE_VERSION' });
      p2Status = 'MERGED';
      return json(route, 200, { data: { ...mergeCase(caseVersion + 1), status: 'APPROVED' } });
    }
    return json(route, 404, { code: 'NOT_FOUND' });
  });
  const bump = () => {
    caseVersion += 1;
  };
  return { seen, bump };
}

const mergeCase = (rowVersion: number) => ({
  id: CASE,
  sourcePatientId: P2,
  targetPatientId: P1,
  reason: 'same person, two registrations',
  duplicateScore: 0.85,
  status: 'OPEN',
  requestedByUserId: 'u1',
  reviewedByUserId: null,
  reviewedAt: null,
  createdAt: new Date().toISOString(),
  rowVersion,
});

/** Session restored from the (mocked) refresh cookie; password login itself is covered by smoke.spec. */
async function signIn(page: Page) {
  await page.goto('/select-tenant');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: /Demo Clinic/ }).click();
  await expect(page.getByTestId('role')).toHaveText('receptionist');
}

test('patient search: name query, masked phone only, opens the record', async ({ page }) => {
  const { seen } = await mockApi(page);
  await signIn(page);
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByLabel('Name, phone or MRN').fill('rahima');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByTestId('patient-results')).toContainText('Rahima Khatun');
  await expect(page.getByTestId('patient-results')).toContainText('+8801*******23');
  expect(await page.content()).not.toContain(RAW_PHONE);
  expect(seen.searchQueries[0]).toContain('query=rahima');
  await page.getByRole('link', { name: 'P-0001-AAAA-BBBB-CCCC' }).click();
  await expect(page.getByTestId('patient-mrn')).toHaveText('P-0001-AAAA-BBBB-CCCC');
  await expect(page.getByTestId('patient-status')).toHaveText('Active');
});

test('create with duplicate review: 409 shows candidates, acknowledged retry creates', async ({ page }) => {
  const { seen } = await mockApi(page);
  await signIn(page);
  await page.goto('/patients/new');
  await page.getByLabel('Legal name').fill('Rohima Khatun');
  await page.getByLabel('Phone').fill(RAW_PHONE);
  await page.getByLabel('Birth year').fill('1990');
  // Pre-check on blur: warn-level candidates, the form stays submittable.
  await expect(page.getByTestId('duplicate-candidates')).toContainText('Possible matches');
  await expect(page.getByTestId('duplicate-candidates')).toContainText('Rahima Khatun');
  await expect(page.getByTestId('duplicate-candidates')).toContainText('55%');
  await expect(page.getByRole('button', { name: 'Create patient' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create patient' }).click();
  // 409 DUPLICATE_PATIENT_REVIEW_REQUIRED: the review is now mandatory.
  await expect(page.getByTestId('duplicate-candidates')).toContainText('may already exist');
  await expect(page.getByRole('button', { name: 'Create patient' })).toBeDisabled();
  await page.getByLabel('I confirm these are different people').check();
  await page.getByLabel('Reason').fill('different DOB confirmed by NID');
  await page.getByRole('button', { name: 'Create patient' }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${P2}$`));
  expect(seen.createBodies).toHaveLength(2);
  expect(seen.createBodies[1]).toMatchObject({
    duplicateReview: { acknowledgedCandidateIds: [P1], reason: 'different DOB confirmed by NID' },
  });
});

test('merge case: open from the record, stale approve prompts a reload, then approves', async ({ page }) => {
  const { seen, bump } = await mockApi(page);
  await signIn(page);
  await page.goto(`/patients/${P2}`);
  await page.getByLabel('Target MRN').fill('P-0002-AAAA-BBBB-CCCC');
  await page.getByLabel('Target MRN').blur();
  await expect(page.getByRole('alert')).toContainText('No patient with this MRN');
  await page.getByLabel('Target MRN').fill('P-0001-AAAA-BBBB-CCCC');
  await page.getByLabel('Target MRN').blur();
  await expect(page.getByTestId('merge-target')).toContainText('Rahima Khatun');
  await page.getByLabel('Reason').fill('same person');
  await page.getByRole('button', { name: 'Open merge case' }).click();
  await page.getByRole('link', { name: 'Review merge cases' }).click();
  await expect(page.getByTestId('merge-cases')).toContainText('Rohima Khatun');
  bump(); // someone else changed the case: the page's rowVersion is now stale
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('alert')).toContainText('changed on the server');
  await page.getByRole('button', { name: 'Reload' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('No open merge cases')).toBeVisible();
  expect(seen.approveVersions).toEqual([1, 2]);
});

test('merge cases are hidden without patient.merge', async ({ page }) => {
  await mockApi(page, { permissions: ['patient.read', 'patient.write'] });
  await signIn(page);
  await page.goto('/patients/merge-cases');
  await expect(page).toHaveURL(/\/forbidden$/);
  await page.goto(`/patients/${P2}`);
  await expect(page.getByTestId('patient-mrn')).toBeVisible();
  await expect(page.getByTestId('merge-opener')).toHaveCount(0);
});
