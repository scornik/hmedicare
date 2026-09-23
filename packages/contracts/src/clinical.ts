import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { bearerAuth, registry, z } from './registry';

// API-IMPLEMENTATION §3.7 (notes, diagnoses, symptoms). Stage 6 CLIN-003 and CLIN-004.
//
// Everything here is written by a doctor and read by one. Patients see nothing clinical in this stage,
// and no route below is reachable from a patient context.

/** The documented section set. No others are accepted, and none is mandatory on its own. */
export const NoteSections = z.object({
  chiefComplaint: z.string().max(20_000).nullable().optional(),
  history: z.string().max(20_000).nullable().optional(),
  examination: z.string().max(20_000).nullable().optional(),
  assessment: z.string().max(20_000).nullable().optional(),
  plan: z.string().max(20_000).nullable().optional(),
});

export const NoteSectionSource = registry.register(
  'NoteSectionSource',
  z.object({
    section: z.enum(['chiefComplaint', 'history', 'examination', 'assessment', 'plan']),
    source: z.enum(['doctor', 'nurse', 'ai_approved']).openapi({
      description: '`ai_approved` is Stage 10; no route in this stage can produce it',
    }),
    aiApprovalId: Uuid.optional(),
  }),
);

export const EncounterNoteDraft = registry.register(
  'EncounterNoteDraft',
  z.object({
    id: Uuid,
    encounterId: Uuid,
    authorDoctorProfileId: Uuid,
    status: z.enum(['DRAFT', 'SIGNED_LOCKED']),
    chiefComplaint: z.string().nullable(),
    history: z.string().nullable(),
    examination: z.string().nullable(),
    assessment: z.string().nullable(),
    plan: z.string().nullable(),
    sectionSources: z.array(NoteSectionSource),
    schemaVersion: z.number().int(),
    lastSignedRevision: z.number().int().nullable(),
    updatedAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);

export const EncounterNoteRevision = registry.register(
  'EncounterNoteRevision',
  z.object({
    id: Uuid,
    encounterId: Uuid,
    revision: z.number().int().min(1),
    signedByDoctorProfileId: Uuid,
    signedAt: Timestamp,
    chiefComplaint: z.string().nullable(),
    history: z.string().nullable(),
    examination: z.string().nullable(),
    assessment: z.string().nullable(),
    plan: z.string().nullable(),
    sectionSources: z.array(NoteSectionSource),
    schemaVersion: z.number().int(),
    correctionReason: z.string().nullable(),
    supersedesRevision: z.number().int().nullable(),
    contentSha256: z.string().openapi({
      description:
        'Digest of the frozen sections. Lets a reader prove a revision is the one that was signed ' +
        'without anything outside the record holding a copy of the text',
    }),
  }),
);

export const SaveNoteDraftRequest = registry.register(
  'SaveNoteDraftRequest',
  z.object({
    expectedRowVersion: z
      .number()
      .int()
      .min(1)
      .openapi({
        description:
          "The draft's row version. A stale save is refused with STALE_VERSION and the current version, " +
          'so a second tab never overwrites newer text',
      }),
    sections: NoteSections,
  }),
);

export const SignNoteRequest = registry.register(
  'SignNoteRequest',
  z.object({ expectedRowVersion: z.number().int().min(1) }),
);

export const AmendNoteRequest = registry.register(
  'AmendNoteRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1),
    correctionReason: z.string().trim().min(3).max(500).openapi({
      description: 'Required. A revision after the first explains itself or it is not accepted',
    }),
  }),
);

// ---------------------------------------------------------------- diagnoses

export const DiagnosisCertainty = z.enum(['CONFIRMED', 'PROVISIONAL', 'DIFFERENTIAL']);
export const DiagnosisClinicalStatus = z.enum(['ACTIVE', 'RESOLVED', 'RULED_OUT', 'ENTERED_IN_ERROR']);

export const Diagnosis = registry.register(
  'Diagnosis',
  z.object({
    id: Uuid,
    encounterId: Uuid,
    patientId: Uuid,
    authorDoctorProfileId: Uuid,
    codeSystem: z.string().nullable(),
    code: z.string().nullable(),
    display: z.string(),
    displayBn: z.string().nullable(),
    clinicalStatus: DiagnosisClinicalStatus,
    certainty: DiagnosisCertainty,
    source: z.enum(['doctor', 'ai_approved']).openapi({
      description: 'Always `doctor` in this stage. No code path can produce `ai_approved` before Stage 10',
    }),
    notes: z.string().nullable(),
    voidReason: z.string().nullable(),
    voidedAt: Timestamp.nullable(),
    replacesDiagnosisId: Uuid.nullable(),
    createdAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);

const coding = {
  codeSystem: z.string().trim().max(32).nullable().optional(),
  code: z.string().trim().max(32).nullable().optional(),
};

export const AddDiagnosisRequest = registry.register(
  'AddDiagnosisRequest',
  z.object({
    display: z.string().trim().min(1).max(300),
    displayBn: z.string().trim().max(300).nullable().optional(),
    ...coding,
    clinicalStatus: z.enum(['ACTIVE', 'RESOLVED', 'RULED_OUT']).optional(),
    certainty: DiagnosisCertainty,
    notes: z.string().trim().max(1000).nullable().optional(),
    replacesDiagnosisId: Uuid.nullable().optional().openapi({
      description: 'The voided diagnosis this one corrects, so the replacement reads as a correction',
    }),
  }),
);

export const UpdateDiagnosisRequest = registry.register(
  'UpdateDiagnosisRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1),
    display: z.string().trim().min(1).max(300).optional(),
    displayBn: z.string().trim().max(300).nullable().optional(),
    ...coding,
    clinicalStatus: z.enum(['ACTIVE', 'RESOLVED', 'RULED_OUT']).optional(),
    certainty: DiagnosisCertainty.optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  }),
);

export const VoidDiagnosisRequest = registry.register(
  'VoidDiagnosisRequest',
  z.object({
    expectedRowVersion: z.number().int().min(1),
    reason: z.string().trim().min(3).max(500),
  }),
);

// ---------------------------------------------------------------- symptoms

export const SymptomObservation = registry.register(
  'SymptomObservation',
  z.object({
    id: Uuid,
    encounterId: Uuid,
    patientId: Uuid,
    normalizedCode: z.string().nullable(),
    codeSystem: z.string().nullable(),
    display: z.string(),
    detail: z.string().nullable(),
    onset: z.string().nullable(),
    severity: z.enum(['MILD', 'MODERATE', 'SEVERE', 'UNKNOWN']).nullable(),
    source: z.enum(['PATIENT_REPORTED', 'CLINICIAN_OBSERVED', 'AI_APPROVED']),
    certainty: DiagnosisCertainty,
    status: z.enum(['ACTIVE', 'ENTERED_IN_ERROR']),
    createdAt: Timestamp,
    rowVersion: z.number().int(),
  }),
);

export const AddSymptomRequest = registry.register(
  'AddSymptomRequest',
  z.object({
    display: z.string().trim().min(1).max(200),
    detail: z.string().trim().max(1000).nullable().optional(),
    onset: z.string().trim().max(80).nullable().optional(),
    severity: z.enum(['MILD', 'MODERATE', 'SEVERE', 'UNKNOWN']).nullable().optional(),
    source: z.enum(['PATIENT_REPORTED', 'CLINICIAN_OBSERVED']).openapi({
      description: 'Who it came from. `AI_APPROVED` exists in the model and no route can set it',
    }),
    certainty: DiagnosisCertainty,
    codeSystem: z.string().trim().max(32).nullable().optional(),
    normalizedCode: z.string().trim().max(64).nullable().optional(),
  }),
);

// ---------------------------------------------------------------- paths

const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const secured = [{ [bearerAuth.name]: [] }];
const tenantHeaders = z.object({ 'X-Tenant-ID': TenantIdHeader });
const tenantIdemHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'Idempotency-Key': IdempotencyKeyHeader,
});
const ok = (schema: z.ZodTypeAny, description: string) => ({ description, content: json(envelope(schema)) });
const idParam = z.object({ id: Uuid });

registry.registerPath({
  method: 'get',
  path: '/api/v1/encounters/{id}/note',
  operationId: 'getEncounterNote',
  tags: ['encounters'],
  security: secured,
  request: { headers: tenantHeaders, params: idParam },
  responses: {
    200: ok(
      EncounterNoteDraft,
      'The working draft (`encounter.read` + assignment). The read is audited as a PHI access; the audit ' +
        'row carries identifiers only, never the text',
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/encounters/{id}/note',
  operationId: 'saveEncounterNoteDraft',
  tags: ['encounters'],
  security: secured,
  request: { headers: tenantHeaders, params: idParam, body: { content: json(SaveNoteDraftRequest) } },
  responses: {
    200: ok(
      EncounterNoteDraft,
      'Autosave (`note.write` + assignment). Returns the new row version. `STALE_VERSION` when another ' +
        'tab saved first, with the current version attached so the client can offer a choice rather ' +
        'than overwrite. Drafts are not versioned and emit no timeline event',
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/encounters/{id}/note/sign',
  operationId: 'signEncounterNote',
  tags: ['encounters'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(SignNoteRequest) } },
  responses: {
    201: ok(
      EncounterNoteRevision,
      'Freezes the draft into revision 1 (`note.sign` + assignment). The revision is append-only and ' +
        'hash-chained per encounter; nothing updates or deletes it afterwards',
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/encounters/{id}/note/corrections',
  operationId: 'amendEncounterNote',
  tags: ['encounters'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(AmendNoteRequest) } },
  responses: {
    201: ok(
      EncounterNoteRevision,
      'A new signed revision carrying its reason (`note.sign` + assignment). The revision it corrects ' +
        'stays readable — a signed note is never rewritten in place',
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/encounters/{id}/note/revisions',
  operationId: 'listEncounterNoteRevisions',
  tags: ['encounters'],
  security: secured,
  request: { headers: tenantHeaders, params: idParam },
  responses: {
    200: ok(
      z.array(EncounterNoteRevision),
      'Every signed revision, oldest first (`encounter.read` + assignment). Audited as a PHI read',
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/encounters/{id}/diagnoses',
  operationId: 'listEncounterDiagnoses',
  tags: ['encounters'],
  security: secured,
  request: { headers: tenantHeaders, params: idParam },
  responses: {
    200: ok(
      z.array(Diagnosis),
      'Diagnoses on this encounter, including voided ones (`encounter.read` + assignment)',
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/encounters/{id}/diagnoses',
  operationId: 'addEncounterDiagnosis',
  tags: ['encounters'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(AddDiagnosisRequest) } },
  responses: {
    201: ok(
      Diagnosis,
      'Records a diagnosis (`note.write` + assignment). Free text is always allowed; a code is accepted ' +
        'only together with the system that issued it. No code list ships with this stage',
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/diagnoses/{id}',
  operationId: 'updateDiagnosis',
  tags: ['encounters'],
  security: secured,
  request: { headers: tenantHeaders, params: idParam, body: { content: json(UpdateDiagnosisRequest) } },
  responses: {
    200: ok(
      Diagnosis,
      'Edits a diagnosis while the encounter note is unsigned (`note.write` + assignment). Once any ' +
        'revision is signed this answers `INVALID_TRANSITION`: the route out is void plus a replacement',
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/diagnoses/{id}/void',
  operationId: 'voidDiagnosis',
  tags: ['encounters'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(VoidDiagnosisRequest) } },
  responses: {
    200: ok(
      Diagnosis,
      'Withdraws a diagnosis with a reason (`note.write` + assignment). The row stays, marked ' +
        'ENTERED_IN_ERROR and carrying who withdrew it and why',
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/encounters/{id}/symptoms',
  operationId: 'listEncounterSymptoms',
  tags: ['encounters'],
  security: secured,
  request: { headers: tenantHeaders, params: idParam },
  responses: {
    200: ok(
      z.array(SymptomObservation),
      'Symptoms recorded on this encounter (`encounter.read` + assignment)',
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/encounters/{id}/symptoms',
  operationId: 'addEncounterSymptom',
  tags: ['encounters'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: idParam, body: { content: json(AddSymptomRequest) } },
  responses: {
    201: ok(
      SymptomObservation,
      'Records what the patient reported or the doctor observed (`note.write` + assignment)',
    ),
    ...errorResponses,
  },
});
