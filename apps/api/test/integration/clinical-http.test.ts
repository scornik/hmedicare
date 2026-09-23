import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerConfig, loadConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { newId } from '@hmedic/kernel';
import { Argon2idHasher, PolicyEngine } from '@hmedic/identity-access';
import { dhakaDate } from '@hmedic/localization';
import { type ApiInstance, buildApi } from '../../src/compose';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';

/**
 * Notes, diagnoses and symptoms over HTTP (CLIN-003, CLIN-004).
 *
 * The service suite proves the rules; this proves the wiring — that the permissions on each route are the
 * matrix's, that a stale autosave reaches the client as a conflict it can act on rather than a 500, and
 * that no clinical text escapes into a response nobody asked for it from.
 */
const PASSWORD = 'correct horse battery';
let api: ApiInstance;
let server: Parameters<typeof request>[0];
let seq = 0;
const idem = () => `clin-key-${Date.now()}-${++seq}`;
const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 });
let phoneSeq = 700;
const nextPhone = () => `+88017007${String(phoneSeq++).padStart(5, '0')}`;

const SECTIONS = {
  chiefComplaint: 'SYNTHETIC: cough for a week',
  history: 'SYNTHETIC: no prior episodes recorded',
  examination: 'SYNTHETIC: chest clear, no fever',
  assessment: 'SYNTHETIC: upper respiratory infection',
  plan: 'SYNTHETIC: rest and fluids, review in one week',
};

beforeAll(async () => {
  api = await buildApi(loadConfig<ServerConfig>('api', testEnv({ DATABASE_URL: testDatabaseUrl() })));
  server = api.app.getHttpServer();
});
afterAll(async () => {
  await api?.close();
});
beforeEach(async () => {
  await truncateAll();
});

async function staff(tenantId: string, role: string) {
  const now = new Date();
  const id = newId();
  const email = `s.${id.slice(-10)}@example.invalid`;
  await api.runtime.prisma.user.create({
    data: {
      id,
      email,
      emailNormalized: email,
      status: 'ACTIVE',
      passwordHash: await hasher.hash(PASSWORD),
      createdAt: now,
      updatedAt: now,
    },
  });
  await api.runtime.prisma.tenantMembership.create({
    data: {
      id: newId(),
      tenantId,
      userId: id,
      role,
      permissions: { grants: [], denials: [] },
      clinicIds: [],
      chamberIds: [],
      status: 'ACTIVE',
      rolePermissionsVersion: PolicyEngine.version,
      createdAt: now,
      updatedAt: now,
    },
  });
  const r = await request(server)
    .post('/api/v1/auth/password/login')
    .set('idempotency-key', idem())
    .send({ email, password: PASSWORD, client: 'web' })
    .expect(200);
  return {
    userId: id,
    headers: { authorization: `Bearer ${r.body.data.accessToken}`, 'x-tenant-id': tenantId },
  };
}

async function doctor(tenantId: string, label: string) {
  const s = await staff(tenantId, 'doctor');
  const now = new Date();
  const profileId = newId();
  await api.runtime.prisma.doctorProfile.create({
    data: {
      id: profileId,
      tenantId,
      userId: s.userId,
      displayName: `Dr. ${label}`,
      specialties: [],
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  return { ...s, profileId };
}

/** A consultation in progress, which is where every case below starts. */
async function consultation(label: string) {
  const now = new Date();
  const tenantId = newId();
  await api.runtime.prisma.tenant.create({
    data: {
      id: tenantId,
      name: `DEMO ${label}`,
      slug: `demo-${label}-${tenantId.slice(-6)}`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  const admin = await staff(tenantId, 'clinic_admin');
  const owner = await doctor(tenantId, `${label}-owner`);

  const clinic = await request(server)
    .post('/api/v1/clinics')
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({ name: `DEMO Clinic ${label}` })
    .expect(201);
  const chamber = await request(server)
    .post('/api/v1/chambers')
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({
      clinicId: clinic.body.data.id,
      doctorProfileId: owner.profileId,
      name: `DEMO Chamber ${label}`,
      supportsPhysical: true,
    })
    .expect(201);
  for (let weekday = 1; weekday <= 7; weekday++) {
    await request(server)
      .post(`/api/v1/chambers/${chamber.body.data.id}/schedule-rules`)
      .set(admin.headers)
      .set('idempotency-key', idem())
      .send({
        ruleType: 'WEEKLY',
        weekday,
        localStartTime: '00:00',
        localEndTime: '23:59',
        effectiveFrom: '2020-01-01',
      })
      .expect(201);
  }
  const created = await request(server)
    .post('/api/v1/chamber-days')
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({ chamberId: chamber.body.data.id, localDate: dhakaDate(new Date()) })
    .expect(201);
  const opened = await request(server)
    .post(`/api/v1/chamber-days/${created.body.data.id}/open`)
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({ expectedRowVersion: created.body.data.rowVersion })
    .expect(200);
  const patient = await request(server)
    .post('/api/v1/patients')
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({
      legalName: 'SYNTHETIC Clinical Patient',
      contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'SELF', isPreferred: true }],
      consents: ['care'],
    })
    .expect(201);
  const walkIn = await request(server)
    .post(`/api/v1/chamber-days/${opened.body.data.id}/walk-ins`)
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({ patientId: patient.body.data.id, careMode: 'PHYSICAL' })
    .expect(201);
  const called = await request(server)
    .post(`/api/v1/serials/${walkIn.body.data.id}/call`)
    .set(admin.headers)
    .set('idempotency-key', idem())
    .send({ expectedRowVersion: walkIn.body.data.rowVersion })
    .expect(200);
  const encounter = await request(server)
    .post(`/api/v1/serials/${called.body.data.id}/encounter`)
    .set(owner.headers)
    .set('idempotency-key', idem())
    .send({ expectedRowVersion: called.body.data.rowVersion })
    .expect(201);

  const draft = await request(server)
    .get(`/api/v1/encounters/${encounter.body.data.id}/note`)
    .set(owner.headers)
    .expect(200);

  return {
    tenantId,
    admin,
    owner,
    patientId: patient.body.data.id,
    encounter: encounter.body.data,
    draft: draft.body.data,
  };
}

describe('the note over HTTP', () => {
  it('saves, signs and amends, and lists the revisions in order', async () => {
    const c = await consultation('note');

    const saved = await request(server)
      .put(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .send({ expectedRowVersion: c.draft.rowVersion, sections: SECTIONS })
      .expect(200);
    expect(saved.body.data).toMatchObject({
      chiefComplaint: SECTIONS.chiefComplaint,
      plan: SECTIONS.plan,
      rowVersion: c.draft.rowVersion + 1,
      lastSignedRevision: null,
    });

    const signed = await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/note/sign`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: saved.body.data.rowVersion })
      .expect(201);
    expect(signed.body.data).toMatchObject({ revision: 1, correctionReason: null });
    expect(signed.body.data.contentSha256).toMatch(/^[0-9a-f]{64}$/);

    const reloaded = await request(server)
      .get(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .expect(200);
    const amended = await request(server)
      .put(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .send({
        expectedRowVersion: reloaded.body.data.rowVersion,
        sections: { ...SECTIONS, assessment: 'SYNTHETIC: revised after the chest film' },
      })
      .expect(200);
    const correction = await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/note/corrections`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({
        expectedRowVersion: amended.body.data.rowVersion,
        correctionReason: 'SYNTHETIC: chest film reviewed after signing',
      })
      .expect(201);
    expect(correction.body.data).toMatchObject({ revision: 2, supersedesRevision: 1 });

    const revisions = await request(server)
      .get(`/api/v1/encounters/${c.encounter.id}/note/revisions`)
      .set(c.owner.headers)
      .expect(200);
    expect(revisions.body.data.map((r: { revision: number }) => r.revision)).toEqual([1, 2]);
    // The superseded revision is still readable in full, which is the whole point of an amendment.
    expect(revisions.body.data[0].assessment).toBe(SECTIONS.assessment);
    expect(revisions.body.data[1].assessment).toBe('SYNTHETIC: revised after the chest film');
  });

  it('answers a stale autosave with a conflict the client can act on', async () => {
    const c = await consultation('conflict');
    await request(server)
      .put(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .send({ expectedRowVersion: c.draft.rowVersion, sections: SECTIONS })
      .expect(200);

    // The second tab, still holding the version it loaded.
    const stale = await request(server)
      .put(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .send({
        expectedRowVersion: c.draft.rowVersion,
        sections: { ...SECTIONS, plan: 'SYNTHETIC: written in the other tab' },
      });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
    // Enough to reload and show both versions rather than guess.
    expect(stale.body.details).toMatchObject({ currentRowVersion: expect.any(Number) });

    const current = await request(server)
      .get(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .expect(200);
    expect(current.body.data.plan).toBe(SECTIONS.plan);
  });

  it('refuses an amendment with no reason, and a first signature that offers one', async () => {
    const c = await consultation('reasons');
    const saved = await request(server)
      .put(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .send({ expectedRowVersion: c.draft.rowVersion, sections: SECTIONS })
      .expect(200);
    await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/note/sign`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: saved.body.data.rowVersion })
      .expect(201);

    const reloaded = await request(server)
      .get(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .expect(200);
    // The DTO refuses an empty reason before the service is reached.
    const noReason = await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/note/corrections`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: reloaded.body.data.rowVersion, correctionReason: '' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe('VALIDATION_FAILED');

    // And signing again without going through the corrections route is refused too: a second revision
    // is a correction whichever door it arrives at.
    const secondSign = await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/note/sign`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: reloaded.body.data.rowVersion });
    expect(secondSign.status).toBe(400);
  });

  it('enforces the section limit and keeps Bangla text intact', async () => {
    const c = await consultation('bangla');
    const tooLong = await request(server)
      .put(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .send({ expectedRowVersion: c.draft.rowVersion, sections: { plan: 'স'.repeat(20_001) } });
    expect(tooLong.status).toBe(400);

    const bangla = { chiefComplaint: 'সিনথেটিক: এক সপ্তাহ ধরে কাশি', plan: 'সিনথেটিক: বিশ্রাম নিন' };
    const saved = await request(server)
      .put(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .send({ expectedRowVersion: c.draft.rowVersion, sections: bangla })
      .expect(200);
    expect(saved.body.data.chiefComplaint).toBe(bangla.chiefComplaint);

    const signed = await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/note/sign`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: saved.body.data.rowVersion })
      .expect(201);
    expect(signed.body.data.plan).toBe(bangla.plan);
  });
});

describe('diagnoses and symptoms over HTTP', () => {
  it('adds, edits before signing, then voids and replaces', async () => {
    const c = await consultation('dx');
    const added = await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/diagnoses`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({ display: 'SYNTHETIC: upper respiratory infection', certainty: 'PROVISIONAL' })
      .expect(201);
    expect(added.body.data).toMatchObject({ source: 'doctor', clinicalStatus: 'ACTIVE' });

    const edited = await request(server)
      .patch(`/api/v1/diagnoses/${added.body.data.id}`)
      .set(c.owner.headers)
      .send({ expectedRowVersion: added.body.data.rowVersion, certainty: 'CONFIRMED' })
      .expect(200);
    expect(edited.body.data.certainty).toBe('CONFIRMED');

    const saved = await request(server)
      .put(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .send({ expectedRowVersion: c.draft.rowVersion, sections: SECTIONS })
      .expect(200);
    await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/note/sign`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: saved.body.data.rowVersion })
      .expect(201);

    // Signed: no more editing in place.
    const blocked = await request(server)
      .patch(`/api/v1/diagnoses/${added.body.data.id}`)
      .set(c.owner.headers)
      .send({ expectedRowVersion: edited.body.data.rowVersion, display: 'SYNTHETIC: changed quietly' });
    expect(blocked.status).toBeGreaterThanOrEqual(400);
    expect(blocked.body.code).toBe('INVALID_TRANSITION');

    const voided = await request(server)
      .post(`/api/v1/diagnoses/${added.body.data.id}/void`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({
        expectedRowVersion: edited.body.data.rowVersion,
        reason: 'SYNTHETIC: recorded against the wrong encounter',
      })
      .expect(200);
    expect(voided.body.data).toMatchObject({ clinicalStatus: 'ENTERED_IN_ERROR' });

    const replacement = await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/diagnoses`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({
        display: 'SYNTHETIC: corrected diagnosis',
        certainty: 'CONFIRMED',
        replacesDiagnosisId: added.body.data.id,
      })
      .expect(201);
    expect(replacement.body.data.replacesDiagnosisId).toBe(added.body.data.id);

    const list = await request(server)
      .get(`/api/v1/encounters/${c.encounter.id}/diagnoses`)
      .set(c.owner.headers)
      .expect(200);
    // The voided one is still listed: "this was wrong" is part of the record.
    expect(list.body.data).toHaveLength(2);
  });

  it('records symptoms and refuses a code without its system', async () => {
    const c = await consultation('sx');
    const added = await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/symptoms`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({
        display: 'SYNTHETIC: cough',
        source: 'PATIENT_REPORTED',
        certainty: 'CONFIRMED',
        severity: 'MODERATE',
      })
      .expect(201);
    expect(added.body.data).toMatchObject({ source: 'PATIENT_REPORTED', status: 'ACTIVE' });

    const halfCoded = await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/symptoms`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({
        display: 'SYNTHETIC: coded without a system',
        source: 'CLINICIAN_OBSERVED',
        certainty: 'CONFIRMED',
        normalizedCode: 'R05',
      });
    expect(halfCoded.status).toBe(400);

    const list = await request(server)
      .get(`/api/v1/encounters/${c.encounter.id}/symptoms`)
      .set(c.owner.headers)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
  });
});

describe('who gets in (test 9 over HTTP)', () => {
  it('refuses an unrelated doctor, who holds every clinical permission', async () => {
    const c = await consultation('stranger');
    // Same tenant, same role, every clinical permission the matrix gives a doctor — and no relationship
    // to this patient. The permission is not the authorization.
    const other = await doctor(c.tenantId, 'Stranger');
    const routes: Array<[string, () => request.Test]> = [
      ['get note', () => request(server).get(`/api/v1/encounters/${c.encounter.id}/note`).set(other.headers)],
      [
        'revisions',
        () => request(server).get(`/api/v1/encounters/${c.encounter.id}/note/revisions`).set(other.headers),
      ],
      [
        'save note',
        () =>
          request(server)
            .put(`/api/v1/encounters/${c.encounter.id}/note`)
            .set(other.headers)
            .send({ expectedRowVersion: c.draft.rowVersion, sections: SECTIONS }) as request.Test,
      ],
      [
        'sign',
        () =>
          request(server)
            .post(`/api/v1/encounters/${c.encounter.id}/note/sign`)
            .set(other.headers)
            .set('idempotency-key', idem())
            .send({ expectedRowVersion: c.draft.rowVersion }) as request.Test,
      ],
      [
        'diagnoses',
        () => request(server).get(`/api/v1/encounters/${c.encounter.id}/diagnoses`).set(other.headers),
      ],
      [
        'add diagnosis',
        () =>
          request(server)
            .post(`/api/v1/encounters/${c.encounter.id}/diagnoses`)
            .set(other.headers)
            .set('idempotency-key', idem())
            .send({ display: 'SYNTHETIC: x', certainty: 'CONFIRMED' }) as request.Test,
      ],
      [
        'symptoms',
        () => request(server).get(`/api/v1/encounters/${c.encounter.id}/symptoms`).set(other.headers),
      ],
    ];
    for (const [name, run] of routes) {
      const res = await run();
      expect(res.status, name).toBe(403);
      // And nothing of the record leaks through the refusal.
      expect(JSON.stringify(res.body), name).not.toContain('SYNTHETIC: cough');
    }
  });

  it('gives a nurse the draft and refuses the signature and the diagnosis', async () => {
    const c = await consultation('nurse');
    const nurse = await staff(c.tenantId, 'nurse');

    const saved = await request(server)
      .put(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(nurse.headers)
      .send({
        expectedRowVersion: c.draft.rowVersion,
        sections: { examination: 'SYNTHETIC: observations taken at the desk' },
      })
      .expect(200);
    expect(saved.body.data.sectionSources).toEqual([{ section: 'examination', source: 'nurse' }]);

    // `note.sign` is not a nurse permission at all, so this stops at the guard.
    await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/note/sign`)
      .set(nurse.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: saved.body.data.rowVersion })
      .expect(403);

    // A nurse holds `diagnosis.write`, so this one gets past the permission guard and is stopped by
    // assignment instead: a diagnosis is an attributed clinical judgement.
    await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/diagnoses`)
      .set(nurse.headers)
      .set('idempotency-key', idem())
      .send({ display: 'SYNTHETIC: x', certainty: 'CONFIRMED' })
      .expect(403);
  });

  it('gives a receptionist nothing clinical at all', async () => {
    const c = await consultation('reception');
    const reception = await staff(c.tenantId, 'receptionist');
    for (const path of ['note', 'note/revisions', 'diagnoses', 'symptoms']) {
      const res = await request(server)
        .get(`/api/v1/encounters/${c.encounter.id}/${path}`)
        .set(reception.headers);
      expect(res.status, path).toBe(403);
    }
  });

  it('answers not-found across a tenant boundary (test 11)', async () => {
    const mine = await consultation('mine');
    const theirs = await consultation('theirs');
    // A real doctor, a real encounter, different tenants. "No such record" rather than "forbidden": the
    // caller learns nothing about what exists elsewhere.
    for (const path of ['note', 'note/revisions', 'diagnoses', 'symptoms']) {
      const res = await request(server)
        .get(`/api/v1/encounters/${theirs.encounter.id}/${path}`)
        .set(mine.owner.headers);
      expect(res.status, path).toBe(404);
    }
  });
});

describe("the patient's history", () => {
  it('lists earlier consultations and says which carry a signed note', async () => {
    const c = await consultation('history');
    const saved = await request(server)
      .put(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .send({ expectedRowVersion: c.draft.rowVersion, sections: SECTIONS })
      .expect(200);
    await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/note/sign`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: saved.body.data.rowVersion })
      .expect(201);

    const list = await request(server)
      .get(`/api/v1/patients/${c.patientId}/encounters`)
      .set(c.owner.headers)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: c.encounter.id, signedRevisions: 1 });
    // The summary is for choosing which consultation to open. Opening one is a separate, audited read,
    // so no clinical text travels here.
    expect(JSON.stringify(list.body)).not.toContain(SECTIONS.assessment);

    // The workspace asks for everything except the consultation already on screen.
    const excluded = await request(server)
      .get(`/api/v1/patients/${c.patientId}/encounters?excludeEncounterId=${c.encounter.id}`)
      .set(c.owner.headers)
      .expect(200);
    expect(excluded.body.data).toHaveLength(0);
  });

  it('refuses a doctor with no relationship to the patient, and 404s across tenants', async () => {
    const c = await consultation('history-authz');
    const other = await doctor(c.tenantId, 'History Stranger');
    await request(server).get(`/api/v1/patients/${c.patientId}/encounters`).set(other.headers).expect(403);

    const theirs = await consultation('history-other-tenant');
    await request(server)
      .get(`/api/v1/patients/${theirs.patientId}/encounters`)
      .set(c.owner.headers)
      .expect(404);
  });
});

describe('the clinical record is audited, not logged (test 10)', () => {
  it('records every read and holds none of the text', async () => {
    const c = await consultation('audit');
    const saved = await request(server)
      .put(`/api/v1/encounters/${c.encounter.id}/note`)
      .set(c.owner.headers)
      .send({ expectedRowVersion: c.draft.rowVersion, sections: SECTIONS })
      .expect(200);
    await request(server)
      .post(`/api/v1/encounters/${c.encounter.id}/note/sign`)
      .set(c.owner.headers)
      .set('idempotency-key', idem())
      .send({ expectedRowVersion: saved.body.data.rowVersion })
      .expect(201);
    await request(server).get(`/api/v1/encounters/${c.encounter.id}/note`).set(c.owner.headers).expect(200);

    const rows = await api.runtime.prisma.auditLog.findMany({ where: { tenantId: c.tenantId } });
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('ENCOUNTER_NOTE_SIGNED');
    expect(actions).toContain('ENCOUNTER_NOTE_VIEWED');

    const serialized = JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    for (const text of Object.values(SECTIONS)) expect(serialized).not.toContain(text);
  });
});
