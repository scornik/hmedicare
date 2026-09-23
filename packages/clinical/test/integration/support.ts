import { type MembershipId, type StaffRole, type TenantContext, type TenantId, newId } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import type { ClinicalActor } from '../../src/public';

/**
 * The fixture every clinical integration suite starts from: one tenant, one doctor, one open chamber day
 * and one patient called to be seen. Shared rather than copied so a schema change lands in one place —
 * the Stage 5 suites each grew their own copy and every new required column had to be found five times.
 */
/**
 * A resolved tenant context. The clinical services care only about `tenantId`; the rest of the shape is
 * the HTTP layer's business and is filled in so the type is honest rather than cast away.
 */
export function tenantContext(tenantId: TenantId, role: StaffRole = 'doctor'): TenantContext {
  return {
    tenantId,
    membershipId: newId<MembershipId>(),
    role,
    effectivePermissions: new Set<string>(),
    clinicIds: [],
    chamberIds: [],
    rolePermissionsVersion: 2,
  };
}

/** A tenant with a doctor, a chamber, an open day and one CALLED serial: the state a consultation starts from. */
export async function chamberWithCalledSerial(p: PrismaClient, label: string) {
  const now = new Date();
  const tenantId = newId<TenantId>();
  const userId = newId();
  const doctorProfileId = newId();
  const patientId = newId();
  const clinicId = newId();
  const chamberId = newId();
  const chamberDayId = newId();
  const serialId = newId();

  await p.tenant.create({
    data: {
      id: tenantId,
      name: `DEMO ${label}`,
      slug: `${label}-${tenantId.slice(-6)}`,
      status: 'ACTIVE',
      practiceType: 'GROUP',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.user.create({
    data: {
      id: userId,
      email: `${userId}@example.invalid`,
      emailNormalized: `${userId}@example.invalid`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.doctorProfile.create({
    data: {
      id: doctorProfileId,
      tenantId,
      userId,
      displayName: `Dr. ${label}`,
      specialties: [],
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.patient.create({
    data: {
      id: patientId,
      tenantId,
      medicalRecordNumber: patientId.slice(-12),
      legalName: 'SYNTHETIC Patient',
      displayName: 'SYNTHETIC Patient',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.clinic.create({
    data: {
      id: clinicId,
      tenantId,
      name: `DEMO Clinic ${label}`,
      nameNormalizedHash: newId().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.chamber.create({
    data: {
      id: chamberId,
      tenantId,
      clinicId,
      doctorProfileId,
      name: `DEMO Chamber ${label}`,
      supportsPhysical: true,
      supportsRemote: false,
      supportsHybrid: false,
      defaultQueuePolicy: {},
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.chamberDay.create({
    data: {
      id: chamberDayId,
      tenantId,
      chamberId,
      doctorProfileId,
      localDate: now,
      localStartTime: new Date('1970-01-01T00:00:00.000Z'),
      localEndTime: new Date('1970-01-01T23:59:00.000Z'),
      timezone: 'Asia/Dhaka',
      status: 'OPEN',
      queuePolicy: {},
      createdAt: now,
      updatedAt: now,
    },
  });
  const serial = await p.serial.create({
    data: {
      id: serialId,
      tenantId,
      chamberDayId,
      patientId,
      serialNumber: 1,
      source: 'WALK_IN',
      careMode: 'PHYSICAL',
      status: 'CALLED',
      createdAt: now,
      updatedAt: now,
    },
  });
  const actor: ClinicalActor = {
    userId,
    tenant: tenantContext(tenantId),
    doctorProfileId,
    requestId: newId(),
    correlationId: newId(),
  };
  return { tenantId, userId, doctorProfileId, patientId, chamberId, chamberDayId, serial, actor };
}
