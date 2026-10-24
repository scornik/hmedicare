import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { bearerAuth, registry, z } from './registry';

const secured = [{ [bearerAuth.name]: [] }];
const headers = z.object({ 'X-Tenant-ID': TenantIdHeader });
const idemHeaders = headers.extend({ 'Idempotency-Key': IdempotencyKeyHeader });
const patientHeaders = headers.extend({ 'X-Patient-Context': Uuid });
const ok = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema: envelope(schema) } },
});
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const params = z.object({ id: Uuid });

export const LabReportView = registry.register(
  'LabReportView',
  z.object({
    id: Uuid,
    documentId: Uuid,
    patientId: Uuid,
    encounterId: Uuid.nullable(),
    labName: z.string().nullable(),
    reportDate: day.nullable(),
    reviewStatus: z.enum(['UNREVIEWED', 'REVIEWED', 'ENTERED_IN_ERROR']),
    reviewedAt: Timestamp.nullable(),
    rowVersion: z.number().int().positive(),
    patientShared: z.boolean(),
  }),
);
export const LabResultView = registry.register(
  'LabResultView',
  z.object({
    id: Uuid,
    analyteDisplay: z.string(),
    valueNumeric: z.string().nullable(),
    valueText: z.string().nullable(),
    unit: z.string().nullable(),
    referenceRange: z.string().nullable(),
    abnormalFlag: z.enum(['LOW', 'HIGH', 'CRITICAL', 'NORMAL']).nullable(),
    reviewStatus: z.enum(['UNREVIEWED', 'REVIEWED', 'ENTERED_IN_ERROR']),
  }),
);

registry.registerPath({
  method: 'post',
  path: '/api/v1/lab-reports',
  operationId: 'createLabReport',
  tags: ['labs'],
  security: secured,
  description: 'Attach structured lab metadata only to an AVAILABLE LAB_REPORT document.',
  request: {
    headers: idemHeaders,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            documentId: Uuid,
            labName: z.string().nullable().optional(),
            reportDate: day.nullable().optional(),
          }),
        },
      },
    },
  },
  responses: { 201: ok(LabReportView, 'Lab report created'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/lab-reports/by-encounter/{encounterId}',
  operationId: 'listEncounterLabReports',
  tags: ['labs'],
  security: secured,
  request: { headers, params: z.object({ encounterId: Uuid }) },
  responses: {
    200: ok(z.object({ items: z.array(LabReportView) }), 'Encounter lab reports'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/lab-reports/{id}',
  operationId: 'getLabReport',
  tags: ['labs'],
  security: secured,
  request: { headers, params },
  responses: {
    200: ok(LabReportView.extend({ results: z.array(LabResultView) }), 'Lab report and results'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/lab-reports/{id}/results',
  operationId: 'recordLabResult',
  tags: ['labs'],
  security: secured,
  request: {
    headers: idemHeaders,
    params,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            expectedRowVersion: z.number().int().positive(),
            analyteDisplay: z.string(),
            valueNumeric: z.string().nullable().optional(),
            valueText: z.string().nullable().optional(),
            unit: z.string().nullable().optional(),
            referenceRange: z.string().nullable().optional(),
            abnormalFlag: z.enum(['LOW', 'HIGH', 'CRITICAL', 'NORMAL']).nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: ok(z.object({ id: Uuid, reportId: Uuid, reviewStatus: z.literal('UNREVIEWED') }), 'Result recorded'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/lab-reports/{id}/review',
  operationId: 'reviewLabReport',
  tags: ['labs'],
  security: secured,
  request: {
    headers: idemHeaders,
    params,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            expectedRowVersion: z.number().int().positive(),
            attestedSource: z.literal(true),
          }),
        },
      },
    },
  },
  responses: { 200: ok(LabReportView, 'Lab report reviewed'), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/lab-reports/{id}/share',
  operationId: 'shareLabReportWithPatient',
  tags: ['labs'],
  security: secured,
  description: 'Doctor shares a reviewed lab report and its source document with the patient.',
  request: {
    headers: idemHeaders,
    params,
    body: {
      content: {
        'application/json': { schema: z.object({ expectedRowVersion: z.number().int().positive() }) },
      },
    },
  },
  responses: { 200: ok(LabReportView, 'Lab report shared'), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/lab-reports/patient/mine',
  operationId: 'listMyLabReports',
  tags: ['labs'],
  security: secured,
  description: 'Reviewed, explicitly shared lab reports for the active patient context.',
  request: { headers: patientHeaders },
  responses: {
    200: ok(z.object({ items: z.array(LabReportView) }), 'Shared lab reports'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/lab-reports/patient/mine/{id}',
  operationId: 'getMyLabReport',
  tags: ['labs'],
  security: secured,
  request: { headers: patientHeaders, params },
  responses: {
    200: ok(LabReportView.extend({ results: z.array(LabResultView) }), 'Shared lab report'),
    ...errorResponses,
  },
});
