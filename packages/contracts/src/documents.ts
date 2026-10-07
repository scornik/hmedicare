import { IdempotencyKeyHeader, TenantIdHeader, Timestamp, Uuid, envelope, errorResponses } from './common';
import { bearerAuth, registry, z } from './registry';

/**
 * Stored documents (API §3.8, FILE-STORAGE-IMPLEMENTATION.md §2.5).
 *
 * Only the read half exists so far: the upload session routes arrive with the upload path. A clinical
 * file is never reachable by URL alone — authorization happens when a token is issued, and the token
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
