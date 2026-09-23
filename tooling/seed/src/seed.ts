import { createHash, randomBytes } from 'node:crypto';
import {
  type Clock,
  type MembershipId,
  type StaffRole,
  type TenantContext,
  type TenantId,
  newId,
  systemClock,
} from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import { PrismaAuditPort, VerifyAppendOnlyChains, auditChainSource } from '@hmedic/audit';
import { Argon2idHasher, PlatformOperatorService, PolicyEngine } from '@hmedic/identity-access';
import { CoverageService, MembershipService, TenantBootstrapService } from '@hmedic/tenant-org';
import { ProviderCredentialVault } from '@hmedic/provider-credentials';
import { SecretEnvelope, gateChainSource, kekFromBase64 } from '@hmedic/secrets';
import { dhakaDate } from '@hmedic/localization';
import { seedChambers, verifyChamberSeed } from './chambers';
import { seedPatients, verifyPatientSeed } from './patients';
import { seedClinical, verifyClinicalSeed } from './clinical';
import { seedQueue, verifyQueueSeed } from './queue';

/**
 * Synthetic seed (SEED-DATA.md, Stage 4 subset): tenants, clinics, every staff role, coverages, a platform
 * operator, patient login users, SMS credentials and balance snapshots. Idempotent (natural keys: slugs,
 * emails, phones). Uses the application services so audit chains and invariants are exercised.
 * Passwords are generated per run for newly created (or --rotate-passwords) users and printed once.
 */
export interface SeedConfig {
  appEnv: string;
  argon2: { memoryKiB: number; timeCost: number; parallelism: number };
  kek: { id: string; base64: string };
  fingerprintPepper: string;
}

export const SEED_VERSION = 'stage4-v1';
export const EMAIL_DOMAIN = 'example.invalid';
const PHONE = (n: number) => `+8801700000${String(n).padStart(3, '0')}`;

export const TENANT_A = { slug: 'demo-chamber-group', name: 'DEMO Chamber Group' };
export const TENANT_B = { slug: 'demo-solo-practice', name: 'DEMO Solo Practice' };

export const STAFF_A: ReadonlyArray<{ key: string; role: StaffRole; name: string; phone: number }> = [
  { key: 'owner.a', role: 'tenant_owner', name: 'DEMO Owner A', phone: 201 },
  { key: 'admin.a', role: 'clinic_admin', name: 'DEMO Clinic Admin', phone: 202 },
  { key: 'dr.a1', role: 'doctor', name: 'Dr. DEMO A1', phone: 203 },
  { key: 'dr.a2', role: 'doctor', name: 'Dr. DEMO A2', phone: 204 },
  { key: 'nurse.a', role: 'nurse', name: 'DEMO Nurse N1', phone: 205 },
  { key: 'reception.a', role: 'receptionist', name: 'DEMO Receptionist', phone: 206 },
  { key: 'billing.a', role: 'billing_manager', name: 'DEMO Billing Manager', phone: 207 },
];
export const DOCTOR_B = { key: 'dr.b1', name: 'Dr. DEMO B1', phone: 301 };
export const OPERATOR = { key: 'operator', name: 'DEMO Platform Operator', phone: 900 };
export const PATIENTS = [101, 102, 103, 104];
export const OPERATOR_PERMISSIONS = [
  'ops.jobs.replay',
  'ops.metrics.read',
  'ops.sms.read',
  'medication.import',
  'platform.tenants.bootstrap',
];

const email = (key: string) => `${key}@${EMAIL_DOMAIN}`;

export interface SeedReport {
  created: string[];
  credentials: Array<{ login: string; role: string; password: string }>;
}

export class Seeder {
  private readonly audit: PrismaAuditPort;
  private readonly hasher: Argon2idHasher;
  private readonly report: SeedReport = { created: [], credentials: [] };

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cfg: SeedConfig,
    private readonly opts: { rotatePasswords: boolean },
    private readonly clock: Clock = systemClock,
  ) {
    this.audit = new PrismaAuditPort(clock);
    this.hasher = new Argon2idHasher(cfg.argon2);
  }

  /** Staff/operator user with a generated password (only when created or rotating). */
  private async ensurePasswordUser(key: string, name: string, phone: number, role: string): Promise<string> {
    const now = this.clock.now();
    const e = email(key);
    let user = await this.prisma.user.findUnique({ where: { emailNormalized: e } });
    const needsPassword = !user?.passwordHash || this.opts.rotatePasswords;
    const password = needsPassword ? randomBytes(12).toString('base64url') : null;
    const hash = password ? await this.hasher.hash(password) : null;
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          id: newId(),
          email: e,
          emailNormalized: e,
          phoneE164: PHONE(phone),
          phoneVerifiedAt: now,
          emailVerifiedAt: now,
          displayName: name,
          status: 'ACTIVE',
          passwordHash: hash,
          passwordChangedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      });
      this.report.created.push(`user ${e}`);
    } else if (hash) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hash, passwordChangedAt: now },
      });
    }
    if (password) this.report.credentials.push({ login: e, role, password });
    return user.id;
  }

  private async tenantContext(
    tenantId: string,
    userId: string,
  ): Promise<{ userId: string; tenant: TenantContext }> {
    const m = await this.prisma.tenantMembership.findFirstOrThrow({ where: { tenantId, userId } });
    const o = m.permissions as { grants?: string[]; denials?: string[] };
    return {
      userId,
      tenant: {
        tenantId: tenantId as TenantId,
        membershipId: m.id as MembershipId,
        role: m.role as StaffRole,
        effectivePermissions: PolicyEngine.effectivePermissions(m.role as StaffRole, {
          grants: o.grants ?? [],
          denials: o.denials ?? [],
        }),
        clinicIds: [],
        chamberIds: [],
        rolePermissionsVersion: PolicyEngine.version,
      },
    };
  }

  private async ensureTenant(
    t: { slug: string; name: string },
    practiceType: 'GROUP' | 'SOLO',
    ownerKey: string,
  ): Promise<string> {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: t.slug } });
    if (existing) return existing.id;
    const r = await new TenantBootstrapService(this.prisma, this.audit, this.clock).bootstrap({
      name: t.name,
      slug: t.slug,
      practiceType,
      owner: {
        email: email(ownerKey),
        displayName: practiceType === 'SOLO' ? DOCTOR_B.name : STAFF_A[0]!.name,
      },
      actor: { userId: null, type: 'SYSTEM' },
    });
    this.report.created.push(`tenant ${t.slug}`);
    return r.tenantId;
  }

  private async ensureClinic(tenantId: string, name: string, smsName: string) {
    const hash = createHash('sha256').update(name.trim().toLowerCase()).digest('hex');
    if (await this.prisma.clinic.findFirst({ where: { tenantId, nameNormalizedHash: hash } })) return;
    const now = this.clock.now();
    await this.prisma.clinic.create({
      data: {
        id: newId(),
        tenantId,
        name,
        nameNormalizedHash: hash,
        smsDisplayName: smsName,
        timezone: 'Asia/Dhaka',
        locale: 'bn-BD',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    this.report.created.push(`clinic ${name}`);
  }

  async run(): Promise<SeedReport> {
    if (this.cfg.appEnv === 'production') throw new Error('seed refuses to run with APP_ENV=production');
    // Tenant A (GROUP) with every staff role.
    const ownerA = await this.ensurePasswordUser(
      STAFF_A[0]!.key,
      STAFF_A[0]!.name,
      STAFF_A[0]!.phone,
      'tenant_owner',
    );
    const tenantA = await this.ensureTenant(TENANT_A, 'GROUP', STAFF_A[0]!.key);
    await this.ensureClinic(tenantA, 'DEMO Dhanmondi Clinic', 'DEMO Clinic');
    await this.ensureClinic(tenantA, 'DEMO Uttara Clinic', 'DEMO Clinic');
    const ownerCtx = await this.tenantContext(tenantA, ownerA);
    const memberships = new MembershipService(this.prisma, this.audit, this.clock);
    const ids: Record<string, string> = { [STAFF_A[0]!.key]: ownerA };
    for (const s of STAFF_A.slice(1)) {
      const userId = await this.ensurePasswordUser(s.key, s.name, s.phone, s.role);
      ids[s.key] = userId;
      if (!(await this.prisma.tenantMembership.findFirst({ where: { tenantId: tenantA, userId } }))) {
        await memberships.create(ownerCtx, { email: email(s.key), displayName: s.name, role: s.role });
        this.report.created.push(`membership ${s.key} (${s.role})`);
      }
    }
    // Tenant B (SOLO) owned by doctor B1.
    await this.ensurePasswordUser(DOCTOR_B.key, DOCTOR_B.name, DOCTOR_B.phone, 'doctor (solo owner)');
    const tenantB = await this.ensureTenant(TENANT_B, 'SOLO', DOCTOR_B.key);
    await this.ensureClinic(tenantB, 'DEMO Solo Chamber', 'DEMO Chamber');
    // Coverage: A2 covers A1 for 3 days, plus an expired coverage from last week.
    const profile = async (userId: string) =>
      (await this.prisma.doctorProfile.findFirstOrThrow({ where: { tenantId: tenantA, userId } })).id;
    const [a1, a2] = [await profile(ids['dr.a1']!), await profile(ids['dr.a2']!)];
    if ((await this.prisma.doctorCoverage.count({ where: { tenantId: tenantA } })) === 0) {
      const now = this.clock.now();
      await new CoverageService(this.prisma, this.audit, 30, this.clock).grant(ownerCtx, {
        coveredDoctorProfileId: a1,
        coveringDoctorProfileId: a2,
        startsAt: now,
        endsAt: new Date(now.getTime() + 3 * 86_400_000),
        reason: 'DEMO leave cover',
      });
      await this.prisma.doctorCoverage.create({
        data: {
          id: newId(),
          tenantId: tenantA,
          coveredDoctorProfileId: a1,
          coveringDoctorProfileId: a2,
          startsAt: new Date(now.getTime() - 9 * 86_400_000),
          endsAt: new Date(now.getTime() - 7 * 86_400_000),
          reason: 'DEMO expired cover',
          status: 'ACTIVE',
          grantedByUserId: ownerA,
          createdAt: now,
          updatedAt: now,
        },
      });
      this.report.created.push('coverages (active + expired)');
    }
    // Platform operator (ops + catalog + bootstrap), password + verified phone for OTP step-up.
    const operatorId = await this.ensurePasswordUser(
      OPERATOR.key,
      OPERATOR.name,
      OPERATOR.phone,
      'platform operator',
    );
    if (
      !(await this.prisma.platformOperator.findFirst({ where: { userId: operatorId, status: 'ACTIVE' } }))
    ) {
      await new PlatformOperatorService(this.prisma, this.audit, this.clock).grant({
        email: email(OPERATOR.key),
        permissions: OPERATOR_PERMISSIONS,
        grantedBy: `seed:${SEED_VERSION}`,
        grantorUserId: null,
      });
      this.report.created.push('platform operator');
    }
    // Patient login users (phone + OTP; no tenant link until Stage 5 patient accounts).
    for (const n of PATIENTS) {
      const phone = PHONE(n);
      if (!(await this.prisma.user.findUnique({ where: { phoneE164: phone } }))) {
        const now = this.clock.now();
        await this.prisma.user.create({
          data: {
            id: newId(),
            phoneE164: phone,
            phoneVerifiedAt: now,
            displayName: `DEMO Patient ${n}`,
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          },
        });
        this.report.created.push(`patient login user ${phone.slice(0, 5)}*******${phone.slice(-2)}`);
      }
    }
    await this.seedSms(tenantA);
    // Stage 5: patients, accounts, guardianships, care teams, consents, one open merge case (SEED-DATA §2.2).
    const patientUserIds = new Map<string, string>();
    for (const n of PATIENTS) {
      const u = await this.prisma.user.findUnique({ where: { phoneE164: PHONE(n) }, select: { id: true } });
      if (u) patientUserIds.set(PHONE(n), u.id);
    }
    const ownerB = await this.prisma.user.findUniqueOrThrow({
      where: { emailNormalized: email(DOCTOR_B.key) },
    });
    await seedPatients({
      prisma: this.prisma,
      audit: this.audit,
      clock: this.clock,
      tenantA: { tenantId: tenantA, ownerCtx },
      tenantB: { tenantId: tenantB, ownerCtx: await this.tenantContext(tenantB, ownerB.id) },
      staffUserIds: ids,
      patientUserIds,
      phone: PHONE,
      report: this.report,
    });
    // Stage 5 CP4: chambers, weekly schedules with a holiday, chamber days and today's booking mix.
    await seedChambers({
      prisma: this.prisma,
      audit: this.audit,
      clock: this.clock,
      tenantA: { tenantId: tenantA, ownerCtx },
      tenantB: { tenantId: tenantB, ownerCtx: await this.tenantContext(tenantB, ownerB.id) },
      staffUserIds: ids,
      report: this.report,
    });
    // Stage 5 CP5: the queue-active states, which only the queue commands can reach.
    const queue = await seedQueue({
      prisma: this.prisma,
      audit: this.audit,
      clock: this.clock,
      tenantA: { tenantId: tenantA, ownerCtx },
      staffUserIds: ids,
      report: this.report,
    });
    // Stage 6 CP7: the consultations behind those serials — signed notes, an amendment, a voided and
    // replaced diagnosis, and the legacy shape a migrated Stage 5 database has.
    if (queue) {
      await seedClinical({
        prisma: this.prisma,
        audit: this.audit,
        clock: this.clock,
        serials: queue.serials,
        tenantA: { tenantId: tenantA, ownerCtx },
        report: this.report,
      });
    }
    return this.report;
  }

  /** Tenant A SMS credentials (mock provider, generated fake keys never printed) and 30 days of snapshots. */
  private async seedSms(tenantId: string) {
    if ((await this.prisma.providerCredential.count({ where: { tenantId, providerKind: 'SMS' } })) > 0)
      return;
    const vault = new ProviderCredentialVault(
      this.prisma,
      new SecretEnvelope({ current: kekFromBase64(this.cfg.kek.id, this.cfg.kek.base64) }),
      this.cfg.fingerprintPepper,
      this.audit,
      this.clock,
    );
    const create = (alert: string) =>
      vault.create({
        tenantId,
        actorUserId: null,
        providerKind: 'SMS',
        providerCode: 'mock',
        environment: 'na',
        publicIdentifier: 'DEMOCLINIC',
        bundle: { apiKey: `fake_mock_${randomBytes(16).toString('hex')}` },
        last4Field: 'apiKey',
        balanceAlertBdt: alert,
      });
    const active = await create('100.00');
    await vault.setStatus(tenantId, active.id, 'ACTIVE', null);
    const suspended = await create('100.00');
    await vault.setStatus(tenantId, suspended.id, 'SUSPENDED_BALANCE', 'INSUFFICIENT_BALANCE');
    const now = this.clock.now().getTime();
    const rows = [];
    for (let d = 29; d >= 0; d--) {
      const at = new Date(now - d * 86_400_000);
      rows.push(
        {
          credentialScope: 'PLATFORM',
          tenantId: null,
          credentialId: null,
          balance: (5000 - (29 - d) * 40).toFixed(2),
          parseStatus: 'PARSED',
          checkedAt: at,
        },
        {
          credentialScope: 'TENANT',
          tenantId,
          credentialId: active.id,
          balance: d === 3 ? null : (800 - (29 - d) * 12).toFixed(2),
          parseStatus: d === 3 ? 'UNPARSED' : 'PARSED',
          checkedAt: at,
        },
      );
    }
    await this.prisma.smsBalanceSnapshot.createMany({
      data: rows.map((r) => ({
        id: newId(),
        providerCode: 'mock',
        currencyText: r.balance ? 'BDT' : null,
        errorClass: null,
        ...r,
      })),
    });
    this.report.created.push('SMS credentials (ACTIVE, SUSPENDED_BALANCE) + 60 balance snapshots');
  }
}

/** `--verify` assertions (SEED-DATA §4, Stage 4 subset). Returns the list of failures. */
export async function verifySeed(prisma: PrismaClient): Promise<string[]> {
  const problems: string[] = [];
  const a = await prisma.tenant.findUnique({ where: { slug: TENANT_A.slug } });
  if (a) problems.push(...(await verifyPatientSeed(prisma, a.id, PHONE)));
  if (a) problems.push(...(await verifyChamberSeed(prisma, a.id, dhakaDate(new Date()))));
  if (a) problems.push(...(await verifyQueueSeed(prisma, a.id)));
  if (a) problems.push(...(await verifyClinicalSeed(prisma, a.id)));
  const b = await prisma.tenant.findUnique({ where: { slug: TENANT_B.slug } });
  if (!a || !b) return ['demo tenants missing (run pnpm db:seed)'];
  if (b.practiceType !== 'SOLO' || !b.ownerDoctorProfileId)
    problems.push('tenant B must be SOLO with an owner doctor');
  const roles = new Set(
    (await prisma.tenantMembership.findMany({ where: { tenantId: a.id, status: 'ACTIVE' } })).map(
      (m) => m.role,
    ),
  );
  for (const r of ['tenant_owner', 'clinic_admin', 'doctor', 'nurse', 'receptionist', 'billing_manager']) {
    if (!roles.has(r)) problems.push(`tenant A missing role ${r}`);
  }
  if ((await prisma.platformOperator.count({ where: { status: 'ACTIVE' } })) < 1)
    problems.push('no active platform operator');
  const users = await prisma.user.findMany({ select: { emailNormalized: true, phoneE164: true } });
  for (const u of users) {
    if (u.emailNormalized && !u.emailNormalized.endsWith(`@${EMAIL_DOMAIN}`))
      problems.push(`non-synthetic email ${u.emailNormalized}`);
    if (u.phoneE164 && !/^\+8801700000\d{3}$/.test(u.phoneE164))
      problems.push('phone outside the synthetic range');
  }
  const coverages = await prisma.doctorCoverage.findMany({
    select: { tenantId: true, coveredDoctorProfileId: true, coveringDoctorProfileId: true },
  });
  const profileTenant = new Map(
    (await prisma.doctorProfile.findMany({ select: { id: true, tenantId: true } })).map((p) => [
      p.id,
      p.tenantId,
    ]),
  );
  if (
    coverages.some(
      (c) =>
        profileTenant.get(c.coveredDoctorProfileId) !== c.tenantId ||
        profileTenant.get(c.coveringDoctorProfileId) !== c.tenantId,
    )
  )
    problems.push('cross-tenant coverage rows');
  const chains = await new VerifyAppendOnlyChains(prisma, [auditChainSource, gateChainSource]).run({
    full: true,
  });
  for (const c of chains.filter((x) => !x.ok)) problems.push(`chain ${c.checkpointKey} broken`);
  return problems;
}
