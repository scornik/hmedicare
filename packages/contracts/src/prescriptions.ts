import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { bearerAuth, registry, z } from './registry';

// API-IMPLEMENTATION §3.8 (medication catalog), ADR-020. Two surfaces that share a table and nothing
// else: the platform-operator import controls, and the read-only catalog search a prescriber uses.

const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const secured = [{ [bearerAuth.name]: [] }];
const ok = (schema: z.ZodTypeAny, description: string) => ({ description, content: json(envelope(schema)) });
const tenantHeaders = z.object({ 'X-Tenant-ID': TenantIdHeader });
const tenantIdemHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'Idempotency-Key': IdempotencyKeyHeader,
});
const operatorHeaders = z.object({ 'X-Platform-Context': z.literal('operator') });
const operatorIdemHeaders = z.object({
  'X-Platform-Context': z.literal('operator'),
  'Idempotency-Key': IdempotencyKeyHeader,
});

/** A plain version name, because it becomes a directory under the dataset storage prefix. */
export const DatasetVersion = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  .openapi({ example: 'medicine-dataset-20260917-4' });

export const MedicationGateCode = z.enum([
  'LEGAL_SOURCE_REVIEW',
  'CLINICAL_SAMPLE_REVIEW',
  'DGDA_CROSS_REFERENCE',
  'IMPORT_SAFEGUARDS_VERIFIED',
]);

export const MedicationImportStatus = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'REFUSED']);

// ---------------------------------------------------------------- import administration

export const RequestMedicationImportRequest = registry.register(
  'RequestMedicationImportRequest',
  z.object({
    datasetVersion: DatasetVersion,
    dryRun: z.boolean().optional().openapi({
      description: 'Verify and count without writing a single catalog row',
    }),
    excludeVeterinary: z.boolean().optional().openapi({
      description: 'Defaults to true. Veterinary products are not offered to a human prescriber',
    }),
  }),
);

export const RequestMedicationImportResponse = registry.register(
  'RequestMedicationImportResponse',
  z.object({
    jobId: Uuid,
    created: z.boolean().openapi({
      description: 'False when this request was already queued; the existing job is returned',
    }),
    datasetVersion: DatasetVersion,
  }),
);

export const MedicationImport = registry.register(
  'MedicationImport',
  z.object({
    importId: Uuid,
    datasetVersion: DatasetVersion,
    datasetStatus: z.string().openapi({
      description: "The dataset's own review status, read from its records. UNVERIFIED for Stage M",
    }),
    environment: z.string(),
    executionPath: z.enum(['CLI', 'JOB']),
    status: MedicationImportStatus,
    refusalReason: z.string().nullable().openapi({
      description: 'MEDDATA_PRODUCTION_GATES_OPEN when production gates are not all attested',
    }),
    requestedBy: z.string().openapi({ description: 'Operator user id, or the CLI operating-system user' }),
    counts: z.record(z.string(), z.unknown()).openapi({
      description: 'Totals and a per-file breakdown: read, inserted, updated, unchanged, rejected, skipped',
    }),
    checkpoint: z
      .object({ file: z.string(), line: z.number().int() })
      .nullable()
      .openapi({ description: 'Where a failed run stopped; a later run resumes from here' }),
    errorClass: z.string().nullable(),
    startedAt: Timestamp.nullable(),
    finishedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  }),
);

export const MedicationImportList = registry.register(
  'MedicationImportList',
  z.object({ items: z.array(MedicationImport) }),
);

export const RecordMedicationGateRequest = registry.register(
  'RecordMedicationGateRequest',
  z.object({
    datasetVersion: DatasetVersion,
    gateCode: MedicationGateCode,
    evidenceRef: z.string().trim().min(1).max(500).openapi({
      description: 'Where the review lives: a document, a ticket, a signed report',
    }),
    summary: z.string().trim().min(1).max(1000).openapi({
      description: 'What was reviewed and what it found — a sample size and an error rate, for example',
    }),
  }),
);

export const MedicationGateStatus = registry.register(
  'MedicationGateStatus',
  z.object({
    datasetVersion: DatasetVersion,
    gates: z.array(
      z.object({
        gateCode: MedicationGateCode,
        attested: z.boolean(),
        recordedAt: Timestamp.nullable(),
        recordedByUserId: Uuid.nullable(),
      }),
    ),
    allAttested: z.boolean().openapi({
      description: 'Production imports are refused until every gate is attested for that exact version',
    }),
  }),
);

export const RecordMedicationGateResponse = registry.register(
  'RecordMedicationGateResponse',
  z.object({
    id: Uuid,
    seq: z.string().openapi({ description: 'Position in the append-only attestation hash chain' }),
  }),
);

// ---------------------------------------------------------------- catalog search

export const MedicationMatchTier = z.enum([
  'EXACT_BRAND',
  'BRAND_PREFIX',
  'BRAND_BN_PREFIX',
  'SOURCE_ALIAS',
  'GENERIC_PREFIX',
  'GENERATED_ALIAS',
]);

export const MedicationSearchItem = registry.register(
  'MedicationSearchItem',
  z.object({
    medicationId: Uuid,
    brandName: z.string(),
    brandNameBn: z.string().nullable(),
    genericDisplay: z.string(),
    strengthText: z.string().nullable(),
    dosageForm: z.string(),
    dosageFormUnmapped: z.boolean().openapi({
      description: 'The dataset could not map this form; the editor badges it rather than hiding it',
    }),
    route: z.string().nullable(),
    manufacturerDisplay: z.string(),
    tier: MedicationMatchTier,
    matchedOn: z.string().nullable().openapi({
      description: 'The alias or generic name that produced the match, so a prescriber sees why',
    }),
    tenantUsageCount: z.number().int(),
    source: z.object({
      datasetVersion: DatasetVersion,
      reviewStatus: z
        .string()
        .openapi({ description: 'UNVERIFIED for the current catalog; shown as a badge' }),
      dgdaMatch: z.string(),
      isSynthetic: z.boolean(),
    }),
  }),
);

export const SearchMedicationsQuery = registry.register(
  'SearchMedicationsQuery',
  z.object({
    q: z.string().trim().min(2).max(100),
    limit: z.coerce.number().int().min(1).max(20).optional(),
  }),
);

export const MedicationSearchResults = registry.register(
  'MedicationSearchResults',
  z.object({ items: z.array(MedicationSearchItem) }),
);

// ---------------------------------------------------------------- paths

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/medications/imports',
  operationId: 'requestMedicationImport',
  tags: ['platform'],
  security: secured,
  description:
    'Queues an import of an already-staged dataset. Platform operators only ' +
    '(X-Platform-Context: operator, medication.import). In production the import is refused unless ' +
    'MEDICATION_IMPORT_PRODUCTION_ALLOWED is true and all four dataset-card gates are attested for that ' +
    'version; the refusal is recorded as an import row naming the missing gates.',
  request: {
    headers: operatorIdemHeaders,
    body: { content: json(RequestMedicationImportRequest) },
  },
  responses: { 202: ok(RequestMedicationImportResponse, 'Import queued'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/medications/imports',
  operationId: 'listMedicationImports',
  tags: ['platform'],
  security: secured,
  description: 'The most recent imports, newest first. Platform operators only.',
  request: {
    headers: operatorHeaders,
    query: z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }),
  },
  responses: { 200: ok(MedicationImportList, 'Imports'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/medications/imports/{id}',
  operationId: 'getMedicationImport',
  tags: ['platform'],
  security: secured,
  description: 'One import, including its counts and its resume checkpoint. Platform operators only.',
  request: { headers: operatorHeaders, params: z.object({ id: Uuid }) },
  responses: { 200: ok(MedicationImport, 'Import'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/medications/gates',
  operationId: 'recordMedicationGate',
  tags: ['platform'],
  security: secured,
  description:
    'Records one dataset-card gate attestation. Append-only and hash-chained: there is no update and no ' +
    'delete, because the value of an attestation is that it cannot be quietly changed afterwards. ' +
    'Platform operators only.',
  request: {
    headers: operatorIdemHeaders,
    body: { content: json(RecordMedicationGateRequest) },
  },
  responses: { 201: ok(RecordMedicationGateResponse, 'Attestation recorded'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/medications/gates/{datasetVersion}',
  operationId: 'getMedicationGateStatus',
  tags: ['platform'],
  security: secured,
  description: 'Which of the four gates a version has and which it is missing. Platform operators only.',
  request: { headers: operatorHeaders, params: z.object({ datasetVersion: DatasetVersion }) },
  responses: { 200: ok(MedicationGateStatus, 'Gate status'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/medications/search',
  operationId: 'searchMedications',
  tags: ['prescriptions'],
  security: secured,
  description:
    'Catalog lookup for the prescription editor. Matches normalized brand, Bangla brand, alias and ' +
    'generic keys and reports which tier produced each match. Inactive rows are excluded and veterinary ' +
    'products were never imported. This is a name lookup: it carries no dose, frequency or duration, and ' +
    'nothing it returns is clinical guidance.',
  request: {
    headers: tenantHeaders,
    query: SearchMedicationsQuery,
  },
  responses: { 200: ok(MedicationSearchResults, 'Matches'), ...errorResponses },
});

// ---------------------------------------------------------------- prescriptions (CP10)

export const PrescriptionClinicalStatus = z.enum(['DRAFT', 'REVIEWED', 'APPROVED', 'VOID']);
export const PrescriptionRenderStatus = z.enum([
  'NOT_REQUESTED',
  'QUEUED',
  'RENDERING',
  'AVAILABLE',
  'FAILED',
]);

export const CatalogItemSnapshot = registry.register(
  'CatalogItemSnapshot',
  z.object({
    brandName: z.string(),
    brandNameBn: z.string().nullable(),
    genericDisplay: z.string(),
    strengthText: z.string().nullable(),
    dosageForm: z.string(),
    manufacturerDisplay: z.string(),
    reviewStatus: z.string(),
    dgdaMatch: z.string(),
  }),
);

/**
 * One prescribed line.
 *
 * `dose`, `frequency` and `duration` are required and always come from the prescriber. The catalog
 * prefills only `strength` and `dosageForm`, and even those stay editable — a product's packaged
 * strength is not automatically the strength being prescribed. Nothing in this API suggests a dose.
 */
export const PrescriptionItemInput = registry.register(
  'PrescriptionItemInput',
  z
    .object({
      sequence: z.number().int().min(1).max(50),
      medicationId: Uuid.nullable().optional(),
      medicationDatasetVersion: DatasetVersion.nullable().optional(),
      catalogSnapshot: CatalogItemSnapshot.nullable().optional(),
      freeTextName: z.string().trim().max(200).nullable().optional(),
      isFreeText: z.boolean(),
      strength: z.string().max(120).nullable().optional(),
      dosageForm: z.string().max(40).nullable().optional(),
      route: z.string().max(24).nullable().optional(),
      dose: z.string().trim().min(1).max(80),
      frequency: z.string().trim().min(1).max(80),
      duration: z.string().trim().min(1).max(80),
      quantity: z.string().max(40).nullable().optional(),
      timing: z.string().max(80).nullable().optional(),
      instructions: z.string().max(500).nullable().optional(),
      instructionsBn: z.string().max(500).nullable().optional(),
      substitutionAllowed: z.boolean().default(true),
    })
    // A line is a catalog selection or free text, never both and never neither. The same rule is a
    // CHECK constraint; this one exists so a prescriber sees which line is wrong.
    .refine((i) => (i.isFreeText ? !i.medicationId && !!i.freeTextName : !!i.medicationId), {
      message: 'an item is either a catalog medication or free text',
      path: ['isFreeText'],
    }),
);

export const PrescriptionItem = registry.register(
  'PrescriptionItem',
  z.object({ id: Uuid }).and(PrescriptionItemInput),
);

export const Prescription = registry.register(
  'Prescription',
  z.object({
    id: Uuid,
    patientId: Uuid,
    encounterId: Uuid,
    doctorProfileId: Uuid,
    revision: z.number().int().openapi({ description: '1, 2, … per encounter; a correction is a new one' }),
    supersedesPrescriptionId: Uuid.nullable(),
    clinicalStatus: PrescriptionClinicalStatus,
    renderStatus: PrescriptionRenderStatus,
    reviewedByUserId: Uuid.nullable(),
    reviewedAt: Timestamp.nullable(),
    approvedByDoctorProfileId: Uuid.nullable(),
    approvedAt: Timestamp.nullable(),
    attestationVersion: z.number().int().nullable(),
    approvedSnapshotSha256: z.string().nullable().openapi({
      description: 'SHA-256 over the header and items at approval; what was approved, provably',
    }),
    voidedByUserId: Uuid.nullable(),
    voidedAt: Timestamp.nullable(),
    voidReason: z.string().nullable(),
    createdAt: Timestamp,
    rowVersion: z.number().int(),
    items: z.array(PrescriptionItem),
  }),
);

export const PrescriptionList = registry.register(
  'PrescriptionList',
  z.object({ items: z.array(Prescription) }),
);

export const EditPrescriptionRequest = registry.register(
  'EditPrescriptionRequest',
  z.object({
    expectedRowVersion: z.number().int(),
    items: z.array(PrescriptionItemInput).max(50).openapi({
      description: 'The whole list. A diff cannot tell "removed" from "not sent"',
    }),
  }),
);

export const ApprovePrescriptionRequest = registry.register(
  'ApprovePrescriptionRequest',
  z.object({
    expectedRowVersion: z.number().int(),
    attestationVersion: z.number().int().openapi({
      description: 'The attestation text the doctor read; a mismatch means reload and read it again',
    }),
  }),
);

export const VoidPrescriptionRequest = registry.register(
  'VoidPrescriptionRequest',
  z.object({
    expectedRowVersion: z.number().int(),
    reason: z.string().trim().min(1).max(500),
    clinicalReviewerDoctorProfileId: Uuid.nullable().optional().openapi({
      description: 'Required when a clinic admin voids (AUTHORIZATION-MATRIX §6)',
    }),
  }),
);

export const PrescriptionRowVersionOnly = registry.register(
  'PrescriptionRowVersionOnly',
  z.object({ expectedRowVersion: z.number().int() }),
);

registry.registerPath({
  method: 'post',
  path: '/api/v1/encounters/{id}/prescriptions',
  operationId: 'createPrescriptionDraft',
  tags: ['prescriptions'],
  security: secured,
  description:
    "The encounter's open draft, created on first use. Assignment only: a prescription carries the " +
    "prescribing doctor's name, so it cannot be brought into being by someone the encounter does not assign.",
  request: { headers: tenantIdemHeaders, params: z.object({ id: Uuid }) },
  responses: { 201: ok(Prescription, 'Draft'), ...errorResponses },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/prescriptions/{id}',
  operationId: 'editPrescriptionDraft',
  tags: ['prescriptions'],
  security: secured,
  description:
    'Replaces the item list. Editing a REVIEWED prescription returns it to DRAFT, because "someone ' +
    'checked these items" stops being true once the items change. APPROVED is refused.',
  request: {
    headers: tenantHeaders,
    params: z.object({ id: Uuid }),
    body: { content: json(EditPrescriptionRequest) },
  },
  responses: { 200: ok(Prescription, 'Updated'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/prescriptions/{id}/review',
  operationId: 'markPrescriptionReviewed',
  tags: ['prescriptions'],
  security: secured,
  description:
    'An optional "items checked" marker with no clinical effect: not final, not visible to patients ' +
    'and not renderable. A nurse holding prescription.review may set it.',
  request: {
    headers: tenantIdemHeaders,
    params: z.object({ id: Uuid }),
    body: { content: json(PrescriptionRowVersionOnly) },
  },
  responses: { 200: ok(Prescription, 'Reviewed'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/prescriptions/{id}/approve',
  operationId: 'approvePrescription',
  tags: ['prescriptions'],
  security: secured,
  description:
    'Final clinical truth, frozen under a content hash. Assigned doctor only. Where this revision ' +
    'supersedes another, the superseded one is voided in the same transaction.',
  request: {
    headers: tenantIdemHeaders,
    params: z.object({ id: Uuid }),
    body: { content: json(ApprovePrescriptionRequest) },
  },
  responses: { 200: ok(Prescription, 'Approved'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/prescriptions/{id}/corrections',
  operationId: 'createPrescriptionCorrection',
  tags: ['prescriptions'],
  security: secured,
  description:
    'Starts revision N+1 carrying a copy of the approved items. The approved revision is untouched ' +
    'until the correction is itself approved, so an abandoned correction changes nothing.',
  request: { headers: tenantIdemHeaders, params: z.object({ id: Uuid }) },
  responses: { 201: ok(Prescription, 'Correction draft'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/prescriptions/{id}/void',
  operationId: 'voidPrescription',
  tags: ['prescriptions'],
  security: secured,
  description: 'Withdraws an approved prescription with a reason. There is no path back.',
  request: {
    headers: tenantIdemHeaders,
    params: z.object({ id: Uuid }),
    body: { content: json(VoidPrescriptionRequest) },
  },
  responses: { 200: ok(Prescription, 'Voided'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/prescriptions/{id}',
  operationId: 'getPrescription',
  tags: ['prescriptions'],
  security: secured,
  request: { headers: tenantHeaders, params: z.object({ id: Uuid }) },
  responses: { 200: ok(Prescription, 'Prescription'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/encounters/{id}/prescriptions',
  operationId: 'listEncounterPrescriptions',
  tags: ['prescriptions'],
  security: secured,
  description: 'Every revision for the encounter, newest first — the history a correction leaves behind.',
  request: { headers: tenantHeaders, params: z.object({ id: Uuid }) },
  responses: { 200: ok(PrescriptionList, 'Revisions'), ...errorResponses },
});

// ---------------------------------------------------------------- render (RX-005)

export const RenderPrescriptionResponse = registry.register(
  'RenderPrescriptionResponse',
  z.object({
    jobId: Uuid,
    renderStatus: z.enum(['NOT_REQUESTED', 'QUEUED', 'RENDERING', 'AVAILABLE', 'FAILED']).openapi({
      description:
        'Stays AVAILABLE when a PDF already exists: a re-render must not take away the current copy',
    }),
    documentId: Uuid.nullable().openapi({ description: 'The document a previous render produced, if any' }),
  }),
);

registry.registerPath({
  method: 'post',
  path: '/api/v1/prescriptions/{id}/render',
  operationId: 'renderPrescription',
  tags: ['prescriptions'],
  security: secured,
  description:
    'Queues a PDF render of an approved (or voided, watermarked) revision. Refused with ' +
    'PRESCRIPTION_NOT_APPROVED for a draft: rendering never makes a prescription final, and a draft PDF ' +
    'could be handed to a patient and then changed. Idempotent — a replay that renders identical bytes ' +
    'changes nothing, and the existing PDF stays downloadable while a re-render is queued.',
  request: { headers: tenantIdemHeaders, params: z.object({ id: Uuid }) },
  responses: { 202: ok(RenderPrescriptionResponse, 'Render queued'), ...errorResponses },
});
