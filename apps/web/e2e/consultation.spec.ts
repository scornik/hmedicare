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
const RX = '00000000-0000-4000-8000-000000000801';
const DOCUMENT = '00000000-0000-4000-8000-000000000901';
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
  /** Stage 7 CP10: the encounter's prescription revisions, newest first. */
  prescriptions: Array<Record<string, unknown> & { rowVersion: number }>;
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
    prescriptions: [],
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

    // Prescriptions (Stage 7 CP10). One draft in memory, enough to show that the editor prefills no
    // dose and that approving needs the attestation ticked.
    if (path === `/encounters/${ENCOUNTER}/prescriptions` && req.method() === 'GET')
      return json(route, 200, { data: { items: state.prescriptions } });
    if (path === `/encounters/${ENCOUNTER}/prescriptions` && req.method() === 'POST') {
      state.prescriptions = [
        {
          id: RX,
          patientId: PATIENT,
          encounterId: ENCOUNTER,
          doctorProfileId: '00000000-0000-4000-8000-000000000901',
          revision: 1,
          supersedesPrescriptionId: null,
          clinicalStatus: 'DRAFT',
          renderStatus: 'NOT_REQUESTED',
          reviewedByUserId: null,
          reviewedAt: null,
          approvedByDoctorProfileId: null,
          approvedAt: null,
          attestationVersion: null,
          approvedSnapshotSha256: null,
          voidedByUserId: null,
          voidedAt: null,
          voidReason: null,
          renderedDocumentId: null,
          createdAt: new Date().toISOString(),
          rowVersion: 1,
          items: [],
        },
      ];
      return json(route, 201, { data: state.prescriptions[0] });
    }
    // The render (RX-005) is a queued job, so the first request reports QUEUED with no document and the
    // panel must say so rather than offering a download that would 404.
    if (path === `/prescriptions/${RX}/render` && req.method() === 'POST') {
      const first = state.prescriptions[0];
      if (!first) return json(route, 404, { code: 'RESOURCE_NOT_FOUND' });
      const already = first.renderedDocumentId !== null;
      if (!already) first.renderedDocumentId = DOCUMENT;
      return json(route, 202, {
        data: {
          jobId: '00000000-0000-4000-8000-00000000000b',
          renderStatus: already ? 'AVAILABLE' : 'QUEUED',
          documentId: already ? DOCUMENT : null,
        },
      });
    }
    if (path === `/documents/${DOCUMENT}/download-token` && req.method() === 'POST') {
      return json(route, 201, {
        data: { token: '9999999999.' + 'a'.repeat(64), expiresAt: new Date().toISOString(), revision: 1 },
      });
    }
    if (path === '/medications/search' && req.method() === 'GET') {
      // Only "synth" matches, so the free-text fallback has a query that genuinely finds nothing.
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      if (!'demo-synthacillin'.includes(q)) return json(route, 200, { data: { items: [] } });
      return json(route, 200, {
        data: {
          items: [
            {
              medicationId: '00000000-0000-4000-8000-000000000a01',
              brandName: 'DEMO-Synthacillin',
              brandNameBn: null,
              genericDisplay: 'DEMO Generic A',
              strengthText: '500 mg',
              dosageForm: 'tablet',
              dosageFormUnmapped: false,
              route: 'oral',
              manufacturerDisplay: 'DEMO Labs',
              tier: 'BRAND_PREFIX',
              matchedOn: null,
              tenantUsageCount: 0,
              source: {
                datasetVersion: 'test-v1',
                reviewStatus: 'UNVERIFIED',
                dgdaMatch: 'NOT_CHECKED',
                isSynthetic: false,
              },
            },
          ],
        },
      });
    }
    if (path === `/prescriptions/${RX}` && req.method() === 'PATCH') {
      const body = JSON.parse(req.postData() ?? '{}') as { items: unknown[] };
      const existing = state.prescriptions[0];
      if (!existing) return json(route, 404, { code: 'RESOURCE_NOT_FOUND' });
      const updated = {
        ...existing,
        items: body.items.map((i, n) => ({ id: `item-${n}`, ...(i as object) })),
        rowVersion: existing.rowVersion + 1,
      };
      state.prescriptions[0] = updated;
      return json(route, 200, { data: updated });
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
  // `prescriptions` left the list in Stage 7 CP10: it is a real editor now, covered below.
  for (const panel of ['labs', 'timeline', 'ai']) {
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

test('the prescription editor prefills no dose and gates approve behind the attestation', async ({
  page,
}) => {
  await mockApi(page);
  await open(page);

  await page.getByTestId('rx-open').click();
  await expect(page.getByTestId('rx-empty')).toBeVisible();

  await page.getByTestId('rx-search').fill('synth');
  await page.getByTestId('rx-pick-00000000-0000-4000-8000-000000000a01').click();

  // The catalog filled the brand and the strength, and nothing clinical. A pad that guesses a dose is
  // a pad that gets one accepted without being read.
  await expect(page.getByTestId('rx-dose-0')).toHaveValue('');
  await expect(page.getByTestId('rx-frequency-0')).toHaveValue('');
  await expect(page.getByTestId('rx-duration-0')).toHaveValue('');
  await expect(page.getByTestId('rx-item-0')).toContainText('Unverified catalog');
  await expect(page.getByTestId('rx-required-hint')).toBeVisible();

  // Approve stays unavailable while anything required is missing.
  await expect(page.getByTestId('rx-approve')).toBeDisabled();

  await page.getByTestId('rx-dose-0').fill('1 tablet');
  await page.getByTestId('rx-frequency-0').fill('twice daily');
  await page.getByTestId('rx-duration-0').fill('5 days');
  await expect(page.getByTestId('rx-required-hint')).toBeHidden();

  // Still disabled: the attestation has not been read.
  await expect(page.getByTestId('rx-approve')).toBeDisabled();
  await page.getByTestId('rx-attest').check();
  await expect(page.getByTestId('rx-approve')).toBeEnabled();
});

test('a free-text medicine is visibly marked as free text', async ({ page }) => {
  await mockApi(page);
  await open(page);
  await page.getByTestId('rx-open').click();

  // A spelling the catalog does not know still has to be prescribable — that is the fallback the
  // whole UNVERIFIED catalog rests on.
  await page.getByTestId('rx-search').fill('nothing matches this');
  await page.getByTestId('rx-add-free-text').click();
  await expect(page.getByTestId('rx-free-text-0')).toContainText('Free text');
});

test('the PDF is offered only once a render has produced one', async ({ page }) => {
  const state = await mockApi(page);
  await open(page);
  await page.getByTestId('rx-open').click();

  // A draft has no PDF and is not offered one: rendering never makes a prescription final.
  await expect(page.getByTestId('rx-render')).toBeHidden();

  state.prescriptions[0]!.clinicalStatus = 'APPROVED';
  await page.reload();
  await expect(page.getByTestId('rx-render')).toBeVisible();
  // Nothing rendered yet, so the panel says so instead of showing a download that would 404.
  await expect(page.getByTestId('rx-pdf-pending')).toBeVisible();
  await expect(page.getByTestId('rx-pdf-download')).toBeHidden();

  await page.getByTestId('rx-render').click();
  // The job is queued, not finished: the wording follows what the server reported.
  await expect(page.getByTestId('rx-pdf-pending')).toContainText('being created');

  await page.reload();
  await expect(page.getByTestId('rx-pdf-download')).toBeVisible();
});
