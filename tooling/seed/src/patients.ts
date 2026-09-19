import { type Clock, type TenantContext, newId } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { OutboxPort } from '@hmedic/jobs';
import {
  ConsentService,
  MergeRepointerRegistry,
  MergeService,
  PatientAccessService,
  PatientEvents,
  PatientService,
  type PatientActor,
} from '@hmedic/patient';

/**
 * Stage 5 patient dataset (SEED-DATA §2.2): ~60 synthetic patients with Latin and Bangla (NFC) names,
 * deliberate duplicate pairs, one OPEN merge case, patient accounts in every status, a guardian with two
 * dependents, care-team rows and consents. Every phone is in the reserved range; every name is invented.
 * Idempotent: skipped when tenant A already has patients.
 */
export interface PatientSeedDeps {
  prisma: PrismaClient;
  audit: PrismaAuditPort;
  clock: Clock;
  tenantA: { tenantId: string; ownerCtx: { userId: string; tenant: TenantContext } };
  tenantB: { tenantId: string; ownerCtx: { userId: string; tenant: TenantContext } };
  /** user ids by seed key (nurse.a, dr.a2, …) */
  staffUserIds: Record<string, string>;
  /** Patient login users by phone (E.164) → user id. */
  patientUserIds: Map<string, string>;
  phone: (n: number) => string;
  report: { created: string[] };
}

const FIRST_LATIN = [
  'Rahim',
  'Karim',
  'Nusrat',
  'Sultana',
  'Farhana',
  'Tanvir',
  'Shakib',
  'Jannat',
  'Mahmud',
  'Sadia',
  'Arif',
  'Rubel',
  'Mitu',
  'Sabbir',
  'Lamia',
];
const LAST_LATIN = [
  'Uddin',
  'Islam',
  'Jahan',
  'Akter',
  'Hossain',
  'Rahman',
  'Khatun',
  'Begum',
  'Ahmed',
  'Chowdhury',
];
const FIRST_BN = [
  'রহিম',
  'করিম',
  'নুসরাত',
  'সুলতানা',
  'ফারহানা',
  'তানভীর',
  'সাকিব',
  'জান্নাত',
  'মাহমুদ',
  'সাদিয়া',
  'আরিফ',
  'রুবেল',
  'মিতু',
  'সাব্বির',
  'লামিয়া',
];
const LAST_BN = ['উদ্দিন', 'ইসলাম', 'জাহান', 'আক্তার', 'হোসেন', 'রহমান', 'খাতুন', 'বেগম', 'আহমেদ', 'চৌধুরী'];
const HONORIFIC = [
  ['Md. ', 'মোঃ '],
  ['Mst. ', 'মোছাঃ '],
  ['', ''],
];

export async function seedPatients(d: PatientSeedDeps): Promise<void> {
  const { prisma, tenantA, tenantB } = d;
  if ((await prisma.patient.count({ where: { tenantId: tenantA.tenantId } })) > 0) return;
  const events = new PatientEvents(new OutboxPort(d.clock), d.clock);
  const patients = new PatientService(prisma, d.audit, events, d.clock);
  const merges = new MergeService(prisma, d.audit, events, new MergeRepointerRegistry(), d.clock);
  const consents = new ConsentService(prisma, d.audit, events, d.clock);
  const access = new PatientAccessService(prisma, d.audit, events, d.clock);
  const actorA: PatientActor = { ...tenantA.ownerCtx, requestId: newId() };
  const actorB: PatientActor = { ...tenantB.ownerCtx, requestId: newId() };

  const created: string[] = [];
  const contact = (phone: string) => [
    { type: 'PHONE' as const, value: phone, relationship: 'SELF' as const, isPreferred: true },
  ];
  const create = async (actor: PatientActor, i: number, phone: string, consentsList: string[] = ['care']) => {
    const f = i % FIRST_LATIN.length;
    const l = (i * 7) % LAST_LATIN.length;
    const h = HONORIFIC[i % 3]!;
    const p = await patients
      .create(actor, {
        legalName: `${h[0]}${FIRST_LATIN[f]} ${LAST_LATIN[l]}`,
        legalNameBn: `${h[1]}${FIRST_BN[f]} ${LAST_BN[l]}`.normalize('NFC'),
        dateOfBirth: `${1950 + ((i * 13) % 60)}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + ((i * 3) % 28)).padStart(2, '0')}`,
        sex: i % 2 === 0 ? 'FEMALE' : 'MALE',
        preferredLocale: i % 3 === 0 ? 'en-BD' : 'bn-BD',
        contacts: contact(phone),
        consents: consentsList,
      })
      .catch(async (e: { code?: string; details?: Record<string, unknown> }) => {
        if (e.code !== 'DUPLICATE_PATIENT_REVIEW_REQUIRED') throw e;
        // The generator repeats names on purpose; every flagged pair is acknowledged as a distinct person.
        return patients.create(actor, {
          legalName: `${h[0]}${FIRST_LATIN[f]} ${LAST_LATIN[l]}`,
          legalNameBn: `${h[1]}${FIRST_BN[f]} ${LAST_BN[l]}`.normalize('NFC'),
          birthYear: 1950 + ((i * 13) % 60),
          sex: i % 2 === 0 ? 'FEMALE' : 'MALE',
          contacts: contact(phone),
          consents: consentsList,
          duplicateReview: {
            acknowledgedCandidateIds: String(e.details?.candidateIds ?? '')
              .split(',')
              .filter(Boolean),
            reason: 'DEMO seed: generated namesake',
          },
        });
      });
    created.push(p.id);
    return p;
  };

  // 1. Named patients with a role in the demo: P1 (two tenants), P2 (ambiguous phone), P3 (suspended),
  //    P4 = guardian G, D1/D2 dependents, P5 (doctor care-team only).
  const p1 = await create(actorA, 1, d.phone(101), ['care', 'ai_assistance']);
  const p1b = await create(actorB, 1, d.phone(101));
  const p2a = await create(actorA, 2, d.phone(102));
  const p2b = await create(actorA, 3, d.phone(102)); // same phone, different person (acknowledged)
  const p3 = await create(actorA, 4, d.phone(103));
  const p4 = await create(actorA, 5, d.phone(104), ['care', 'ai_assistance']);
  const d1 = await patients.create(actorA, {
    legalName: 'DEMO Child One',
    legalNameBn: 'ডেমো শিশু এক',
    birthYear: 2019,
    sex: 'FEMALE',
    contacts: [{ type: 'PHONE', value: d.phone(104), relationship: 'CAREGIVER', isPreferred: true }],
    consents: ['care'],
  });
  const d2 = await patients.create(actorA, {
    legalName: 'DEMO Elder Parent',
    legalNameBn: 'ডেমো প্রবীণ অভিভাবক',
    birthYear: 1948,
    sex: 'MALE',
    contacts: [{ type: 'PHONE', value: d.phone(104), relationship: 'CAREGIVER', isPreferred: true }],
    consents: ['care'],
  });
  const p5 = await create(actorA, 6, d.phone(105));
  void p2b;

  // 2. Bulk patients (phones 400…) with a spread of names; ten with ai_assistance, one later withdrawn.
  const bulk = [];
  for (let i = 7; i < 60; i++) {
    bulk.push(await create(actorA, i, d.phone(400 + i), i < 17 ? ['care', 'ai_assistance'] : ['care']));
  }
  const withdrawn = await prisma.patientConsent.findFirstOrThrow({
    where: {
      tenantId: tenantA.tenantId,
      patientId: bulk[0]!.id,
      purpose: 'ai_assistance',
      status: 'GRANTED',
    },
  });
  await consents.withdraw({ kind: 'staff', actor: actorA }, withdrawn.id, withdrawn.rowVersion);

  // 3. Two duplicate-review candidates (same phone + similar name) and one OPEN merge case.
  const dupA = await create(actorA, 20, d.phone(480));
  const dupB = await patients.create(actorA, {
    legalName: dupA.legalName.replace('a', 'o'),
    legalNameBn: dupA.legalNameBn ?? undefined,
    birthYear: dupA.birthYear ?? undefined,
    contacts: contact(d.phone(480)),
    consents: ['care'],
    duplicateReview: { acknowledgedCandidateIds: [dupA.id], reason: 'DEMO seed: duplicate-review candidate' },
  });
  await merges.open(actorA, dupB.id, { targetPatientId: dupA.id, reason: 'DEMO seed: probable duplicate' });

  // 4. Verified phones for the linked patients, then accounts via the real auto-link path.
  await prisma.patientContact.updateMany({
    where: { patientId: { in: [p1.id, p1b.id, p2a.id, p2b.id, p3.id, p4.id] }, type: 'PHONE' },
    data: { verificationStatus: 'VERIFIED', verifiedAt: d.clock.now() },
  });
  const user = (n: number) => {
    const id = d.patientUserIds.get(d.phone(n));
    if (!id) throw new Error(`seed: patient login user ${n} missing`);
    return id;
  };
  await access.autoLinkOnOtpVerify(user(101), d.phone(101)); // ACTIVE in tenant A and B (picker)
  await access.autoLinkOnOtpVerify(user(102), d.phone(102)); // ambiguous → nothing
  await access.requestLink(
    { userId: user(102), phoneE164: d.phone(102) },
    { tenantId: tenantA.tenantId, patientId: p2a.id },
  ); // PENDING
  await access.autoLinkOnOtpVerify(user(103), d.phone(103));
  await prisma.patientAccount.updateMany({ where: { userId: user(103) }, data: { status: 'SUSPENDED' } });
  await access.autoLinkOnOtpVerify(user(104), d.phone(104)); // guardian's own SELF account (p4)

  // 5. Guardian G: two ACTIVE guardianships with different scopes, one PENDING self-request, one ENDED.
  const g1 = await access.requestGuardianship({ kind: 'staff', actor: actorA }, d1.id, {
    guardianUserId: user(104),
    guardianPatientId: p4.id,
    relationship: 'PARENT',
    authorityScope: [
      'VIEW_RECORDS',
      'BOOK_APPOINTMENTS',
      'MANAGE_SERIALS',
      'JOIN_TELEMEDICINE',
      'GIVE_CONSENT',
    ],
  });
  await access.activateGuardianship(actorA, g1.id, {
    expectedRowVersion: g1.rowVersion,
    verificationMethod: 'STAFF_VERIFIED_IN_PERSON',
    evidenceRef: 'DEMO',
  });
  const g2 = await access.requestGuardianship({ kind: 'staff', actor: actorA }, d2.id, {
    guardianUserId: user(104),
    guardianPatientId: p4.id,
    relationship: 'CHILD',
    authorityScope: ['VIEW_RECORDS', 'MANAGE_COMMUNICATION_PREFERENCES'],
  });
  await access.activateGuardianship(actorA, g2.id, {
    expectedRowVersion: g2.rowVersion,
    verificationMethod: 'STAFF_VERIFIED_DOCUMENT',
    evidenceRef: 'DEMO',
  });
  await access.requestGuardianship(
    { kind: 'user', user: { userId: user(104), phoneE164: d.phone(104) }, tenantId: tenantA.tenantId },
    p5.id,
    {
      relationship: 'OTHER_CAREGIVER',
      authorityScope: ['VIEW_RECORDS'],
    },
  ); // stays PENDING
  const g3 = await access.requestGuardianship({ kind: 'staff', actor: actorA }, bulk[1]!.id, {
    guardianUserId: user(104),
    relationship: 'OTHER_CAREGIVER',
    authorityScope: ['VIEW_RECORDS'],
  });
  const g3a = await access.activateGuardianship(actorA, g3.id, {
    expectedRowVersion: g3.rowVersion,
    verificationMethod: 'STAFF_VERIFIED_IN_PERSON',
  });
  await access.endGuardianship(actorA, g3.id, { expectedRowVersion: g3a.rowVersion, outcome: 'ENDED' });

  // 6. Care team: nurse N1 for 5 patients (one ended), Dr. A2 as DOCTOR member for P5.
  const nurse = d.staffUserIds['nurse.a'];
  const drA2 = d.staffUserIds['dr.a2'];
  if (nurse && drA2) {
    for (const [i, p] of [p1, p2a, p3, bulk[2]!, bulk[3]!].entries()) {
      const m = await access.addCareTeamMember(actorA, p.id, {
        memberUserId: nurse,
        role: 'NURSE',
        reason: 'DEMO ward nurse',
      });
      if (i === 4) await access.endCareTeamMember(actorA, m.id, m.rowVersion);
    }
    await access.addCareTeamMember(actorA, p5.id, {
      memberUserId: drA2,
      role: 'DOCTOR',
      reason: 'DEMO consulting doctor',
    });
  }
  d.report.created.push(
    `patients (${created.length + 4} incl. duplicate pair, guardian + 2 dependents, accounts, merge case)`,
  );
}

/** Seed assertions for the patient dataset (SEED-DATA §4). */
export async function verifyPatientSeed(
  prisma: PrismaClient,
  tenantAId: string,
  phone: (n: number) => string,
): Promise<string[]> {
  const problems: string[] = [];
  const count = await prisma.patient.count({ where: { tenantId: tenantAId } });
  if (count < 55) problems.push(`tenant A has ${count} patients (expected ≥ 55)`);
  if ((await prisma.patientMergeCase.count({ where: { tenantId: tenantAId, status: 'OPEN' } })) !== 1)
    problems.push('exactly one OPEN merge case expected');
  const g = await prisma.user.findUnique({ where: { phoneE164: phone(104) } });
  if (!g) problems.push('guardian user missing');
  else {
    const active = await prisma.patientGuardianship.count({
      where: { guardianUserId: g.id, status: 'ACTIVE' },
    });
    const pending = await prisma.patientGuardianship.count({
      where: { guardianUserId: g.id, status: 'PENDING' },
    });
    const ended = await prisma.patientGuardianship.count({
      where: { guardianUserId: g.id, status: 'ENDED' },
    });
    if (active !== 2 || pending !== 1 || ended !== 1)
      problems.push(`guardian G: active=${active} pending=${pending} ended=${ended}`);
  }
  const p1 = await prisma.user.findUnique({ where: { phoneE164: phone(101) } });
  if (p1 && (await prisma.patientAccount.count({ where: { userId: p1.id, status: 'ACTIVE' } })) !== 2)
    problems.push('P1 must have ACTIVE accounts in two tenants');
  for (const [n, status] of [
    [102, 'PENDING'],
    [103, 'SUSPENDED'],
  ] as const) {
    const u = await prisma.user.findUnique({ where: { phoneE164: phone(n) } });
    if (u && (await prisma.patientAccount.count({ where: { userId: u.id, status } })) !== 1)
      problems.push(`patient login ${n} must have one ${status} account`);
  }
  const bn = await prisma.patient.count({ where: { tenantId: tenantAId, legalNameBn: { not: null } } });
  if (bn < 50) problems.push('Bangla names missing');
  const tokens = await prisma.patientSearchToken.count({ where: { tenantId: tenantAId } });
  if (tokens < count * 2) problems.push('search tokens missing');
  const outside = await prisma.patientContact.count({
    where: { type: 'PHONE', NOT: { normalizedValue: { startsWith: '+8801700000' } } },
  });
  if (outside > 0) problems.push('patient phone outside the synthetic range');
  return problems;
}
