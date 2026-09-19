import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  type MembershipId,
  type TenantContext,
  type TenantId,
  newId,
  systemClock,
} from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort, VerifyAppendOnlyChains, auditChainSource } from '@hmedic/audit';
import { OutboxPort } from '@hmedic/jobs';
import { PolicyEngine } from '@hmedic/identity-access';
import {
  ConsentService,
  MergeRepointerRegistry,
  MergeService,
  PatientAccessService,
  PatientContextResolver,
  PatientEvents,
  PatientService,
  type PatientActor,
} from '../../src/public/index';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

// PAT-003…PAT-008 service behaviour on MariaDB 10.6/11.4. Synthetic names and reserved-range phones only.
let db: Database;
let patients: PatientService;
let merges: MergeService;
let consents: ConsentService;
let access: PatientAccessService;
let contexts: PatientContextResolver;
let repointers: MergeRepointerRegistry;
let phoneSeq = 100;
const nextPhone = () => `+88017000${String(phoneSeq++).padStart(5, '0')}`;
const localPhone = (e164: string) => `0${e164.slice(4)}`;

async function tenant(
  label: string,
  role = 'clinic_admin',
): Promise<{ actor: PatientActor; tenantId: string; userId: string }> {
  const t = systemClock.now();
  const tenantId = newId();
  const userId = newId();
  await db.prisma.tenant.create({
    data: {
      id: tenantId,
      name: `DEMO ${label}`,
      slug: `demo-${label}-${tenantId.slice(-6)}`,
      status: 'ACTIVE',
      createdAt: t,
      updatedAt: t,
    },
  });
  await db.prisma.user.create({
    data: {
      id: userId,
      email: `staff.${userId.slice(-8)}@example.invalid`,
      emailNormalized: `staff.${userId.slice(-8)}@example.invalid`,
      status: 'ACTIVE',
      createdAt: t,
      updatedAt: t,
    },
  });
  const membershipId = newId();
  await db.prisma.tenantMembership.create({
    data: {
      id: membershipId,
      tenantId,
      userId,
      role,
      status: 'ACTIVE',
      permissions: { grants: [], denials: [] },
      clinicIds: [],
      chamberIds: [],
      rolePermissionsVersion: PolicyEngine.version,
      createdAt: t,
      updatedAt: t,
    },
  });
  const ctx: TenantContext = {
    tenantId: tenantId as unknown as TenantId,
    membershipId: membershipId as unknown as MembershipId,
    role: role as TenantContext['role'],
    effectivePermissions: PolicyEngine.effectivePermissions(role as TenantContext['role'], {
      grants: [],
      denials: [],
    }),
    clinicIds: [],
    chamberIds: [],
    rolePermissionsVersion: PolicyEngine.version,
  };
  return { actor: { userId, tenant: ctx, requestId: newId() }, tenantId, userId };
}

async function patientUser(phoneE164: string) {
  const t = systemClock.now();
  const id = newId();
  await db.prisma.user.create({
    data: { id, phoneE164, phoneVerifiedAt: t, status: 'ACTIVE', createdAt: t, updatedAt: t },
  });
  return id;
}

beforeAll(() => {
  db = openTestDatabase({ poolMax: 8 });
  const audit = new PrismaAuditPort(systemClock);
  const events = new PatientEvents(new OutboxPort(systemClock), systemClock);
  repointers = new MergeRepointerRegistry();
  patients = new PatientService(db.prisma, audit, events, systemClock);
  merges = new MergeService(db.prisma, audit, events, repointers, systemClock);
  consents = new ConsentService(db.prisma, audit, events, systemClock);
  access = new PatientAccessService(db.prisma, audit, events, systemClock);
  contexts = new PatientContextResolver(db.prisma);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

const rejects = async (p: Promise<unknown>, code: string) => {
  const e = await p.catch((x: unknown) => x);
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  return e as AppError;
};

describe('create, read, update (PAT-003)', () => {
  it('creates a patient with a derived MRN, normalized contacts, consents, tokens; audits and emits', async () => {
    const { actor, tenantId } = await tenant('create');
    const phone = nextPhone();
    const p = await patients.create(actor, {
      legalName: 'Md. Rahim Uddin',
      legalNameBn: 'মোঃ রহিম উদ্দিন',
      dateOfBirth: '1988-02-14',
      sex: 'MALE',
      contacts: [{ type: 'PHONE', value: localPhone(phone), relationship: 'SELF', isPreferred: true }],
      consents: ['care', 'sms'],
    });
    expect(p.medicalRecordNumber).toMatch(/^P-/);
    expect(p.birthYear).toBe(1988);
    expect(p.contacts).toHaveLength(1);
    expect(p.contacts[0]!.displayValue).toBe(localPhone(phone));
    const stored = await db.prisma.patientContact.findFirstOrThrow({ where: { patientId: p.id } });
    expect(stored.normalizedValue).toBe(phone);
    const tokens = await db.prisma.patientSearchToken.findMany({ where: { patientId: p.id } });
    expect(tokens.map((t) => t.token)).toEqual(expect.arrayContaining(['rahim', 'uddin']));
    expect(tokens.map((t) => t.token)).not.toContain('md');
    expect(await db.prisma.patientConsent.count({ where: { patientId: p.id, status: 'GRANTED' } })).toBe(2);
    const audits = await db.prisma.auditLog.findMany({ where: { tenantId, action: 'PATIENT_CREATED' } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain('Rahim');
    const outbox = await db.prisma.outboxEvent.findMany({ where: { tenantId, eventName: 'PatientCreated' } });
    expect(outbox).toHaveLength(1);
    expect(JSON.stringify(outbox[0]!.payload)).not.toContain(phone);
  });

  it('rejects invalid phones as field errors and updates with optimistic locking', async () => {
    const { actor } = await tenant('update');
    const bad = await rejects(
      patients.create(actor, {
        legalName: 'Karim',
        contacts: [{ type: 'PHONE', value: '0123', relationship: 'SELF', isPreferred: false }],
        consents: [],
      }),
      'VALIDATION_FAILED',
    );
    expect(bad.fieldErrors?.[0]?.path).toBe('contacts.0.value');
    const p = await patients.create(actor, {
      legalName: 'Karim Uddin',
      contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'SELF', isPreferred: false }],
      consents: [],
    });
    const u = await patients.update(actor, p.id, {
      expectedRowVersion: 1,
      legalNameBn: 'করিম উদ্দিন',
      addContacts: [
        { type: 'EMAIL', value: 'Karim@Example.INVALID', relationship: 'SELF', isPreferred: false },
      ],
    });
    expect(u.rowVersion).toBe(2);
    expect(u.legalNameBn).toBe('করিম উদ্দিন');
    expect(u.contacts.map((c) => c.displayValue)).toContain('karim@example.invalid');
    await rejects(patients.update(actor, p.id, { expectedRowVersion: 1, displayName: 'x' }), 'STALE_VERSION');
    const tokens = await db.prisma.patientSearchToken.findMany({
      where: { patientId: p.id, tokenKind: 'NAME' },
    });
    // Latin and transliterated-Bangla spellings are both indexed.
    expect(tokens.map((t) => t.token).sort()).toEqual(['karim', 'korim', 'uddin']);
  });

  it('is tenant-scoped: another tenant cannot read, update or find the patient', async () => {
    const a = await tenant('iso-a');
    const b = await tenant('iso-b');
    const phone = nextPhone();
    const p = await patients.create(a.actor, {
      legalName: 'Nusrat Jahan',
      contacts: [{ type: 'PHONE', value: phone, relationship: 'SELF', isPreferred: true }],
      consents: [],
    });
    await rejects(patients.get(b.actor, p.id), 'RESOURCE_NOT_FOUND');
    await rejects(
      patients.update(b.actor, p.id, { expectedRowVersion: 1, displayName: 'x' }),
      'RESOURCE_NOT_FOUND',
    );
    expect((await patients.search(b.actor, { phone })).items).toEqual([]);
    expect((await patients.search(b.actor, { query: 'nusrat' })).items).toEqual([]);
    expect((await patients.search(a.actor, { phone })).items.map((i) => i.id)).toEqual([p.id]);
  });
});

describe('search (PAT-003, C-41)', () => {
  it('finds a Bangla-named patient by a Banglish query and by phone/MRN; paginates and audits reads', async () => {
    const { actor, tenantId } = await tenant('search');
    const phone = nextPhone();
    const bn = await patients.create(actor, {
      legalName: 'Mosammat Rahima Khatun',
      legalNameBn: 'মোছাঃ রহিমা খাতুন',
      contacts: [{ type: 'PHONE', value: phone, relationship: 'SELF', isPreferred: true }],
      consents: [],
    });
    for (let i = 0; i < 3; i++) {
      await patients.create(actor, {
        legalName: `Rahima Begum ${i}`,
        contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'SELF', isPreferred: true }],
        consents: [],
      });
    }
    await patients.create(actor, {
      legalName: 'Abdul Karim',
      contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'SELF', isPreferred: true }],
      consents: [],
    });

    const byBanglish = await patients.search(actor, { query: 'rohima' });
    expect(byBanglish.items.map((i) => i.id)).toContain(bn.id);
    expect(byBanglish.items.some((i) => i.legalName === 'Abdul Karim')).toBe(false);
    const byBangla = await patients.search(actor, { query: 'রহিমা' });
    expect(byBangla.items.map((i) => i.id)).toContain(bn.id);
    expect(byBangla.items[0]!.legalNameBn).toBe('মোছাঃ রহিমা খাতুন');
    expect(byBangla.items[0]!.phoneMasked).toMatch(/^\+8801\*+\d{2}$/);

    const page1 = await patients.search(actor, { query: 'rahima', limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    const page2 = await patients.search(actor, { query: 'rahima', limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((i) => i.id)).not.toEqual(page1.items.map((i) => i.id));

    expect((await patients.search(actor, { phone: localPhone(phone) })).items.map((i) => i.id)).toEqual([
      bn.id,
    ]);
    expect(
      (await patients.search(actor, { mrn: bn.medicalRecordNumber.toLowerCase() })).items.map((i) => i.id),
    ).toEqual([bn.id]);
    expect(
      await db.prisma.auditLog.count({ where: { tenantId, action: 'PATIENT_SEARCH' } }),
    ).toBeGreaterThanOrEqual(5);
  });
});

describe('duplicate detection (PAT-003)', () => {
  it('requires a review for a likely duplicate, returns candidates, and audits the override', async () => {
    const { actor, tenantId } = await tenant('dup');
    const phone = nextPhone();
    const first = await patients.create(actor, {
      legalName: 'Rahima Khatun',
      dateOfBirth: '1990-05-01',
      contacts: [{ type: 'PHONE', value: phone, relationship: 'SELF', isPreferred: true }],
      consents: [],
    });
    const input = {
      legalName: 'Rohima Khatun',
      birthYear: 1990,
      contacts: [{ type: 'PHONE' as const, value: phone, relationship: 'SELF' as const, isPreferred: true }],
      consents: [],
    };
    const err = await rejects(patients.create(actor, input), 'DUPLICATE_PATIENT_REVIEW_REQUIRED');
    expect(err.details).toMatchObject({ candidateIds: first.id, reviewRequired: true });
    const check = await patients.duplicateCheck(actor, {
      legalName: 'Rohima Khatun',
      phones: [phone],
      birthYear: 1990,
    });
    expect(check.reviewRequired).toBe(true);
    expect(check.candidates[0]).toMatchObject({
      patient: { id: first.id },
      reasons: expect.arrayContaining(['PHONE_MATCH', 'NAME_MATCH']),
    });
    expect(check.candidates[0]!.score).toBeGreaterThanOrEqual(0.65);
    expect(await db.prisma.patient.count({ where: { tenantId } })).toBe(1);

    const second = await patients.create(actor, {
      ...input,
      duplicateReview: { acknowledgedCandidateIds: [first.id], reason: 'twins sharing a phone' },
    });
    expect(second.id).not.toBe(first.id);
    expect(
      await db.prisma.auditLog.count({
        where: { tenantId, action: 'PATIENT_DUPLICATE_OVERRIDE', resourceId: second.id },
      }),
    ).toBe(1);
    // A different person with only a weak name overlap is created without review.
    const other = await patients.create(actor, {
      legalName: 'Rahim Uddin',
      contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'SELF', isPreferred: true }],
      consents: [],
    });
    expect(other.id).toBeDefined();
  });
});

describe('merge (PAT-004, C-47)', () => {
  it('approving a merge marks the source MERGED, re-points registered references, and resolves reads', async () => {
    const { actor, tenantId } = await tenant('merge');
    const src = await patients.create(actor, {
      legalName: 'Rahima Khatun',
      contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'SELF', isPreferred: true }],
      consents: [],
    });
    const tgt = await patients
      .create(actor, {
        legalName: 'Rahima Khatun',
        contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'SELF', isPreferred: true }],
        consents: [],
        duplicateReview: { acknowledgedCandidateIds: [], reason: 'test' },
      })
      .catch(async (e: AppError) => {
        // The duplicate check flags the same name; acknowledge and retry.
        const ids = String(e.details?.candidateIds ?? '').split(',');
        return patients.create(actor, {
          legalName: 'Rahima Khatun',
          contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'SELF', isPreferred: true }],
          consents: [],
          duplicateReview: { acknowledgedCandidateIds: ids, reason: 'test' },
        });
      });
    const moved: string[] = [];
    repointers.register({
      resource: 'test_refs',
      repoint: async (_tx, t, s, g) => {
        expect(t).toBe(tenantId);
        expect([s, g]).toEqual([src.id, tgt.id]);
        moved.push('ref-1', 'ref-2');
        return ['ref-1', 'ref-2'];
      },
    });
    const opened = await merges.open(actor, src.id, { targetPatientId: tgt.id, reason: 'same person' });
    expect(opened.status).toBe('OPEN');
    expect(opened.duplicateScore).toBeGreaterThan(0.9);
    await rejects(
      merges.open(actor, src.id, { targetPatientId: tgt.id, reason: 'again' }),
      'DUPLICATE_PATIENT_REVIEW_REQUIRED',
    );
    const approved = await merges.approve(actor, opened.id, opened.rowVersion);
    expect(approved.status).toBe('APPROVED');
    expect(moved).toHaveLength(2);
    const source = await db.prisma.patient.findUniqueOrThrow({ where: { id: src.id } });
    expect(source).toMatchObject({ status: 'MERGED', mergedIntoPatientId: tgt.id });
    expect((await patients.get(actor, src.id)).id).toBe(tgt.id);
    expect((await patients.search(actor, { query: 'rahima' })).items.map((i) => i.id)).toEqual([tgt.id]);
    const audit = await db.prisma.auditLog.findFirstOrThrow({
      where: { tenantId, action: 'PATIENT_MERGE_APPROVED' },
    });
    expect(audit.metadata).toMatchObject({
      repointed: ['test_refs:ref-1', 'test_refs:ref-2'],
      repointedCount: 2,
    });
    await rejects(merges.approve(actor, opened.id, approved.rowVersion), 'INVALID_TRANSITION');
    const chains = await new VerifyAppendOnlyChains(db.prisma, [auditChainSource]).run({ full: true });
    expect(chains.every((c) => c.ok)).toBe(true);
  });
});

describe('accounts, guardianships, patient contexts (PAT-006/007)', () => {
  it('auto-links on OTP only for a unique VERIFIED phone match; ambiguous phones stay unlinked', async () => {
    const { actor, tenantId } = await tenant('link');
    const shared = nextPhone();
    const unique = nextPhone();
    const p1 = await patients.create(actor, {
      legalName: 'Nusrat Jahan',
      contacts: [{ type: 'PHONE', value: unique, relationship: 'SELF', isPreferred: true }],
      consents: [],
    });
    await patients.create(actor, {
      legalName: 'Twin A',
      contacts: [{ type: 'PHONE', value: shared, relationship: 'SELF', isPreferred: true }],
      consents: [],
    });
    await patients
      .create(actor, {
        legalName: 'Twin B',
        contacts: [{ type: 'PHONE', value: shared, relationship: 'SELF', isPreferred: true }],
        consents: [],
        duplicateReview: { acknowledgedCandidateIds: [], reason: 'x' },
      })
      .catch(async (e: AppError) =>
        patients.create(actor, {
          legalName: 'Twin B',
          contacts: [{ type: 'PHONE', value: shared, relationship: 'SELF', isPreferred: true }],
          consents: [],
          duplicateReview: {
            acknowledgedCandidateIds: String(e.details?.candidateIds).split(','),
            reason: 'x',
          },
        }),
      );
    await db.prisma.patientContact.updateMany({
      where: { tenantId },
      data: { verificationStatus: 'VERIFIED' },
    });
    const u1 = await patientUser(unique);
    const u2 = await patientUser(shared);
    expect(await access.autoLinkOnOtpVerify(u1, unique)).toEqual([tenantId]);
    expect(await access.autoLinkOnOtpVerify(u1, unique)).toEqual([]); // idempotent
    expect(await access.autoLinkOnOtpVerify(u2, shared)).toEqual([]);
    const ctx = await contexts.resolve(u1, tenantId, p1.id, systemClock.now());
    expect(ctx).toMatchObject({ actingAs: 'SELF', patientId: p1.id });
    expect(await contexts.resolve(u2, tenantId, p1.id, systemClock.now())).toBeNull();
    const picker = await contexts.listForUser(u1, systemClock.now());
    expect(picker).toEqual([expect.objectContaining({ tenantId, patientId: p1.id, relationship: 'SELF' })]);
  });

  it('a guardianship acts only after staff activation, within its window and scope; ending it revokes access', async () => {
    const { actor, tenantId } = await tenant('guardian');
    const dependent = await patients.create(actor, {
      legalName: 'Child One',
      birthYear: 2019,
      contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'CAREGIVER', isPreferred: true }],
      consents: [],
    });
    const guardianUser = await patientUser(nextPhone());
    const requested = await access.requestGuardianship(
      { kind: 'user', user: { userId: guardianUser, phoneE164: null }, tenantId },
      dependent.id,
      { relationship: 'PARENT', authorityScope: ['VIEW_RECORDS', 'BOOK_APPOINTMENTS'] },
    );
    expect(requested.status).toBe('PENDING');
    expect(await contexts.resolve(guardianUser, tenantId, dependent.id, systemClock.now())).toBeNull();
    const active = await access.activateGuardianship(actor, requested.id, {
      expectedRowVersion: requested.rowVersion,
      verificationMethod: 'STAFF_VERIFIED_DOCUMENT',
      evidenceRef: 'DEMO',
    });
    expect(active.status).toBe('ACTIVE');
    const ctx = await contexts.resolve(guardianUser, tenantId, dependent.id, systemClock.now());
    expect(ctx).toMatchObject({ actingAs: 'GUARDIAN', guardianshipId: requested.id });
    expect([...ctx!.authorityScope].sort()).toEqual(['BOOK_APPOINTMENTS', 'VIEW_RECORDS']);
    // Consent for a dependent needs GIVE_CONSENT.
    await rejects(
      consents.grant({ kind: 'context', actor: { ...ctx!, requestId: newId() } }, dependent.id, {
        purpose: 'sms',
        policyVersion: 1,
      }),
      'FORBIDDEN',
    );
    const ended = await access.endGuardianship(actor, requested.id, {
      expectedRowVersion: active.rowVersion,
      outcome: 'ENDED',
    });
    expect(ended.status).toBe('ENDED');
    expect(await contexts.resolve(guardianUser, tenantId, dependent.id, systemClock.now())).toBeNull();
    expect(
      await db.prisma.outboxEvent.count({
        where: {
          tenantId,
          eventName: { in: ['GuardianshipRequested', 'GuardianshipActivated', 'GuardianshipEnded'] },
        },
      }),
    ).toBe(3);
  });

  it('a patient context reads only its own patient and consents; another patient is FORBIDDEN', async () => {
    const { actor, tenantId } = await tenant('scope');
    const mine = nextPhone();
    const p1 = await patients.create(actor, {
      legalName: 'Own Patient',
      contacts: [{ type: 'PHONE', value: mine, relationship: 'SELF', isPreferred: true }],
      consents: ['care'],
    });
    const p2 = await patients.create(actor, {
      legalName: 'Other Patient',
      contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'SELF', isPreferred: true }],
      consents: [],
    });
    await db.prisma.patientContact.updateMany({
      where: { tenantId, patientId: p1.id },
      data: { verificationStatus: 'VERIFIED' },
    });
    const user = await patientUser(mine);
    await access.autoLinkOnOtpVerify(user, mine);
    const ctx = {
      ...(await contexts.resolve(user, tenantId, p1.id, systemClock.now()))!,
      requestId: newId(),
    };
    expect((await patients.getForContext(ctx, p1.id)).id).toBe(p1.id);
    await rejects(patients.getForContext(ctx, p2.id), 'FORBIDDEN');
    expect((await consents.list({ kind: 'context', actor: ctx }, p1.id)).map((c) => c.purpose)).toEqual([
      'care',
    ]);
    await rejects(consents.list({ kind: 'context', actor: ctx }, p2.id), 'FORBIDDEN');
    const granted = await consents.grant({ kind: 'context', actor: ctx }, p1.id, {
      purpose: 'sms',
      policyVersion: 2,
    });
    expect(granted.givenByRelationship).toBe('SELF');
    const withdrawn = await consents.withdraw(
      { kind: 'context', actor: ctx },
      granted.id,
      granted.rowVersion,
    );
    expect(withdrawn.status).toBe('WITHDRAWN');
  });

  it('care team: one open membership per (patient, member, role); ending it closes the window', async () => {
    const { actor, tenantId, userId } = await tenant('care', 'tenant_owner');
    const nurse = await tenant('care-nurse', 'nurse');
    // Move the nurse's membership into this tenant.
    await db.prisma.tenantMembership.updateMany({ where: { userId: nurse.userId }, data: { tenantId } });
    const p = await patients.create(actor, {
      legalName: 'Care Patient',
      contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'SELF', isPreferred: true }],
      consents: [],
    });
    const m = await access.addCareTeamMember(actor, p.id, { memberUserId: nurse.userId, role: 'NURSE' });
    await rejects(
      access.addCareTeamMember(actor, p.id, { memberUserId: nurse.userId, role: 'NURSE' }),
      'VALIDATION_FAILED',
    );
    await rejects(
      access.addCareTeamMember(actor, p.id, { memberUserId: userId, role: 'DOCTOR' }),
      'VALIDATION_FAILED',
    );
    expect(
      await access.isCareTeamMember(db.prisma, tenantId, p.id, nurse.userId, 'NURSE', systemClock.now()),
    ).toBe(true);
    const ended = await access.endCareTeamMember(actor, m.id, m.rowVersion);
    expect(ended.endsAt).not.toBeNull();
    expect(
      await access.isCareTeamMember(
        db.prisma,
        tenantId,
        p.id,
        nurse.userId,
        'NURSE',
        new Date(Date.now() + 5_000),
      ),
    ).toBe(false);
  });
});
