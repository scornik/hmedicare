import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { LocalDate } from './patient';
import { bearerAuth, registry, z } from './registry';

// API-IMPLEMENTATION §3.4: patient accounts, guardianships, care team (AUTHORIZATION-MATRIX §4).
export const GuardianScope = z.enum([
  'VIEW_RECORDS',
  'BOOK_APPOINTMENTS',
  'MANAGE_SERIALS',
  'JOIN_TELEMEDICINE',
  'UPLOAD_DOCUMENTS',
  'MANAGE_COMMUNICATION_PREFERENCES',
  'GIVE_CONSENT',
  'MAKE_PAYMENTS',
]);
export const GuardianRelationship = z.enum([
  'PARENT',
  'LEGAL_GUARDIAN',
  'SPOUSE',
  'CHILD',
  'OTHER_CAREGIVER',
]);
export const StaffVerificationMethod = z.enum(['STAFF_VERIFIED_IN_PERSON', 'STAFF_VERIFIED_DOCUMENT']);

export const PatientAccount = registry.register(
  'PatientAccount',
  z.object({
    id: Uuid,
    userId: Uuid,
    patientId: Uuid,
    relationship: z.literal('SELF'),
    verificationMethod: z.enum(['OTP_PHONE_MATCH', 'STAFF_VERIFIED_IN_PERSON', 'STAFF_VERIFIED_DOCUMENT']),
    status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED']),
    verifiedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);

export const LinkRequest = registry.register(
  'PatientAccountLinkRequest',
  z.object({ tenantId: Uuid, patientId: Uuid }),
);

export const VerifyPatientAccountRequest = registry.register(
  'VerifyPatientAccountRequest',
  z.object({ expectedRowVersion: z.number().int().min(1), method: StaffVerificationMethod }),
);

export const RowVersionRequest = z.object({ expectedRowVersion: z.number().int().min(1) });

export const PatientAccountListResponse = registry.register(
  'PatientAccountListResponse',
  z.object({ items: z.array(PatientAccount), nextCursor: z.string().nullable(), hasMore: z.boolean() }),
);

export const Guardianship = registry.register(
  'Guardianship',
  z.object({
    id: Uuid,
    guardianUserId: Uuid,
    guardianPatientId: Uuid.nullable(),
    dependentPatientId: Uuid,
    relationship: GuardianRelationship,
    authorityScope: z.array(GuardianScope),
    status: z.enum(['PENDING', 'ACTIVE', 'ENDED', 'REVOKED']),
    verificationMethod: StaffVerificationMethod.nullable(),
    startsOn: LocalDate,
    endsOn: LocalDate.nullable(),
    createdAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);

export const RequestGuardianshipRequest = registry.register(
  'RequestGuardianshipRequest',
  z.object({
    guardianUserId: Uuid.optional().openapi({
      description: 'Staff only; a patient user is always the guardian',
    }),
    guardianPatientId: Uuid.optional(),
    relationship: GuardianRelationship,
    authorityScope: z.array(GuardianScope).min(1).max(8),
  }),
);

export const ActivateGuardianshipRequest = registry.register(
  'ActivateGuardianshipRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1),
    verificationMethod: StaffVerificationMethod,
    evidenceRef: z.string().trim().max(191).optional(),
    startsOn: LocalDate.optional(),
    endsOn: LocalDate.nullable().optional(),
    authorityScope: z.array(GuardianScope).min(1).max(8).optional(),
  }),
);

export const EndGuardianshipRequest = registry.register(
  'EndGuardianshipRequest',
  z.object({ expectedRowVersion: z.number().int().min(1), reason: z.string().trim().max(300).optional() }),
);

export const GuardianshipListResponse = registry.register(
  'GuardianshipListResponse',
  z.object({ items: z.array(Guardianship), nextCursor: z.string().nullable(), hasMore: z.boolean() }),
);

export const CareTeamMember = registry.register(
  'CareTeamMember',
  z.object({
    id: Uuid,
    patientId: Uuid,
    memberUserId: Uuid,
    role: z.enum(['DOCTOR', 'NURSE', 'OTHER']),
    startsAt: Timestamp,
    endsAt: Timestamp.nullable(),
    reason: z.string().nullable(),
    rowVersion: z.number().int(),
  }),
);

export const AddCareTeamMemberRequest = registry.register(
  'AddCareTeamMemberRequest',
  z.object({
    memberUserId: Uuid,
    role: z.enum(['DOCTOR', 'NURSE', 'OTHER']),
    reason: z.string().trim().max(300).optional(),
    startsAt: Timestamp.optional(),
  }),
);

const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const secured = [{ [bearerAuth.name]: [] }];
const tenantHeaders = z.object({ 'X-Tenant-ID': TenantIdHeader });
const tenantIdemHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'Idempotency-Key': IdempotencyKeyHeader,
});
const idem = z.object({ 'Idempotency-Key': IdempotencyKeyHeader });
const ok = (schema: z.ZodTypeAny, description: string) => ({ description, content: json(envelope(schema)) });
const idParam = z.object({ id: Uuid });
const cursorQuery = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
};

registry.registerPath({
  method: 'post',
  path: '/api/v1/patient-accounts/link-requests',
  operationId: 'requestPatientAccountLink',
  tags: ['patient-accounts'],
  security: secured,
  description:
    'Patient user (OTP-authenticated, no tenant header): asks a tenant to link this login to a patient record (PENDING).',
  request: { headers: idem, body: { content: json(LinkRequest) } },
  responses: { 201: ok(PatientAccount, 'Pending link request'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/patient-accounts',
  operationId: 'listPatientAccounts',
  tags: ['patient-accounts'],
  security: secured,
  request: {
    headers: tenantHeaders,
    query: z.object({
      status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED']).optional(),
      ...cursorQuery,
    }),
  },
  responses: { 200: ok(PatientAccountListResponse, 'Accounts (patient_account.manage)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/patient-accounts/{id}/verify',
  operationId: 'verifyPatientAccount',
  tags: ['patient-accounts'],
  security: secured,
  request: {
    headers: tenantIdemHeaders,
    params: idParam,
    body: { content: json(VerifyPatientAccountRequest) },
  },
  responses: { 200: ok(PatientAccount, 'ACTIVE'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/patient-accounts/{id}/revoke',
  operationId: 'revokePatientAccount',
  tags: ['patient-accounts'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(RowVersionRequest) } },
  responses: { 200: ok(PatientAccount, 'REVOKED'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/patients/{id}/guardianships',
  operationId: 'requestGuardianship',
  tags: ['guardianships'],
  security: secured,
  description:
    'Patient user (X-Tenant-ID, no patient context needed) or staff. Always PENDING until staff activate it.',
  request: {
    headers: tenantIdemHeaders,
    params: idParam,
    body: { content: json(RequestGuardianshipRequest) },
  },
  responses: { 201: ok(Guardianship, 'PENDING'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/patients/{id}/guardianships',
  operationId: 'listPatientGuardianships',
  tags: ['guardianships'],
  security: secured,
  request: { headers: tenantHeaders, params: idParam },
  responses: {
    200: ok(z.array(Guardianship), 'Guardianships of the dependent (guardianship.manage or patient.read)'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/guardianships',
  operationId: 'listGuardianships',
  tags: ['guardianships'],
  security: secured,
  request: {
    headers: tenantHeaders,
    query: z.object({ status: z.enum(['PENDING', 'ACTIVE', 'ENDED', 'REVOKED']).optional(), ...cursorQuery }),
  },
  responses: { 200: ok(GuardianshipListResponse, 'Guardianships (guardianship.manage)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/guardianships/{id}/activate',
  operationId: 'activateGuardianship',
  tags: ['guardianships'],
  security: secured,
  request: {
    headers: tenantIdemHeaders,
    params: idParam,
    body: { content: json(ActivateGuardianshipRequest) },
  },
  responses: { 200: ok(Guardianship, 'ACTIVE (guardianship.manage, evidence required)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/guardianships/{id}/end',
  operationId: 'endGuardianship',
  tags: ['guardianships'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(EndGuardianshipRequest) } },
  responses: { 200: ok(Guardianship, 'ENDED'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/guardianships/{id}/revoke',
  operationId: 'revokeGuardianship',
  tags: ['guardianships'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(EndGuardianshipRequest) } },
  responses: { 200: ok(Guardianship, 'REVOKED'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/patients/{id}/care-team',
  operationId: 'listCareTeam',
  tags: ['care-team'],
  security: secured,
  request: { headers: tenantHeaders, params: idParam },
  responses: { 200: ok(z.array(CareTeamMember), 'Care team (patient.read)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/patients/{id}/care-team',
  operationId: 'addCareTeamMember',
  tags: ['care-team'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(AddCareTeamMemberRequest) } },
  responses: { 201: ok(CareTeamMember, 'Added (care_team.manage)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/care-team-members/{id}/end',
  operationId: 'endCareTeamMember',
  tags: ['care-team'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(RowVersionRequest) } },
  responses: { 200: ok(CareTeamMember, 'Ended'), ...errorResponses },
});
