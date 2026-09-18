import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FixedClock,
  type MembershipId,
  type StaffRole,
  type TenantContext,
  type TenantId,
} from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort, VerifyAppendOnlyChains } from '@hmedic/audit';
import { PolicyEngine } from '@hmedic/identity-access';
import {
  CoverageService,
  MembershipService,
  TenantBootstrapService,
  soloOwnerGrants,
} from '../../src/public/index';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

// ID-001/ID-006: tenant bootstrap, memberships (T31 part), coverages.
let db: Database;
const clock = new FixedClock(new Date('2026-09-18T06:00:00.000Z'));
let bootstrap: TenantBootstrapService;
let memberships: MembershipService;
let coverages: CoverageService;

beforeAll(() => {
  db = openTestDatabase();
  const audit = new PrismaAuditPort(clock);
  bootstrap = new TenantBootstrapService(db.prisma, audit, clock);
  memberships = new MembershipService(db.prisma, audit, clock);
  coverages = new CoverageService(db.prisma, audit, 30, clock);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
  clock.set(new Date('2026-09-18T06:00:00.000Z'));
});

let n = 0;
const email = (p: string) => `${p}.${++n}.${Date.now()}@example.invalid`;

async function actorFor(tenantId: string, userId: string) {
  const m = await db.prisma.tenantMembership.findFirstOrThrow({ where: { tenantId, userId } });
  const o = m.permissions as { grants: string[]; denials: string[] };
  const tenant: TenantContext = {
    tenantId: tenantId as TenantId,
    membershipId: m.id as MembershipId,
    role: m.role as StaffRole,
    effectivePermissions: PolicyEngine.effectivePermissions(m.role as StaffRole, o),
    clinicIds: [],
    chamberIds: [],
    rolePermissionsVersion: 2,
  };
  return { userId, tenant };
}

async function group() {
  const r = await bootstrap.bootstrap({
    name: 'DEMO Group Clinic',
    practiceType: 'GROUP',
    owner: { email: email('owner'), displayName: 'Owner' },
    actor: { userId: null, type: 'SYSTEM' },
  });
  return { ...r, owner: await actorFor(r.tenantId, r.ownerUserId) };
}

describe('tenant bootstrap', () => {
  it('creates a SOLO tenant owned by a doctor with owner grants, audited on tenant and platform chains', async () => {
    const r = await bootstrap.bootstrap({
      name: 'DEMO Solo Chamber',
      practiceType: 'SOLO',
      owner: { phone: '01700000041', displayName: 'Dr. Demo' },
      actor: { userId: null, type: 'SYSTEM' },
    });
    const tenant = await db.prisma.tenant.findUniqueOrThrow({ where: { id: r.tenantId } });
    expect(tenant).toMatchObject({ practiceType: 'SOLO', ownerDoctorProfileId: r.ownerDoctorProfileId });
    const actor = await actorFor(r.tenantId, r.ownerUserId);
    expect(actor.tenant.role).toBe('doctor');
    for (const p of ['tenant.manage', 'membership.manage', 'prescription.approve', 'ai.approve']) {
      expect(actor.tenant.effectivePermissions.has(p)).toBe(true);
    }
    expect(soloOwnerGrants()).not.toContain('prescription.approve');
    const audits = await db.prisma.auditLog.findMany({ where: { action: 'TENANT_BOOTSTRAPPED' } });
    expect(audits.map((a) => a.chainKey).sort()).toEqual(['platform', `tenant:${r.tenantId}`].sort());
    expect((await new VerifyAppendOnlyChains(db.prisma).run({ full: true })).every((c) => c.ok)).toBe(true);
  });

  it('rejects a taken slug', async () => {
    const a = await group();
    await expect(
      bootstrap.bootstrap({
        name: 'x',
        slug: a.slug,
        practiceType: 'GROUP',
        owner: { email: email('o2'), displayName: 'O' },
        actor: { userId: null, type: 'SYSTEM' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('memberships', () => {
  it('owner creates staff with profiles; doctor gets a doctor profile', async () => {
    const g = await group();
    const doc = await memberships.create(g.owner, {
      email: email('doc'),
      displayName: 'Dr. A',
      role: 'doctor',
    });
    const nurse = await memberships.create(g.owner, {
      phone: '01700000042',
      displayName: 'Nurse B',
      role: 'nurse',
    });
    expect(await db.prisma.doctorProfile.count({ where: { tenantId: g.tenantId, userId: doc.userId } })).toBe(
      1,
    );
    expect(
      await db.prisma.staffProfile.count({ where: { tenantId: g.tenantId, userId: nurse.userId } }),
    ).toBe(1);
    expect((await memberships.list(g.tenantId)).map((m) => m.role).sort()).toEqual([
      'doctor',
      'nurse',
      'tenant_owner',
    ]);
    await expect(
      memberships.create(g.owner, { phone: '01700000042', displayName: 'Again', role: 'nurse' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects platform permissions, unknown names and doctor-only grants on write (T31)', async () => {
    const g = await group();
    for (const grants of [['ops.jobs.replay'], ['no.such.permission'], ['prescription.approve']]) {
      await expect(
        memberships.create(g.owner, {
          email: email('n'),
          displayName: 'N',
          role: 'nurse',
          permissions: { grants, denials: [] },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(await db.prisma.tenantMembership.count({ where: { tenantId: g.tenantId } })).toBe(1);
  });

  it('clinic admins cannot create owners or grant tenant.manage / ai.policy.manage', async () => {
    const g = await group();
    const adm = await memberships.create(g.owner, {
      email: email('adm'),
      displayName: 'Admin',
      role: 'clinic_admin',
    });
    const admin = await actorFor(g.tenantId, adm.userId);
    await expect(
      memberships.create(admin, { email: email('o'), displayName: 'O', role: 'tenant_owner' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      memberships.create(admin, {
        email: email('r'),
        displayName: 'R',
        role: 'receptionist',
        permissions: { grants: ['tenant.manage'], denials: [] },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const ok = await memberships.create(admin, {
      email: email('r2'),
      displayName: 'R2',
      role: 'receptionist',
      permissions: { grants: ['patient_account.manage'], denials: [] },
    });
    expect(ok.permissions.grants).toEqual(['patient_account.manage']);
    // Admins cannot touch owner memberships.
    const ownerMembership = (await memberships.list(g.tenantId)).find((m) => m.role === 'tenant_owner')!;
    await expect(
      memberships.update(admin, ownerMembership.id, { expectedRowVersion: 1, status: 'SUSPENDED' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('updates with expectedRowVersion, audits permission changes, forbids self-escalation and keeps the last owner', async () => {
    const g = await group();
    const nurse = await memberships.create(g.owner, {
      email: email('nurse'),
      displayName: 'N',
      role: 'nurse',
    });
    const updated = await memberships.update(g.owner, nurse.id, {
      expectedRowVersion: nurse.rowVersion,
      permissions: { grants: ['prescription.review'], denials: ['communication.send'] },
    });
    expect(updated.rowVersion).toBe(nurse.rowVersion + 1);
    await expect(
      memberships.update(g.owner, nurse.id, { expectedRowVersion: nurse.rowVersion, status: 'SUSPENDED' }),
    ).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    expect(
      await db.prisma.auditLog.count({
        where: { action: 'MEMBERSHIP_PERMISSIONS_CHANGED', resourceId: nurse.id },
      }),
    ).toBe(1);
    const nurseActor = await actorFor(g.tenantId, nurse.userId);
    expect(nurseActor.tenant.effectivePermissions.has('prescription.review')).toBe(true);
    expect(nurseActor.tenant.effectivePermissions.has('communication.send')).toBe(false);
    const own = (await memberships.list(g.tenantId)).find((m) => m.role === 'tenant_owner')!;
    await expect(
      memberships.update(g.owner, own.id, { expectedRowVersion: own.rowVersion, role: 'nurse' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A second owner may suspend the first (two active owners); nobody can change their own membership, so
    // the remaining owner cannot demote or suspend themself (last-owner protection is defense in depth).
    const second = await memberships.create(g.owner, {
      email: email('o2'),
      displayName: 'O2',
      role: 'tenant_owner',
    });
    const secondActor = await actorFor(g.tenantId, second.userId);
    await expect(
      memberships.update(secondActor, own.id, { expectedRowVersion: own.rowVersion, status: 'SUSPENDED' }),
    ).resolves.toMatchObject({ status: 'SUSPENDED' });
    await expect(
      memberships.update(secondActor, second.id, {
        expectedRowVersion: second.rowVersion,
        status: 'SUSPENDED',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('coverages', () => {
  async function twoDoctors() {
    const g = await group();
    const a = await memberships.create(g.owner, { email: email('da'), displayName: 'Dr A', role: 'doctor' });
    const b = await memberships.create(g.owner, { email: email('db'), displayName: 'Dr B', role: 'doctor' });
    const c = await memberships.create(g.owner, { email: email('dc'), displayName: 'Dr C', role: 'doctor' });
    const profile = async (userId: string) =>
      (await db.prisma.doctorProfile.findFirstOrThrow({ where: { tenantId: g.tenantId, userId } })).id;
    return {
      g,
      a: { ...a, profileId: await profile(a.userId) },
      b: { ...b, profileId: await profile(b.userId) },
      c: { ...c, profileId: await profile(c.userId) },
    };
  }
  const window = (days: number) => ({
    startsAt: clock.now(),
    endsAt: new Date(clock.now().getTime() + days * 86_400_000),
  });

  it('validates the window and maximum duration', async () => {
    const { g, a, b } = await twoDoctors();
    const base = {
      coveredDoctorProfileId: a.profileId,
      coveringDoctorProfileId: b.profileId,
      reason: 'leave',
    };
    await expect(coverages.grant(g.owner, { ...base, ...window(31) })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      coverages.grant(g.owner, { ...base, coveringDoctorProfileId: a.profileId, ...window(3) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(coverages.grant(g.owner, { ...base, ...window(3) })).resolves.toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('is non-transitive and expires', async () => {
    const { g, a, b, c } = await twoDoctors();
    await coverages.grant(g.owner, {
      coveredDoctorProfileId: a.profileId,
      coveringDoctorProfileId: b.profileId,
      reason: 'r',
      ...window(3),
    });
    await coverages.grant(g.owner, {
      coveredDoctorProfileId: b.profileId,
      coveringDoctorProfileId: c.profileId,
      reason: 'r',
      ...window(3),
    });
    expect(await coverages.activeCoverers(g.tenantId, a.profileId, clock.now())).toEqual([b.profileId]);
    clock.advanceMs(4 * 86_400_000);
    expect(await coverages.activeCoverers(g.tenantId, a.profileId, clock.now())).toEqual([]);
  });

  it('a doctor with a coverage.manage grant manages only their own coverage; revocation is versioned', async () => {
    const { g, a, b, c } = await twoDoctors();
    const aMembership = (await memberships.list(g.tenantId)).find((m) => m.userId === a.userId)!;
    await memberships.update(g.owner, aMembership.id, {
      expectedRowVersion: aMembership.rowVersion,
      permissions: { grants: ['coverage.manage'], denials: [] },
    });
    const doctorA = await actorFor(g.tenantId, a.userId);
    await expect(
      coverages.grant(doctorA, {
        coveredDoctorProfileId: b.profileId,
        coveringDoctorProfileId: c.profileId,
        reason: 'r',
        ...window(2),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const cov = await coverages.grant(doctorA, {
      coveredDoctorProfileId: a.profileId,
      coveringDoctorProfileId: c.profileId,
      reason: 'r',
      ...window(2),
    });
    await expect(coverages.revoke(doctorA, cov.id, 99)).rejects.toMatchObject({ code: 'STALE_VERSION' });
    await expect(coverages.revoke(doctorA, cov.id, cov.rowVersion)).resolves.toMatchObject({
      status: 'REVOKED',
    });
    expect(await coverages.list(doctorA)).toHaveLength(1);
  });
});
