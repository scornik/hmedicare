/**
 * Permission catalogs (AUTHORIZATION-MATRIX.md §2). The tenant and platform catalogs are disjoint: a
 * platform permission is never grantable to a tenant membership and vice versa.
 */
export const TENANT_PERMISSIONS = [
  // Tenant/org
  'tenant.manage',
  'membership.manage',
  'clinic.manage',
  'chamber.manage',
  'schedule.manage',
  'coverage.manage',
  // Patient
  'patient.read',
  'patient.write',
  'patient.merge',
  'patient_account.manage',
  'guardianship.manage',
  'care_team.manage',
  // Scheduling/queue
  'appointment.read',
  'appointment.write',
  'serial.write',
  'serial.manage',
  'queue.read',
  'queue.call',
  'queue.manage',
  'chamber_day.close',
  // Clinical
  'encounter.read',
  'encounter.start',
  'encounter.manage',
  'encounter.complete',
  'note.write',
  'note.sign',
  'clinical.write',
  'diagnosis.write',
  // Prescription
  'prescription.read',
  'prescription.write',
  'prescription.review',
  'prescription.approve',
  'prescription.render',
  'prescription.void',
  // Labs/documents
  'lab.write',
  'lab.review',
  'document.read',
  'document.write',
  // Timeline/follow-up
  'timeline.read',
  'followup.write',
  // Communication/telemedicine
  'communication.send',
  'communication.read',
  'communication.retry',
  'telemedicine.start',
  'telemedicine.join',
  'telemedicine.manage',
  // AI
  'ai.use',
  'ai.review',
  'ai.approve',
  'ai.credentials.manage',
  'ai.policy.read',
  'ai.policy.manage',
  'ai.usage.read',
  'ai.audit.raw_read',
  // Audit/export
  'audit.read',
  'export.create',
  // Payments (Stage 3.2)
  'payment.create',
  'payment.read',
  'payment.merchant.manage',
  'fee.manage',
  'refund.manage',
  // SMS (Stage 3.2)
  'sms.credentials.manage',
] as const;

export const PLATFORM_PERMISSIONS = [
  'platform.tenants.bootstrap',
  'platform.operators.manage',
  'ops.jobs.replay',
  'ops.backup.restore_drill',
  'ops.metrics.read',
  'ops.sms.read',
  'medication.import',
  'payout.manage',
  'platform.refund.manage',
] as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

const TENANT_SET: ReadonlySet<string> = new Set(TENANT_PERMISSIONS);
const PLATFORM_SET: ReadonlySet<string> = new Set(PLATFORM_PERMISSIONS);

export function isTenantPermission(value: string): value is TenantPermission {
  return TENANT_SET.has(value);
}

export function isPlatformPermission(value: string): value is PlatformPermission {
  return PLATFORM_SET.has(value);
}

export const STAFF_ROLES = [
  'tenant_owner',
  'clinic_admin',
  'doctor',
  'nurse',
  'receptionist',
  'billing_manager',
] as const;
