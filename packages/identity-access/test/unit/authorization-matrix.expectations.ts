import type { MATRIX_COLUMNS } from './authorization-matrix.fixture';

type StaffRoleColumn = Exclude<(typeof MATRIX_COLUMNS)[number], 'patient_context'>;
type Expect = Partial<Record<StaffRoleColumn, readonly string[]>>;

/**
 * Derivation of each AUTHORIZATION-MATRIX §5 cell into role permissions (default role map, no grants):
 * - `has`: permissions the cell's letters require by default;
 * - `lacks`: permissions a "-" (or a narrower cell) must not have by default;
 * - `grantable`: "if granted X" cells — absent by default, present after a membership grant.
 * Resource scope qualifiers (asg/scope/own) are enforced by use cases, not by the role map.
 * Every §5 row must have an entry (the matrix test enforces it).
 */
export const EXPECTATIONS: Record<string, { has?: Expect; lacks?: Expect; grantable?: Expect }> = {
  'Tenant settings, memberships': {
    has: { tenant_owner: ['tenant.manage', 'membership.manage'], clinic_admin: ['membership.manage'] },
    lacks: {
      clinic_admin: ['tenant.manage'],
      doctor: ['tenant.manage', 'membership.manage'],
      nurse: ['tenant.manage', 'membership.manage'],
      receptionist: ['tenant.manage', 'membership.manage'],
      billing_manager: ['tenant.manage', 'membership.manage'],
    },
  },
  'Clinics, chambers, schedules': {
    has: {
      tenant_owner: ['clinic.manage', 'chamber.manage', 'schedule.manage'],
      clinic_admin: ['clinic.manage', 'chamber.manage', 'schedule.manage'],
    },
    lacks: {
      doctor: ['clinic.manage', 'chamber.manage'],
      nurse: ['clinic.manage', 'chamber.manage', 'schedule.manage'],
      receptionist: ['clinic.manage', 'chamber.manage', 'schedule.manage'],
      billing_manager: ['clinic.manage', 'chamber.manage', 'schedule.manage'],
    },
    grantable: { doctor: ['schedule.manage'] },
  },
  'Patients (demographics)': {
    has: {
      tenant_owner: ['patient.read', 'patient.write', 'export.create'],
      clinic_admin: ['patient.read', 'patient.write'],
      doctor: ['patient.read', 'patient.write'],
      nurse: ['patient.read', 'patient.write'],
      receptionist: ['patient.read', 'patient.write'],
      billing_manager: ['patient.read'],
    },
    lacks: { billing_manager: ['patient.write'] },
  },
  'Patient merge cases': {
    has: {
      tenant_owner: ['patient.merge'],
      clinic_admin: ['patient.merge'],
      doctor: ['patient.merge'],
      nurse: ['patient.merge'],
      receptionist: ['patient.merge'],
    },
    lacks: { billing_manager: ['patient.merge'] },
  },
  'Patient accounts / guardianships': {
    has: {
      tenant_owner: ['patient_account.manage', 'guardianship.manage'],
      clinic_admin: ['patient_account.manage', 'guardianship.manage'],
    },
    lacks: {
      doctor: ['patient_account.manage', 'guardianship.manage'],
      nurse: ['patient_account.manage', 'guardianship.manage'],
      billing_manager: ['patient_account.manage', 'guardianship.manage'],
    },
    grantable: { receptionist: ['patient_account.manage', 'guardianship.manage'] },
  },
  'Care team / coverage': {
    has: {
      tenant_owner: ['care_team.manage', 'coverage.manage'],
      clinic_admin: ['care_team.manage', 'coverage.manage'],
    },
    lacks: {
      nurse: ['care_team.manage', 'coverage.manage'],
      receptionist: ['care_team.manage', 'coverage.manage'],
      billing_manager: ['care_team.manage', 'coverage.manage'],
    },
    grantable: { doctor: ['coverage.manage'] },
  },
  Appointments: {
    has: {
      tenant_owner: ['appointment.read', 'appointment.write'],
      clinic_admin: ['appointment.read', 'appointment.write'],
      doctor: ['appointment.read', 'appointment.write'],
      nurse: ['appointment.read'],
      receptionist: ['appointment.read', 'appointment.write'],
      billing_manager: ['appointment.read'],
    },
    lacks: { nurse: ['appointment.write'], billing_manager: ['appointment.write'] },
  },
  'Serials (issue, check-in, cancel, reschedule, no-show)': {
    has: {
      tenant_owner: ['serial.write', 'serial.manage'],
      clinic_admin: ['serial.write', 'serial.manage'],
      doctor: ['serial.manage'],
      nurse: ['serial.manage'],
      receptionist: ['serial.write', 'serial.manage'],
    },
    lacks: { billing_manager: ['serial.write', 'serial.manage'] },
  },
  'Queue (call, skip, recall, reorder, delay, close day)': {
    has: {
      tenant_owner: ['queue.read', 'queue.call', 'queue.manage', 'chamber_day.close'],
      clinic_admin: ['queue.read', 'queue.call', 'queue.manage', 'chamber_day.close'],
      doctor: ['queue.read', 'queue.call', 'queue.manage', 'chamber_day.close'],
      nurse: ['queue.read', 'queue.manage'],
      receptionist: ['queue.read', 'queue.manage'],
    },
    lacks: { receptionist: ['queue.call'], billing_manager: ['queue.read', 'queue.call', 'queue.manage'] },
  },
  'Encounters (start, interrupt, complete)': {
    has: {
      tenant_owner: ['encounter.read', 'encounter.manage'],
      clinic_admin: ['encounter.read', 'encounter.manage'],
      doctor: ['encounter.read', 'encounter.start', 'encounter.manage', 'encounter.complete'],
      nurse: ['encounter.read', 'encounter.start', 'encounter.manage'],
      receptionist: ['encounter.read'],
    },
    lacks: {
      nurse: ['encounter.complete'],
      receptionist: ['encounter.start', 'encounter.manage', 'encounter.complete'],
      billing_manager: ['encounter.read', 'encounter.start'],
    },
  },
  'Encounter notes (draft, sign, correct)': {
    has: { doctor: ['note.write', 'note.sign'], nurse: ['note.write'] },
    lacks: {
      tenant_owner: ['note.write', 'note.sign'],
      clinic_admin: ['note.write', 'note.sign'],
      nurse: ['note.sign'],
      receptionist: ['note.write', 'note.sign'],
      billing_manager: ['note.write', 'note.sign'],
    },
  },
  Diagnoses: {
    has: { doctor: ['diagnosis.write'], nurse: ['diagnosis.write'] },
    lacks: {
      tenant_owner: ['diagnosis.write'],
      clinic_admin: ['diagnosis.write'],
      receptionist: ['diagnosis.write'],
      billing_manager: ['diagnosis.write'],
    },
  },
  Prescriptions: {
    has: {
      tenant_owner: ['prescription.read', 'prescription.void'],
      clinic_admin: ['prescription.read', 'prescription.void'],
      doctor: [
        'prescription.read',
        'prescription.write',
        'prescription.review',
        'prescription.approve',
        'prescription.void',
      ],
      nurse: ['prescription.read'],
      receptionist: ['prescription.read'],
    },
    lacks: {
      tenant_owner: ['prescription.write', 'prescription.approve'],
      clinic_admin: ['prescription.write', 'prescription.approve'],
      nurse: ['prescription.approve', 'prescription.write'],
      receptionist: ['prescription.write', 'prescription.approve', 'prescription.void'],
      billing_manager: ['prescription.read'],
    },
    grantable: { nurse: ['prescription.review'] },
  },
  'Prescription render': {
    has: {
      tenant_owner: ['prescription.render'],
      clinic_admin: ['prescription.render'],
      doctor: ['prescription.render'],
      receptionist: ['prescription.render'],
    },
    lacks: { nurse: ['prescription.render'], billing_manager: ['prescription.render'] },
  },
  Labs: {
    has: {
      tenant_owner: ['lab.write', 'document.read', 'export.create'],
      clinic_admin: ['lab.write', 'document.read', 'export.create'],
      doctor: ['lab.write', 'lab.review', 'document.read'],
      nurse: ['lab.write', 'document.read'],
      receptionist: ['lab.write', 'document.read'],
    },
    lacks: {
      nurse: ['lab.review'],
      receptionist: ['lab.review'],
      billing_manager: ['lab.write', 'lab.review'],
    },
  },
  Documents: {
    has: {
      tenant_owner: ['document.read', 'document.write'],
      clinic_admin: ['document.read', 'document.write'],
      doctor: ['document.read', 'document.write'],
      nurse: ['document.read', 'document.write'],
      receptionist: ['document.read', 'document.write'],
    },
    lacks: { billing_manager: ['document.read', 'document.write'] },
  },
  Timeline: {
    has: {
      tenant_owner: ['timeline.read'],
      clinic_admin: ['timeline.read'],
      doctor: ['timeline.read', 'export.create'],
      nurse: ['timeline.read'],
      receptionist: ['timeline.read'],
    },
    lacks: { billing_manager: ['timeline.read'] },
  },
  'Follow-ups': {
    has: {
      tenant_owner: ['followup.write'],
      clinic_admin: ['followup.write'],
      doctor: ['followup.write'],
      nurse: ['followup.write'],
      receptionist: ['followup.write'],
    },
    lacks: { billing_manager: ['followup.write'] },
  },
  Communications: {
    has: {
      tenant_owner: ['communication.send', 'communication.read', 'communication.retry'],
      clinic_admin: ['communication.send', 'communication.read', 'communication.retry'],
      doctor: ['communication.send', 'communication.read', 'communication.retry'],
      nurse: ['communication.send', 'communication.read'],
      receptionist: ['communication.send', 'communication.read', 'communication.retry'],
    },
    lacks: {
      nurse: ['communication.retry'],
      billing_manager: ['communication.send', 'communication.read'],
    },
  },
  Telemedicine: {
    has: {
      tenant_owner: ['telemedicine.manage'],
      clinic_admin: ['telemedicine.manage'],
      doctor: ['telemedicine.start', 'telemedicine.join', 'telemedicine.manage'],
      nurse: ['telemedicine.join'],
    },
    lacks: {
      nurse: ['telemedicine.start', 'telemedicine.manage'],
      receptionist: ['telemedicine.start', 'telemedicine.join', 'telemedicine.manage'],
      billing_manager: ['telemedicine.start', 'telemedicine.join', 'telemedicine.manage'],
    },
  },
  'AI use/review/approve': {
    has: { doctor: ['ai.use', 'ai.review', 'ai.approve'] },
    lacks: {
      tenant_owner: ['ai.use', 'ai.review', 'ai.approve'],
      clinic_admin: ['ai.use', 'ai.review', 'ai.approve'],
      nurse: ['ai.use', 'ai.review', 'ai.approve'],
      receptionist: ['ai.use', 'ai.review', 'ai.approve'],
      billing_manager: ['ai.use', 'ai.review', 'ai.approve'],
    },
    grantable: { tenant_owner: ['ai.use', 'ai.review'], nurse: ['ai.review'] },
  },
  'AI credentials (own)': {
    lacks: { tenant_owner: ['ai.credentials.manage'], doctor: ['ai.credentials.manage'] },
  },
  "AI credentials (others')": {
    lacks: { doctor: ['ai.credentials.manage'], nurse: ['ai.credentials.manage'] },
    grantable: { tenant_owner: ['ai.credentials.manage'], clinic_admin: ['ai.credentials.manage'] },
  },
  'AI data-use acknowledgement': { has: { doctor: ['ai.use'] } },
  'Tenant AI policy': {
    has: {
      tenant_owner: ['ai.policy.read', 'ai.policy.manage'],
      clinic_admin: ['ai.policy.read'],
      doctor: ['ai.policy.read'],
    },
    lacks: {
      clinic_admin: ['ai.policy.manage'],
      doctor: ['ai.policy.manage'],
      nurse: ['ai.policy.read'],
      receptionist: ['ai.policy.read'],
      billing_manager: ['ai.policy.read'],
    },
  },
  'AI usage': {
    has: { tenant_owner: ['ai.usage.read'] },
    lacks: { doctor: ['ai.usage.read'], nurse: ['ai.usage.read'] },
    grantable: { clinic_admin: ['ai.usage.read'] },
  },
  'AI raw outputs': {
    has: { tenant_owner: ['ai.audit.raw_read'] },
    lacks: { clinic_admin: ['ai.audit.raw_read'], doctor: ['ai.audit.raw_read'] },
  },
  Audit: {
    has: {
      tenant_owner: ['audit.read', 'export.create'],
      clinic_admin: ['audit.read', 'export.create'],
      doctor: ['audit.read'],
    },
    lacks: { nurse: ['audit.read'], receptionist: ['audit.read'], billing_manager: ['audit.read'] },
  },
  'Payment intents (Stage 3.2)': {
    has: {
      tenant_owner: ['payment.create', 'payment.read', 'export.create'],
      clinic_admin: ['payment.create', 'payment.read'],
      doctor: ['payment.read'],
      receptionist: ['payment.create', 'payment.read'],
      billing_manager: ['payment.create', 'payment.read', 'export.create'],
    },
    lacks: { nurse: ['payment.create', 'payment.read'] },
    grantable: { doctor: ['payment.create'] },
  },
  'Payment review (late/mismatch)': {
    has: { tenant_owner: ['payment.merchant.manage'] },
    lacks: { nurse: ['payment.merchant.manage'], receptionist: ['payment.merchant.manage'] },
    grantable: { billing_manager: ['payment.merchant.manage'] },
  },
  'Fee schedules': {
    has: { tenant_owner: ['fee.manage'], clinic_admin: ['fee.manage'], billing_manager: ['fee.manage'] },
    lacks: { nurse: ['fee.manage'], receptionist: ['fee.manage'] },
    grantable: { doctor: ['fee.manage'] },
  },
  'Merchant accounts, payment settings': {
    has: { tenant_owner: ['payment.merchant.manage'], clinic_admin: ['payment.merchant.manage'] },
    lacks: { nurse: ['payment.merchant.manage'], receptionist: ['payment.merchant.manage'] },
  },
  'Refunds (`DOCTOR_MERCHANT`)': {
    has: { tenant_owner: ['refund.manage'], billing_manager: ['refund.manage'] },
    lacks: { nurse: ['refund.manage'], receptionist: ['refund.manage'] },
    grantable: { clinic_admin: ['refund.manage'] },
  },
  'SMS credentials': {
    has: { tenant_owner: ['sms.credentials.manage'] },
    lacks: {
      doctor: ['sms.credentials.manage'],
      nurse: ['sms.credentials.manage'],
      receptionist: ['sms.credentials.manage'],
      billing_manager: ['sms.credentials.manage'],
    },
    grantable: { clinic_admin: ['sms.credentials.manage'] },
  },
  'Subscription and invoices': {
    has: {
      tenant_owner: ['payment.read', 'payment.create', 'tenant.manage'],
      clinic_admin: ['payment.read'],
      billing_manager: ['payment.read'],
    },
  },
};

/**
 * Snapshot of the role map. The test fails when ROLE_PERMISSIONS changes but ROLE_PERMISSIONS_VERSION does
 * not; update both (plus an audit row) deliberately.
 */
export const ROLE_PERMISSIONS_SNAPSHOT = {
  version: 2,
  sha256: '33995a623e2c58ee48f9dfb00b9961f266f65d5e7438c456abad745af873e93f',
};
