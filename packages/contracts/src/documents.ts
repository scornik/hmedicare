import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { bearerAuth, registry, z } from './registry';

/**
 * Stored documents (API §3.8, FILE-STORAGE-IMPLEMENTATION.md §2.5).
 *
 * A clinical file is never reachable by URL alone — authorization happens when a token is issued, and the token
 * carries the actor, the document and the revision it was issued for.
 */
const secured = [{ [bearerAuth.name]: [] }];
const tenantHeaders = z.object({ 'X-Tenant-ID': TenantIdHeader });
const tenantIdemHeaders = z.object({
  'X-Tenant-ID': TenantIdHeader,
  'Idempotency-Key': IdempotencyKeyHeader,
});
const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });
const ok = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description,
  content: json(envelope(schema)),
});

export const DownloadTokenResponse = registry.register(
  'DownloadTokenResponse',
  z.object({
    token: z.string().openapi({ description: 'Single use, short lived, bound to this actor and revision' }),
    expiresAt: Timestamp,
    revision: z.number().int().openapi({
      description: 'The revision this token serves; a later revision needs a new token',
    }),
  }),
);

export const EncounterDocumentList = registry.register(
  'EncounterDocumentList',
  z.object({
    items: z.array(
      z.object({
        id: Uuid,
        category: z.string(),
        title: z.string().nullable(),
        createdAt: Timestamp,
      }),
    ),
    page: z.number().int().positive(),
    hasMore: z.boolean(),
  }),
);

const UploadRequest = registry.register(
  'DocumentUploadRequest',
  z.object({
    patientId: Uuid,
    encounterId: Uuid,
    category: z.enum(['LAB_REPORT', 'IMAGE', 'REFERRAL', 'OTHER']),
    contentType: z.string(),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    fileName: z.string().optional(),
  }),
);
const UploadSession = registry.register(
  'DocumentUploadSession',
  z.object({
    documentId: Uuid,
    sessionId: Uuid,
    mode: z.literal('proxied'),
    partSizeBytes: z.number().int(),
    partCount: z.number().int(),
    expiresAt: Timestamp,
  }),
);
const uploadParams = z.object({ sessionId: Uuid });

registry.registerPath({
  method: 'post',
  path: '/api/v1/documents/upload-sessions',
  operationId: 'createDocumentUploadSession',
  tags: ['documents'],
  security: secured,
  description: 'Create a staff-owned upload for an authorized encounter.',
  request: { headers: tenantIdemHeaders, body: { content: json(UploadRequest) } },
  responses: { 201: ok(UploadSession, 'Upload session created'), ...errorResponses },
});
registry.registerPath({
  method: 'put',
  path: '/api/v1/documents/upload-sessions/{sessionId}/parts/{partNumber}',
  operationId: 'uploadDocumentPart',
  tags: ['documents'],
  security: secured,
  request: {
    headers: tenantHeaders.extend({ 'X-Part-SHA256': z.string().regex(/^[a-f0-9]{64}$/) }),
    params: uploadParams.extend({ partNumber: z.coerce.number().int().positive() }),
    body: { content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } } },
  },
  responses: {
    200: ok(
      z.object({ partNumber: z.number().int(), sizeBytes: z.number().int(), sha256: z.string() }),
      'Part accepted',
    ),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/documents/upload-sessions/{sessionId}/finalize',
  operationId: 'finalizeDocumentUpload',
  tags: ['documents'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: uploadParams },
  responses: {
    201: ok(z.object({ documentId: Uuid, versionId: Uuid }), 'Queued for scanning'),
    ...errorResponses,
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/documents/upload-sessions/{sessionId}/abort',
  operationId: 'abortDocumentUpload',
  tags: ['documents'],
  security: secured,
  request: { headers: tenantIdemHeaders, params: uploadParams },
  responses: {
    201: ok(z.object({ sessionId: Uuid, status: z.literal('ABORTED') }), 'Upload aborted'),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/documents/by-encounter/{encounterId}',
  operationId: 'listEncounterDocuments',
  tags: ['documents'],
  security: secured,
  description:
    'Lists available clinical documents for an authorized encounter. Audit-only, redacted and mismatched-patient records are excluded.',
  request: {
    headers: tenantHeaders,
    params: z.object({ encounterId: Uuid }),
    query: z.object({ page: z.coerce.number().int().min(1).max(1000).optional() }),
  },
  responses: { 200: ok(EncounterDocumentList, 'Available encounter documents'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/documents/{id}/download-token',
  operationId: 'createDocumentDownloadToken',
  tags: ['documents'],
  security: secured,
  description:
    'Re-checks authorization and returns a single-use token for the current revision. Refused with ' +
    'DOCUMENT_NOT_AVAILABLE unless the document is AVAILABLE.',
  request: { headers: tenantIdemHeaders, params: z.object({ id: Uuid }) },
  responses: { 201: ok(DownloadTokenResponse, 'Token issued'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/documents/{id}/download',
  operationId: 'downloadDocument',
  tags: ['documents'],
  security: secured,
  description:
    'Streams the revision the token was issued for. The token is spent on use, so a saved link does ' +
    'not work twice, and every rejection answers identically so a caller cannot probe for a valid one.',
  request: {
    headers: tenantHeaders,
    params: z.object({ id: Uuid }),
    query: z.object({ token: z.string().min(1) }),
  },
  responses: {
    200: {
      description: 'The document bytes, as an attachment',
      content: { 'application/pdf': { schema: z.string().openapi({ format: 'binary' }) } },
    },
    ...errorResponses,
  },
});
