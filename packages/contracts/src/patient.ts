import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { bearerAuth, registry, z } from './registry';

// API-IMPLEMENTATION §3.4 (patients, merge cases, consents). Names may be Bangla (NFC); phones are BD mobiles.
export const Sex = z.enum(['FEMALE', 'MALE', 'INTERSEX', 'UNKNOWN']);
export const PatientStatus = z.enum(['ACTIVE', 'MERGED', 'INACTIVE']);
export const ContactType = z.enum(['PHONE', 'EMAIL', 'WHATSAPP']);
export const ContactRelationship = z.enum(['SELF', 'CAREGIVER', 'EMERGENCY']);
export const ConsentPurpose = z.enum([
  'care',
  'in_app',
  'sms',
  'whatsapp',
  'email',
  'telemedicine',
  'ai_assistance',
  'research',
]);
export const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .openapi({ example: '1990-05-01', description: 'Calendar date (no time zone)' });

export const PatientAddress = registry.register(
  'PatientAddress',
  z
    .object({
      line1: z.string().trim().max(200).optional(),
      line2: z.string().trim().max(200).optional(),
      upazila: z.string().trim().max(80).optional(),
      district: z.string().trim().max(80).optional(),
      division: z.string().trim().max(80).optional(),
      postcode: z.string().trim().max(12).optional(),
    })
    .strict(),
);

export const PatientContact = registry.register(
  'PatientContact',
  z.object({
    id: Uuid,
    type: ContactType,
    displayValue: z.string(),
    verificationStatus: z.enum(['UNVERIFIED', 'VERIFIED']),
    isPreferred: z.boolean(),
    relationship: ContactRelationship,
    status: z.enum(['ACTIVE', 'INACTIVE']),
    rowVersion: z.number().int(),
  }),
);

export const Patient = registry.register(
  'Patient',
  z.object({
    id: Uuid,
    medicalRecordNumber: z.string(),
    legalName: z.string(),
    legalNameBn: z.string().nullable(),
    displayName: z.string(),
    dateOfBirth: LocalDate.nullable(),
    birthYear: z.number().int().nullable(),
    sex: Sex.nullable(),
    genderIdentity: z.string().nullable(),
    address: PatientAddress.nullable(),
    preferredLocale: z.enum(['bn-BD', 'en-BD']).nullable(),
    status: PatientStatus,
    mergedIntoPatientId: Uuid.nullable(),
    contacts: z.array(PatientContact),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);

/** Minimum-necessary search row (API §3.4 `SearchPatients`). */
export const PatientSummary = registry.register(
  'PatientSummary',
  z.object({
    id: Uuid,
    medicalRecordNumber: z.string(),
    displayName: z.string(),
    legalName: z.string(),
    legalNameBn: z.string().nullable(),
    sex: Sex.nullable(),
    birthYear: z.number().int().nullable(),
    phoneMasked: z.string().nullable(),
    status: PatientStatus,
  }),
);

const ContactInput = z.object({
  type: ContactType,
  value: z.string().trim().min(3).max(254),
  relationship: ContactRelationship.default('SELF'),
  isPreferred: z.boolean().default(false),
});

const Demographics = {
  legalName: z.string().trim().min(2).max(200),
  legalNameBn: z.string().trim().min(1).max(200).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  dateOfBirth: LocalDate.optional(),
  birthYear: z.number().int().min(1900).max(2100).optional(),
  sex: Sex.optional(),
  genderIdentity: z.string().trim().max(60).optional(),
  address: PatientAddress.optional(),
  preferredLocale: z.enum(['bn-BD', 'en-BD']).optional(),
};

export const DuplicateReview = z
  .object({
    acknowledgedCandidateIds: z.array(Uuid).min(1).max(20),
    reason: z.string().trim().min(3).max(300),
  })
  .openapi('DuplicateReview', {
    description: 'Staff confirmation that the listed candidates are different people (audited)',
  });

export const CreatePatientRequest = registry.register(
  'CreatePatientRequest',
  z
    .object({
      ...Demographics,
      contacts: z.array(ContactInput).min(1).max(10),
      consents: z.array(ConsentPurpose).max(8).default([]),
      duplicateReview: DuplicateReview.optional(),
    })
    .refine((v) => v.contacts.some((c) => c.type === 'PHONE'), {
      message: 'at least one phone contact is required',
      path: ['contacts'],
    }),
);

export const UpdatePatientRequest = registry.register(
  'UpdatePatientRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1),
    ...Object.fromEntries(Object.entries(Demographics).map(([k, s]) => [k, s.optional()])),
    legalNameBn: z.string().trim().max(200).nullable().optional(),
    dateOfBirth: LocalDate.nullable().optional(),
    birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
    address: PatientAddress.nullable().optional(),
    addContacts: z.array(ContactInput).max(10).optional(),
    removeContactIds: z.array(Uuid).max(10).optional(),
  }),
);

export const DuplicateCheckRequest = registry.register(
  'DuplicateCheckRequest',
  z.object({
    legalName: Demographics.legalName,
    legalNameBn: Demographics.legalNameBn,
    phones: z.array(z.string().trim().min(6).max(24)).max(5).default([]),
    dateOfBirth: LocalDate.optional(),
    birthYear: Demographics.birthYear,
    excludePatientId: Uuid.optional(),
  }),
);

export const DuplicateCandidate = registry.register(
  'DuplicateCandidate',
  z.object({
    patient: PatientSummary,
    score: z.number().min(0).max(1),
    reasons: z.array(z.enum(['PHONE_MATCH', 'NAME_MATCH', 'DOB_MATCH', 'DOB_NEAR'])),
  }),
);

export const DuplicateCheckResponse = registry.register(
  'DuplicateCheckResponse',
  z.object({ candidates: z.array(DuplicateCandidate), reviewRequired: z.boolean() }),
);

export const PatientSearchResponse = registry.register(
  'PatientSearchResponse',
  z.object({ items: z.array(PatientSummary), nextCursor: z.string().nullable(), hasMore: z.boolean() }),
);

export const MergeCase = registry.register(
  'MergeCase',
  z.object({
    id: Uuid,
    sourcePatientId: Uuid,
    targetPatientId: Uuid,
    reason: z.string(),
    duplicateScore: z.number().nullable(),
    status: z.enum(['OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'REVERSED']),
    requestedByUserId: Uuid,
    reviewedByUserId: Uuid.nullable(),
    reviewedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);

export const CreateMergeCaseRequest = registry.register(
  'CreateMergeCaseRequest',
  z.object({ targetPatientId: Uuid, reason: z.string().trim().min(3).max(500) }),
);

export const ReviewMergeCaseRequest = registry.register(
  'ReviewMergeCaseRequest',
  z.object({ expectedRowVersion: z.number().int().min(1), reason: z.string().trim().max(500).optional() }),
);

export const MergeCaseListResponse = registry.register(
  'MergeCaseListResponse',
  z.object({ items: z.array(MergeCase), nextCursor: z.string().nullable(), hasMore: z.boolean() }),
);

export const Consent = registry.register(
  'Consent',
  z.object({
    id: Uuid,
    patientId: Uuid,
    purpose: ConsentPurpose,
    status: z.enum(['GRANTED', 'WITHDRAWN']),
    policyVersion: z.number().int(),
    givenByRelationship: z.enum(['SELF', 'GUARDIAN', 'STAFF_RECORDED']),
    capturedAt: Timestamp,
    withdrawnAt: Timestamp.nullable(),
    rowVersion: z.number().int(),
  }),
);

export const GrantConsentRequest = registry.register(
  'GrantConsentRequest',
  z.object({
    purpose: ConsentPurpose,
    policyVersion: z.number().int().min(1).default(1),
    evidenceRef: z.string().trim().max(191).optional(),
  }),
);

export const WithdrawConsentRequest = registry.register(
  'WithdrawConsentRequest',
  z.object({ expectedRowVersion: z.number().int().min(1) }),
);

const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const secured = [{ [bearerAuth.name]: [] }];
const tenantHeaders = z.object({ 'X-Tenant-ID': TenantIdHeader });
const tenantIdemHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'Idempotency-Key': IdempotencyKeyHeader,
});
const PatientContextHeader = Uuid.openapi({ param: { name: 'X-Patient-Context', in: 'header' } });
const tenantOrPatientHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'X-Patient-Context': PatientContextHeader.optional(),
});
const ok = (schema: z.ZodTypeAny, description: string) => ({ description, content: json(envelope(schema)) });
const idParam = z.object({ id: Uuid });
const cursorQuery = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
};

registry.registerPath({
  method: 'get',
  path: '/api/v1/patients',
  operationId: 'searchPatients',
  tags: ['patients'],
  security: secured,
  description:
    'Search by name (Bangla/Banglish/English tokens), phone or MRN. Merged patients are excluded. Bounded, keyset-paginated.',
  request: {
    headers: tenantHeaders,
    query: z.object({
      query: z.string().trim().min(2).max(120).optional(),
      phone: z.string().trim().min(6).max(24).optional(),
      mrn: z.string().trim().min(4).max(32).optional(),
      ...cursorQuery,
    }),
  },
  responses: { 200: ok(PatientSearchResponse, 'Matches (patient.read)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/patients',
  operationId: 'createPatient',
  tags: ['patients'],
  security: secured,
  description:
    '409 DUPLICATE_PATIENT_REVIEW_REQUIRED carries details.candidateIds (comma-separated); repeat with duplicateReview to confirm a new patient.',
  request: { headers: tenantIdemHeaders, body: { content: json(CreatePatientRequest) } },
  responses: { 201: ok(Patient, 'Created (patient.write)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/patients/duplicate-check',
  operationId: 'checkDuplicatePatients',
  tags: ['patients'],
  security: secured,
  request: { headers: tenantHeaders, body: { content: json(DuplicateCheckRequest) } },
  responses: {
    200: ok(DuplicateCheckResponse, 'Candidates with scores (no side effects)'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/patients/{id}',
  operationId: 'getPatient',
  tags: ['patients'],
  security: secured,
  request: { headers: tenantOrPatientHeaders, params: idParam },
  responses: { 200: ok(Patient, 'Patient (patient.read, or own patient context)'), ...errorResponses },
});
registry.registerPath({
  method: 'patch',
  path: '/api/v1/patients/{id}',
  operationId: 'updatePatient',
  tags: ['patients'],
  security: secured,
  request: { headers: tenantHeaders, params: idParam, body: { content: json(UpdatePatientRequest) } },
  responses: { 200: ok(Patient, 'Updated (patient.write)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/patients/{id}/merge-cases',
  operationId: 'createMergeCase',
  tags: ['patients'],
  security: secured,
  description: 'Opens a merge review with {id} as the source (patient.merge). Nothing is merged yet.',
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(CreateMergeCaseRequest) } },
  responses: { 201: ok(MergeCase, 'Opened'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/merge-cases',
  operationId: 'listMergeCases',
  tags: ['patients'],
  security: secured,
  request: {
    headers: tenantHeaders,
    query: z.object({
      status: z.enum(['OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED']).optional(),
      ...cursorQuery,
    }),
  },
  responses: { 200: ok(MergeCaseListResponse, 'Merge cases (patient.merge)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/merge-cases/{id}/approve',
  operationId: 'approveMergeCase',
  tags: ['patients'],
  security: secured,
  description:
    'Re-points appointments and serials to the target, marks the source MERGED with merged_into; audited with every re-pointed id (audit C-47).',
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(ReviewMergeCaseRequest) } },
  responses: { 200: ok(MergeCase, 'Approved'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/merge-cases/{id}/reject',
  operationId: 'rejectMergeCase',
  tags: ['patients'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(ReviewMergeCaseRequest) } },
  responses: { 200: ok(MergeCase, 'Rejected'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/patients/{id}/consents',
  operationId: 'listConsents',
  tags: ['patients'],
  security: secured,
  request: { headers: tenantOrPatientHeaders, params: idParam },
  responses: { 200: ok(z.array(Consent), 'Consents (patient.read or own context)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/patients/{id}/consents',
  operationId: 'grantConsent',
  tags: ['patients'],
  security: secured,
  request: {
    headers: z.object({ ...tenantIdemHeaders.shape, 'X-Patient-Context': PatientContextHeader.optional() }),
    params: idParam,
    body: { content: json(GrantConsentRequest) },
  },
  responses: { 201: ok(Consent, 'Granted (patient.write, or context with GIVE_CONSENT)'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/consents/{id}/withdraw',
  operationId: 'withdrawConsent',
  tags: ['patients'],
  security: secured,
  request: {
    headers: z.object({ ...tenantIdemHeaders.shape, 'X-Patient-Context': PatientContextHeader.optional() }),
    params: idParam,
    body: { content: json(WithdrawConsentRequest) },
  },
  responses: { 200: ok(Consent, 'Withdrawn'), ...errorResponses },
});
