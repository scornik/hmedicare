#!/usr/bin/env node
// Walks a full synthetic chamber day against a deployed installation, end to end:
//
//   login → clinic → chamber → schedule → chamber day → patient → walk-in → call
//         → encounter → note → sign → diagnosis → complete
//
// This is the Stage 6 CP8 acceptance condition ("a doctor can run a full synthetic chamber day on the
// deployed site") executed as a script, so the result is a transcript rather than a claim.
//
//   HM_BASE_URL=https://example.invalid \
//   HM_EMAIL=owner@example.invalid \
//   HM_PASSWORD=... \
//   node scripts/ops/verify-clinical-loop.mjs
//
// The password is read from the environment, never from a flag: a flag lands in shell history and in
// `ps` output for every other process on the host. Nothing it reads is printed — the transcript contains
// ids, statuses and timings only.
//
// Everything it creates is obviously synthetic and clearly labelled. Run it only against an installation
// with `REAL_PATIENT_DATA_ALLOWED=false`; it checks that first and refuses otherwise, because a
// verification run should never be the thing that puts test rows next to real patients.
import { randomUUID } from 'node:crypto';

const base = (process.env.HM_BASE_URL ?? '').replace(/\/$/, '');
const email = process.env.HM_EMAIL;
const password = process.env.HM_PASSWORD;

if (!base || !email || !password) {
  process.stderr.write(
    'usage: HM_BASE_URL=… HM_EMAIL=… HM_PASSWORD=… node scripts/ops/verify-clinical-loop.mjs\n' +
      'The password is read from the environment so it stays out of shell history and `ps`.\n',
  );
  process.exit(2);
}

const steps = [];
let token = null;
let tenantId = null;

/** One API call. Throws with the server's code, never with anything it was sent. */
async function call(method, path, body, extra = {}) {
  const headers = { 'content-type': 'application/json', ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (method !== 'GET') headers['idempotency-key'] = randomUUID();

  const started = Date.now();
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON body is reported by status alone */
  }
  steps.push({ step: `${method} ${path}`, status: res.status, ms: Date.now() - started });
  if (!res.ok) {
    const code = parsed?.code ?? `HTTP_${res.status}`;
    throw new Error(`${method} ${path} → ${res.status} ${code}`);
  }
  return parsed?.data ?? null;
}

/** Today in Asia/Dhaka, which is the timezone a chamber day is materialized in. */
function dhakaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
}

async function main() {
  const ready = await call('GET', '/health/ready');
  if (ready?.realPatientDataAllowed !== false) {
    throw new Error(
      'refusing: REAL_PATIENT_DATA_ALLOWED is not false on this installation. This script writes ' +
        'synthetic rows and must never run where real patients are held.',
    );
  }

  const session = await call('POST', '/api/v1/auth/password/login', { email, password, client: 'web' });
  token = session.accessToken;

  const me = await call('GET', '/api/v1/me');
  const membership = me.memberships?.[0];
  if (!membership) throw new Error('the signed-in user has no active tenant membership');
  tenantId = membership.tenantId;

  const stamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
  const label = `SYNTHETIC CP8 ${stamp}`;

  const clinic = await call('POST', '/api/v1/clinics', { name: `${label} Clinic` });

  // The doctor profile to run the chamber under. Memberships carry it since C-56 was settled; the
  // environment override stays for an installation that has not deployed that yet.
  const staff = await call('GET', '/api/v1/memberships');
  const members = Array.isArray(staff) ? staff : (staff?.items ?? []);
  const doctorProfileId =
    process.env.HM_DOCTOR_PROFILE_ID ?? members.find((m) => m.doctorProfileId)?.doctorProfileId;
  if (!doctorProfileId) {
    throw new Error('no active doctor profile on this tenant; a chamber needs one to run under');
  }

  const chamber = await call('POST', '/api/v1/chambers', {
    clinicId: clinic.id,
    doctorProfileId,
    name: `${label} Chamber`,
    supportsPhysical: true,
  });

  // Every weekday, so the run works whichever day it is executed on.
  for (let weekday = 1; weekday <= 7; weekday++) {
    await call('POST', `/api/v1/chambers/${chamber.id}/schedule-rules`, {
      ruleType: 'WEEKLY',
      weekday,
      localStartTime: '00:00',
      localEndTime: '23:59',
      effectiveFrom: '2020-01-01',
    });
  }

  const day = await call('POST', '/api/v1/chamber-days', {
    chamberId: chamber.id,
    localDate: dhakaToday(),
  });
  const openDay = await call('POST', `/api/v1/chamber-days/${day.id}/open`, {
    expectedRowVersion: day.rowVersion,
  });

  const patient = await call('POST', '/api/v1/patients', {
    legalName: `${label} Patient`,
    contacts: [
      {
        type: 'PHONE',
        value: `+8801700${String(Date.now()).slice(-6)}`,
        relationship: 'SELF',
        isPreferred: true,
      },
    ],
    consents: ['care'],
  });

  const serial = await call('POST', `/api/v1/chamber-days/${openDay.id}/walk-ins`, {
    patientId: patient.id,
    careMode: 'PHYSICAL',
  });
  const called = await call('POST', `/api/v1/serials/${serial.id}/call`, {
    expectedRowVersion: serial.rowVersion,
  });

  const encounter = await call('POST', `/api/v1/serials/${called.id}/encounter`, {
    expectedRowVersion: called.rowVersion,
  });

  const draft = await call('GET', `/api/v1/encounters/${encounter.id}/note`);
  const saved = await call('PUT', `/api/v1/encounters/${encounter.id}/note`, {
    expectedRowVersion: draft.rowVersion,
    sections: {
      chiefComplaint: 'SYNTHETIC: deployment verification, not a real consultation',
      examination: 'SYNTHETIC: no examination was performed',
      assessment: 'SYNTHETIC: this record exists to prove the deployed clinical loop works',
      plan: 'SYNTHETIC: none',
    },
  });

  // A stale save must be refused rather than applied: the property the whole draft mechanism rests on.
  let staleRefused = false;
  try {
    await call('PUT', `/api/v1/encounters/${encounter.id}/note`, {
      expectedRowVersion: draft.rowVersion,
      sections: { plan: 'SYNTHETIC: a stale save that must not land' },
    });
  } catch (e) {
    staleRefused = String(e).includes('STALE_VERSION');
  }
  if (!staleRefused) throw new Error('a stale autosave was accepted; the draft guard is not working');

  const signed = await call('POST', `/api/v1/encounters/${encounter.id}/note/sign`, {
    expectedRowVersion: saved.rowVersion,
  });

  const diagnosis = await call('POST', `/api/v1/encounters/${encounter.id}/diagnoses`, {
    display: 'SYNTHETIC: verification diagnosis, not a clinical finding',
    certainty: 'PROVISIONAL',
  });

  const reloaded = await call('GET', `/api/v1/encounters/${encounter.id}/note`);
  const amended = await call('POST', `/api/v1/encounters/${encounter.id}/note/corrections`, {
    expectedRowVersion: reloaded.rowVersion,
    correctionReason: 'SYNTHETIC: amendment path exercised by the verification run',
  });

  const current = await call('GET', `/api/v1/encounters/${encounter.id}`);
  const completed = await call('POST', `/api/v1/encounters/${encounter.id}/complete`, {
    expectedRowVersion: current.rowVersion,
  });

  const finalSerial = await call('GET', `/api/v1/serials/${serial.id}`);
  const revisions = await call('GET', `/api/v1/encounters/${encounter.id}/note/revisions`);
  const history = await call('GET', `/api/v1/patients/${patient.id}/encounters`);

  const problems = [];
  if (completed.status !== 'COMPLETED') problems.push(`encounter ended as ${completed.status}`);
  if (finalSerial.status !== 'COMPLETED') problems.push(`serial ended as ${finalSerial.status}`);
  if (finalSerial.encounterId !== encounter.id) problems.push('the serial does not point at its encounter');
  if (signed.revision !== 1) problems.push(`first signature was revision ${signed.revision}`);
  if (amended.revision !== 2 || !amended.correctionReason)
    problems.push('the amendment did not produce a reasoned revision 2');
  if (revisions.length !== 2) problems.push(`${revisions.length} revisions, expected 2`);
  if (revisions[0]?.assessment !== 'SYNTHETIC: this record exists to prove the deployed clinical loop works')
    problems.push('the superseded revision is no longer readable in full');
  if (!history.some((e) => e.id === encounter.id)) problems.push('the encounter is missing from the history');
  if (diagnosis.source !== 'doctor') problems.push(`diagnosis source was ${diagnosis.source}`);

  const report = {
    base,
    tenantId,
    encounterId: encounter.id,
    serialId: serial.id,
    patientId: patient.id,
    signedRevisions: revisions.length,
    staleSaveRefused: staleRefused,
    steps: steps.length,
    slowestMs: Math.max(...steps.map((s) => s.ms)),
    problems,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (problems.length) {
    process.stderr.write(`verify-clinical-loop: FAILED (${problems.length} problem(s))\n`);
    return 1;
  }
  process.stdout.write('verify-clinical-loop: the deployed clinical loop works end to end\n');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    // Never the request bodies: they carry the password on the first call.
    process.stderr.write(`verify-clinical-loop: ${String(e.message ?? e).slice(0, 500)}\n`);
    process.stderr.write(`steps completed: ${steps.length}\n`);
    process.exit(1);
  });
