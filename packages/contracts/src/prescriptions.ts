import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { bearerAuth, registry, z } from './registry';

// API-IMPLEMENTATION §3.8 (medication catalog), ADR-020. Two surfaces that share a table and nothing
// else: the platform-operator import controls, and the read-only catalog search a prescriber uses.

const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const secured = [{ [bearerAuth.name]: [] }];
const ok = (schema: z.ZodTypeAny, description: string) => ({ description, content: json(envelope(schema)) });
const tenantHeaders = z.object({ 'X-Tenant-ID': TenantIdHeader });
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
