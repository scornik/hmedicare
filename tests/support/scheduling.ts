import { type MembershipId, type TenantContext, type TenantId, newId, systemClock } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { PrismaAuditPort } from '@hmedic/audit';
import { OutboxPort } from '@hmedic/jobs';
import { PolicyEngine } from '@hmedic/identity-access';
import { PatientEvents, PatientService, type PatientActor } from '@hmedic/patient';
import {
  AppointmentService,
  ChamberDayService,
  ChamberService,
  ScheduleService,
  SchedulingEvents,
  type SchedulingActor,
  SerialPortRef,
} from '@hmedic/scheduling';

/**
 * Shared fixtures for the scheduling and queue integration suites: a tenant with a clinic, a doctor and a
 * staff actor, plus the wired services. The queue implementation is bound into `serials` by the caller
 * (`SerialPortRef`), so this harness matches how the API composition root wires the two contexts.
 */
export interface SchedulingHarness {
  audit: PrismaAuditPort;
  events: SchedulingEvents;
  serials: SerialPortRef<never>;
  chambers: ChamberService;
  schedules: ScheduleService;
  days: ChamberDayService;
  appointments: AppointmentService;
  patients: PatientService;
}

export const paymentsOff = { paymentsAvailable: () => false };

export interface TenantFixture {
  tenantId: string;
  clinicId: string;
  doctorProfileId: string;
  userId: string;
  actor: SchedulingActor;
  patientActor: PatientActor;
}

let phoneSeq = 200;
export const nextPhone = (): string => `+88017000${String(phoneSeq++).padStart(5, '0')}`;

export function schedulingServices(db: Database): SchedulingHarness {
  const audit = new PrismaAuditPort(systemClock);
  const events = new SchedulingEvents(new OutboxPort(systemClock), systemClock);
  const serials = new SerialPortRef<never>();
  const chambers = new ChamberService(db.prisma, audit, events, systemClock);
  const schedules = new ScheduleService(db.prisma, audit, events, chambers, systemClock);
  const patients = new PatientService(
    db.prisma,
    audit,
    new PatientEvents(new OutboxPort(systemClock), systemClock),
    systemClock,
  );
  const days = new ChamberDayService(db.prisma, audit, events, chambers, schedules, serials, systemClock);
  const appointments = new AppointmentService(
    db.prisma,
    audit,
    events,
    chambers,
    days,
    serials,
    patients,
    paymentsOff,
    systemClock,
  );
  return { audit, events, serials, chambers, schedules, days, appointments, patients };
}

export async function seedTenant(
  db: Database,
  label: string,
  opts: { role?: string; clinicIds?: string[]; chamberIds?: string[] } = {},
): Promise<TenantFixture> {
  const t = systemClock.now();
  const tenantId = newId();
  const userId = newId();
  const clinicId = newId();
  const doctorUserId = newId();
  const doctorProfileId = newId();
  const role = opts.role ?? 'clinic_admin';
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
  for (const [id, suffix] of [
    [userId, 'staff'],
    [doctorUserId, 'doctor'],
  ] as const) {
    const email = `${suffix}.${id.slice(-8)}@example.invalid`;
    await db.prisma.user.create({
      data: { id, email, emailNormalized: email, status: 'ACTIVE', createdAt: t, updatedAt: t },
    });
  }
  await db.prisma.clinic.create({
    data: {
      id: clinicId,
      tenantId,
      name: `DEMO Clinic ${label}`,
      nameNormalizedHash: newId().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
      status: 'ACTIVE',
      createdAt: t,
      updatedAt: t,
    },
  });
  await db.prisma.doctorProfile.create({
    data: {
      id: doctorProfileId,
      tenantId,
      userId: doctorUserId,
      displayName: `Dr. ${label}`,
      specialties: [],
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
      clinicIds: opts.clinicIds ?? [],
      chamberIds: opts.chamberIds ?? [],
      rolePermissionsVersion: PolicyEngine.version,
      createdAt: t,
      updatedAt: t,
    },
  });
  const tenant: TenantContext = {
    tenantId: tenantId as unknown as TenantId,
    membershipId: membershipId as unknown as MembershipId,
    role: role as TenantContext['role'],
    effectivePermissions: PolicyEngine.effectivePermissions(role as TenantContext['role'], {
      grants: [],
      denials: [],
    }),
    clinicIds: opts.clinicIds ?? [],
    chamberIds: opts.chamberIds ?? [],
    rolePermissionsVersion: PolicyEngine.version,
  };
  const actor: SchedulingActor = { userId, tenant, requestId: newId(), correlationId: newId() };
  return {
    tenantId,
    clinicId,
    doctorProfileId,
    userId,
    actor,
    patientActor: { userId, tenant, requestId: actor.requestId },
  };
}

/** Creates a patient in the tenant with one synthetic phone contact. */
export async function seedPatient(
  patients: PatientService,
  actor: PatientActor,
  legalName: string,
): Promise<string> {
  const p = await patients.create(actor, {
    legalName,
    contacts: [{ type: 'PHONE', value: nextPhone(), relationship: 'SELF', isPreferred: true }],
    consents: ['care'],
  });
  return p.id;
}

/** A weekly rule covering every weekday, 17:00–21:00 local, effective from 2020. */
export async function weeklyEveningRules(
  schedules: ScheduleService,
  actor: SchedulingActor,
  chamberId: string,
): Promise<void> {
  for (let weekday = 1; weekday <= 7; weekday++) {
    await schedules.create(actor, chamberId, {
      ruleType: 'WEEKLY',
      weekday,
      localStartTime: '17:00',
      localEndTime: '21:00',
      effectiveFrom: '2020-01-01',
    });
  }
}
