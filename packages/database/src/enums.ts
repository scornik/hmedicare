/**
 * Enum source of truth for `code(n)` columns (DATABASE-IMPLEMENTATION.md §1.1). The engine-contract test
 * reads information_schema.CHECK_CONSTRAINTS and fails if any CHECK list differs from these values.
 */
export const DB_ENUMS = {
  'jobs.status': ['QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD'],
  'tenants.status': ['ACTIVE', 'SUSPENDED', 'CLOSED'],
  'tenants.practice_type': ['SOLO', 'GROUP'],
  'users.status': ['ACTIVE', 'LOCKED', 'DISABLED'],
  'tenant_memberships.role': [
    'tenant_owner',
    'clinic_admin',
    'doctor',
    'nurse',
    'receptionist',
    'billing_manager',
  ],
  'tenant_memberships.status': ['INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED'],
  'clinics.status': ['ACTIVE', 'INACTIVE'],
  'doctor_profiles.status': ['ACTIVE', 'INACTIVE'],
  'staff_profiles.status': ['ACTIVE', 'INACTIVE'],
  'doctor_coverages.status': ['ACTIVE', 'REVOKED'],
  'audit_logs.actor_type': ['USER', 'SYSTEM', 'PATIENT_CONTEXT', 'OPERATOR'],
  'audit_logs.acting_as': ['SELF', 'GUARDIAN'],
  'audit_logs.outcome': ['SUCCESS', 'DENIED', 'FAILED'],
  'outbox_events.status': ['PENDING', 'CLAIMED', 'PUBLISHED', 'FAILED'],
  'idempotency_records.status': ['IN_PROGRESS', 'COMPLETED', 'FAILED_RETRYABLE'],
  'sessions.client_type': ['WEB', 'ANDROID', 'IOS'],
  'sessions.revoke_reason': ['LOGOUT', 'LOGOUT_ALL', 'REFRESH_REUSE', 'ADMIN', 'PASSWORD_CHANGED', 'EXPIRED'],
  'otp_challenges.purpose': ['LOGIN', 'PHONE_VERIFY', 'RECOVERY'],
  'otp_challenges.channel': ['SMS', 'WHATSAPP', 'MOCK'],
  'otp_challenges.status': ['PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED', 'SUPERSEDED'],
  'push_devices.platform': ['ANDROID', 'IOS', 'WEB'],
  'push_devices.app': ['DOCTOR_APP', 'PATIENT_APP', 'WEB'],
  'platform_operators.status': ['ACTIVE', 'SUSPENDED', 'REVOKED'],
  'platform_gate_decisions.gate_code': ['GATE-SMS-HTTP', 'GATE-PAY-PLATFORM-COLLECTION'],
  'platform_gate_decisions.environment': ['staging', 'production'],
  'platform_gate_decisions.decision': ['ACCEPTED', 'REVOKED'],
  'provider_credentials.owner_type': ['TENANT', 'CLINIC', 'DOCTOR'],
  'provider_credentials.provider_kind': ['SMS', 'PAYMENT'],
  'provider_credentials.environment': ['sandbox', 'live', 'na'],
  'provider_credentials.status': [
    'PENDING_VALIDATION',
    'ACTIVE',
    'UNVERIFIED_UNTIL_FIRST_PAYMENT',
    'INVALID',
    'SUSPENDED_BALANCE',
    'DISABLED',
    'REVOKED',
  ],
  'provider_credentials.sender_id_status': ['UNVERIFIED', 'VERIFIED', 'INVALID'],
  'sms_balance_snapshots.credential_scope': ['PLATFORM', 'TENANT'],
  'sms_balance_snapshots.parse_status': ['PARSED', 'UNPARSED', 'ERROR'],
  // 0004 patient_identity (Stage 5)
  'patients.sex': ['FEMALE', 'MALE', 'INTERSEX', 'UNKNOWN'],
  'patients.status': ['ACTIVE', 'MERGED', 'INACTIVE'],
  'patient_search_tokens.token_kind': ['NAME', 'SKELETON'],
  'patient_contacts.type': ['PHONE', 'EMAIL', 'WHATSAPP'],
  'patient_contacts.verification_status': ['UNVERIFIED', 'VERIFIED'],
  'patient_contacts.status': ['ACTIVE', 'INACTIVE'],
  'patient_contacts.relationship': ['SELF', 'CAREGIVER', 'EMERGENCY'],
  'patient_identifiers.identifier_type': ['NID', 'BIRTH_REGISTRATION', 'PASSPORT', 'OTHER'],
  'patient_identifiers.source': ['STAFF', 'PATIENT', 'IMPORT'],
  'patient_identifiers.verification_status': ['UNVERIFIED', 'VERIFIED'],
  'patient_consents.purpose': [
    'care',
    'in_app',
    'sms',
    'whatsapp',
    'email',
    'telemedicine',
    'ai_assistance',
    'research',
  ],
  'patient_consents.status': ['GRANTED', 'WITHDRAWN'],
  'patient_consents.given_by_relationship': ['SELF', 'GUARDIAN', 'STAFF_RECORDED'],
  'patient_merge_cases.status': ['OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'REVERSED'],
  'patient_accounts.relationship': ['SELF'],
  'patient_accounts.verification_method': [
    'OTP_PHONE_MATCH',
    'STAFF_VERIFIED_IN_PERSON',
    'STAFF_VERIFIED_DOCUMENT',
  ],
  'patient_accounts.status': ['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED'],
  'patient_guardianships.relationship': ['PARENT', 'LEGAL_GUARDIAN', 'SPOUSE', 'CHILD', 'OTHER_CAREGIVER'],
  'patient_guardianships.verification_method': ['STAFF_VERIFIED_IN_PERSON', 'STAFF_VERIFIED_DOCUMENT'],
  'patient_guardianships.status': ['PENDING', 'ACTIVE', 'ENDED', 'REVOKED'],
  'care_team_members.role': ['DOCTOR', 'NURSE', 'OTHER'],
} as const;

export type DbEnumKey = keyof typeof DB_ENUMS;
export type DbEnum<K extends DbEnumKey> = (typeof DB_ENUMS)[K][number];

export type JobStatus = DbEnum<'jobs.status'>;
export type StaffRoleCode = DbEnum<'tenant_memberships.role'>;
export type MembershipStatus = DbEnum<'tenant_memberships.status'>;
export type OtpStatus = DbEnum<'otp_challenges.status'>;
export type SessionRevokeReason = DbEnum<'sessions.revoke_reason'>;
