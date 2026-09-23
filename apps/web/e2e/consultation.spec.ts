import { type Page, type Route, expect, test } from '@playwright/test';

/**
 * The consultation workspace (WEB-002, Stage 6 §6) against a mocked API. Five flows, all named in the
 * brief: a full consultation, an interruption, an amendment, a covering doctor, and two tabs racing.
 *
 * What these assert that a unit test cannot: that a doctor never loses text. The conflict case is the
 * important one — the screen has to stop and offer a choice rather than pick a winner, because both
 * versions were typed by a clinician.
 *
 * Every value below is synthetic.
 */
const API = 'http://localhost:3999/api/v1';
const TENANT = '00000000-0000-4000-8000-00000000000a';
const ENCOUNTER = '00000000-0000-4000-8000-000000000701';
const PATIENT = '00000000-0000-4000-8000-000000000601';
const NOTE = '00000000-0000-4000-8000-000000000801';
const ACCESS = 'mock-access-token-value';

const session = {
  accessToken: ACCESS,
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  csrfToken: 'mock-csrf',
  user: { id: 'u1', displayName: 'Demo Doctor', email: 'd@example.invalid', phoneMasked: null },
};

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

interface State {
  encounterStatus: string;
  covering: string | null;
  draft: {
    chiefComplaint: string | null;
    history: string | null;
    examination: string | null;
    assessment: string | null;
    plan: string | null;
    status: string;
    lastSignedRevision: number | null;
    rowVersion: number;
  };
  revisions: Array<{ revision: number; correctionReason: string | null }>;
  /** Saves the server refuses, to stage a race without needing a second browser. */
  rejectNextSave: boolean;
  seen: { saves: number[]; signs: unknown[] };
}

async function mockApi(page: Page, overrides: Partial<State> = {}): Promise<State> {
  const state: State = {
    encounterStatus: 'IN_PROGRESS',
    covering: null,
    draft: {
      chiefComplaint: null,
      history: null,
      examination: null,
      assessment: null,
      plan: null,
      status: 'DRAFT',
      lastSignedRevision: null,
      rowVersion: 1,
    },
    revisions: [],
    rejectNextSave: false,
    seen: { saves: [], signs: [] },
    ...overrides,
  };

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
    if (path === '/me')
      return json(route, 200, {
        data: {
          user: session.user,
          memberships: [
            { membershipId: TENANT, tenantId: TENANT, tenantName: 'Demo Clinic', role: 'doctor' },
          ],
          platformOperator: false,
        },
      });
    if (path === '/me/tenant-context')
      return json(route, 200, {
        data: {
          tenantId: TENANT,
          role: 'doctor',
          permissions: ['encounter.read', 'note.write', 'note.sign', 'diagnosis.write', 'patient.read'],
        },
      });

    if (path === `/encounters/${ENCOUNTER}` && req.method() === 'GET')
      return json(route, 200, {
        data: {
          id: ENCOUNTER,
          patientId: PATIENT,
          doctorProfileId: '00000000-0000-4000-8000-000000000901',
          chamberId: '00000000-0000-4000-8000-000000000301',
          serialId: '00000000-0000-4000-8000-000000000501',
          appointmentId: null,
          coveringDoctorProfileId: state.covering,
          careMode: 'PHYSICAL',
          status: state.encounterStatus,
          legacyInterim: false,
          startedAt: new Date().toISOString(),
          interruptedAt: null,
          resumedAt: null,
          completedAt: null,
          rowVersion: 1,
        },
      });

    if (path === `/patients/${PATIENT}` && req.method() === 'GET')
      return json(route, 200, {
        data: {
          id: PATIENT,
          legalName: 'Demo Patient One',
          legalNameBn: null,
          medicalRecordNumber: 'P-0001-AAAA-BBBB-CCCC',
          status: 'ACTIVE',
          contacts: [],
          rowVersion: 1,
        },
      });

    if (path === `/patients/${PATIENT}/encounters`)
      return json(route, 200, {
        data: [
          {
            id: '00000000-0000-4000-8000-000000000702',
            startedAt: new Date(Date.now() - 86_400_000).toISOString(),
            completedAt: new Date(Date.now() - 86_000_000).toISOString(),
            status: 'COMPLETED',
            doctorProfileId: '00000000-0000-4000-8000-000000000901',
            chamberId: '00000000-0000-4000-8000-000000000301',
            careMode: 'PHYSICAL',
            legacyInterim: false,
            signedRevisions: 1,
          },
        ],
      });

    if (path === `/encounters/${ENCOUNTER}/note` && req.method() === 'GET')
      return json(route, 200, { data: { id: NOTE, encounterId: ENCOUNTER, ...draftBody(state) } });

    if (path === `/encounters/${ENCOUNTER}/note` && req.method() === 'PUT') {
      const body = req.postDataJSON() as {
        expectedRowVersion: number;
        sections: Record<string, string | null>;
      };
      state.seen.saves.push(body.expectedRowVersion);
      if (state.rejectNextSave) {
        state.rejectNextSave = false;
        // Somebody else saved first. The server answers with where the draft actually is.
        state.draft.rowVersion += 1;
        state.draft.plan = 'SYNTHETIC: written in the other window';
        return json(route, 409, {
          code: 'STALE_VERSION',
          details: { currentRowVersion: state.draft.rowVersion },
        });
      }
      if (body.expectedRowVersion !== state.draft.rowVersion)
        return json(route, 409, {
          code: 'STALE_VERSION',
          details: { currentRowVersion: state.draft.rowVersion },
        });
      Object.assign(state.draft, body.sections);
      state.draft.rowVersion += 1;
      return json(route, 200, { data: { id: NOTE, encounterId: ENCOUNTER, ...draftBody(state) } });
    }

    if (path.endsWith('/note/sign') || path.endsWith('/note/corrections')) {
      const body = req.postDataJSON() as { expectedRowVersion: number; correctionReason?: string };
      state.seen.signs.push(body);
      const revision = (state.draft.lastSignedRevision ?? 0) + 1;
      state.draft.lastSignedRevision = revision;
      state.draft.rowVersion += 1;
      state.revisions.push({ revision, correctionReason: body.correctionReason ?? null });
      return json(route, 201, {
        data: {
          id: `rev-${revision}`,
          encounterId: ENCOUNTER,
          revision,
          signedByDoctorProfileId: '00000000-0000-4000-8000-000000000901',
          signedAt: new Date().toISOString(),
          ...sectionsOf(state),
          sectionSources: [],
          schemaVersion: 1,
          correctionReason: body.correctionReason ?? null,
          supersedesRevision: revision > 1 ? revision - 1 : null,
          contentSha256: 'a'.repeat(64),
        },
      });
    }

    if (path.endsWith('/note/revisions'))
      return json(route, 200, {
        data: state.revisions.map((r) => ({
          id: `rev-${r.revision}`,
          encounterId: ENCOUNTER,
          revision: r.revision,
          signedByDoctorProfileId: '00000000-0000-4000-8000-000000000901',
          signedAt: new Date().toISOString(),
          ...sectionsOf(state),
          sectionSources: [],
          schemaVersion: 1,
          correctionReason: r.correctionReason,
          supersedesRevision: r.revision > 1 ? r.revision - 1 : null,
          contentSha256: 'a'.repeat(64),
        })),
      });

    if (path.endsWith('/diagnoses') && req.method() === 'GET') return json(route, 200, { data: [] });
    if (path.endsWith('/symptoms') && req.method() === 'GET') return json(route, 200, { data: [] });

    if (path.endsWith('/complete')) {
      state.encounterStatus = 'COMPLETED';
      state.draft.status = 'SIGNED_LOCKED';
      return json(route, 200, { data: { id: ENCOUNTER, status: 'COMPLETED', rowVersion: 2 } });
    }

    return json(route, 404, { code: 'RESOURCE_NOT_FOUND' });
  });
  return state;
}

function sectionsOf(state: State) {
  const { chiefComplaint, history, examination, assessment, plan } = state.draft;
  return { chiefComplaint, history, examination, assessment, plan };
}

function draftBody(state: State) {
  return {
    authorDoctorProfileId: '00000000-0000-4000-8000-000000000901',
    status: state.draft.status,
    ...sectionsOf(state),
    sectionSources: [],
    schemaVersion: 1,
    lastSignedRevision: state.draft.lastSignedRevision,
    updatedAt: new Date().toISOString(),
    rowVersion: state.draft.rowVersion,
  };
}

/** Session restored from the (mocked) refresh cookie, then the tenant picked, as in the other specs. */
async function open(page: Page) {
  await page.goto('/select-tenant');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: /Demo Clinic/ }).click();
  await page.goto(`/consultations/${ENCOUNTER}`);
  await expect(page.getByTestId('workspace-patient')).toHaveText('Demo Patient One');
}

test('a full consultation: write, sign, complete', async ({ page }) => {
  const state = await mockApi(page);
  await open(page);

  await page.getByTestId('note-chiefComplaint').fill('SYNTHETIC: fever for three days');
  await page.getByTestId('note-plan').fill('SYNTHETIC: fluids and rest');
  // Blur flushes rather than waiting out the debounce, which is what moving between fields does.
  await page.getByTestId('note-plan').blur();
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');

  await page.getByTestId('sign-note').click();
  await expect(page.getByTestId('amend-note')).toBeVisible();
  expect(state.revisions).toHaveLength(1);
  expect(state.revisions[0]?.correctionReason).toBeNull();

  await page.getByTestId('complete-encounter').click();
  await expect(page.getByTestId('encounter-status')).toHaveText('Completed');
});

test('two tabs: the loser is offered a choice, not overwritten', async ({ page }) => {
  const state = await mockApi(page);
  await open(page);

  await page.getByTestId('note-plan').fill('SYNTHETIC: my plan');
  await page.getByTestId('note-plan').blur();
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');

  // The other window saves before this one does.
  state.rejectNextSave = true;
  await page.getByTestId('note-assessment').fill('SYNTHETIC: my assessment');
  await page.getByTestId('note-assessment').blur();

  const conflict = page.getByTestId('conflict');
  await expect(conflict).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'conflict');
  // Both versions are on screen. Neither has been discarded.
  await expect(page.getByTestId('conflict-mine-plan')).toContainText('my plan');
  await expect(page.getByTestId('conflict-theirs-plan')).toContainText('written in the other window');

  await page.getByTestId('conflict-keep-mine').click();
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');
  await expect(page.getByTestId('note-plan')).toHaveValue('SYNTHETIC: my plan');
});

test('taking the other version replaces the editor and clears the conflict', async ({ page }) => {
  const state = await mockApi(page);
  await open(page);
  state.rejectNextSave = true;
  await page.getByTestId('note-plan').fill('SYNTHETIC: mine');
  await page.getByTestId('note-plan').blur();
  await expect(page.getByTestId('conflict')).toBeVisible();

  await page.getByTestId('conflict-take-theirs').click();
  await expect(page.getByTestId('conflict')).toHaveCount(0);
  await expect(page.getByTestId('note-plan')).toHaveValue('SYNTHETIC: written in the other window');
});

test('amending a signed note requires a reason and keeps the history', async ({ page }) => {
  const state = await mockApi(page, {
    draft: {
      chiefComplaint: 'SYNTHETIC: cough',
      history: null,
      examination: null,
      assessment: null,
      plan: 'SYNTHETIC: rest',
      status: 'DRAFT',
      lastSignedRevision: 1,
      rowVersion: 3,
    },
    revisions: [{ revision: 1, correctionReason: null }],
  });
  await open(page);

  await page.getByTestId('amend-note').click();
  const confirm = page.getByTestId('amend-confirm');
  // A correction explains itself or it is not accepted.
  await expect(confirm).toBeDisabled();
  await page.getByTestId('amend-reason').fill('SYNTHETIC: film reviewed after signing');
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect.poll(() => state.revisions.length).toBe(2);
  expect(state.revisions[1]?.correctionReason).toBe('SYNTHETIC: film reviewed after signing');

  await page.getByTestId('toggle-revisions').click();
  await expect(page.getByTestId('revision-list').locator('li')).toHaveCount(2);
});

test('a covering doctor sees that they are covering', async ({ page }) => {
  await mockApi(page, { covering: '00000000-0000-4000-8000-000000000902' });
  await open(page);
  // Recorded on the encounter and shown, so it is obvious in the room under whose authority this is
  // being written.
  await expect(page.getByTestId('covering-badge')).toBeVisible();
});

test('an interrupted consultation is still editable and says so', async ({ page }) => {
  await mockApi(page, { encounterStatus: 'INTERRUPTED' });
  await open(page);
  await expect(page.getByTestId('encounter-status')).toHaveText('Interrupted');
  // The patient still holds the room, so the note stays open.
  await expect(page.getByTestId('note-plan')).toBeEnabled();
});

test('later-stage panels are labelled and empty, not mocked', async ({ page }) => {
  await mockApi(page);
  await open(page);
  for (const panel of ['prescriptions', 'labs', 'timeline', 'ai']) {
    await expect(page.getByTestId(`panel-${panel}`)).toContainText('Arrives in a later stage.');
  }
});

test('no clinical text is written to browser storage', async ({ page }) => {
  await mockApi(page);
  await open(page);
  await page.getByTestId('note-assessment').fill('SYNTHETIC: a private clinical assessment');
  await page.getByTestId('note-assessment').blur();
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');

  // A note left behind in a shared consulting room's browser is a disclosure nobody chose.
  const stored = await page.evaluate(() => {
    const dump = (s: Storage) => Object.keys(s).map((k) => `${k}=${s.getItem(k) ?? ''}`);
    return [...dump(localStorage), ...dump(sessionStorage)].join('\n');
  });
  expect(stored).not.toContain('private clinical assessment');
  expect(stored).not.toContain('SYNTHETIC');
});
