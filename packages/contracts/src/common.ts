import type { ZodTypeAny } from 'zod';
import { registry, z } from './registry';

/** Error codes (mirrors `@hmedic/kernel` ERROR_CODES; parity is tested). */
export const ERROR_CODE_VALUES = [
  'UNAUTHENTICATED',
  'SESSION_REVOKED',
  'FORBIDDEN',
  'CSRF_FAILED',
  'TENANT_CONTEXT_REQUIRED',
  'PATIENT_CONTEXT_REQUIRED',
  'RESOURCE_NOT_FOUND',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_REPLAY',
  'IDEMPOTENCY_IN_PROGRESS',
  'IDEMPOTENCY_KEY_REUSED',
  'STALE_VERSION',
  'QUEUE_STATE_CONFLICT',
  'QUEUE_VERSION_CONFLICT',
  'QUEUE_BUSY',
  'CONCURRENCY_RETRY_EXHAUSTED',
  'INVALID_TRANSITION',
  'DUPLICATE_ACTIVE_SERIAL',
  'RECALL_LIMIT_REACHED',
  'CHAMBER_DAY_CLOSED',
  'CHAMBER_DAY_HAS_ACTIVE_CONSULTATION',
  'CAPACITY_EXCEEDED',
  'DUPLICATE_PATIENT_REVIEW_REQUIRED',
  'PRESCRIPTION_NOT_APPROVED',
  'PRESCRIPTION_NOT_EDITABLE',
  'UPLOAD_EXPIRED',
  'CHECKSUM_MISMATCH',
  'CONTENT_TYPE_NOT_ALLOWED',
  'PAYLOAD_TOO_LARGE',
  'DOCUMENT_NOT_AVAILABLE',
  'DOWNLOAD_TOKEN_INVALID',
  'PROVIDER_UNAVAILABLE',
  'FEATURE_DISABLED',
  'AI_REVIEW_REQUIRED',
  'AI_DRAFT_CLOSED',
  'AI_CONSENT_REQUIRED',
  'AI_ACK_VERSION_OUTDATED',
  'AI_CREDENTIAL_DUPLICATE',
  'AI_CREDENTIAL_REVOKED',
  'INVALID_CREDENTIAL',
  'QUOTA_EXHAUSTED',
  'MODEL_UNAVAILABLE',
  'CONTENT_BLOCKED',
  'SCHEMA_INVALID',
  'TIMEOUT',
  'PROVIDER_ERROR',
  'PHI_MINIMIZATION_FAILED',
  'POLICY_BLOCKED',
  'PAYMENT_NOT_REQUIRED',
  'FEE_NOT_CONFIGURED',
  'PAYMENT_METHOD_UNAVAILABLE',
  'PAYMENT_ALREADY_PAID',
  'PAYMENT_INTENT_EXPIRED',
  'PAYMENT_GATEWAY_REJECTED',
  'PAYMENT_GATEWAY_UNAVAILABLE',
  'MERCHANT_CREDENTIAL_INVALID',
  'REFUND_NOT_ALLOWED',
  'SMS_CREDENTIAL_INVALID',
  'MEDDATA_CHECKSUM_MISMATCH',
  'MEDDATA_SCHEMA_UNSUPPORTED',
  'MEDDATA_IMPORT_IN_PROGRESS',
  'PLATFORM_CONTEXT_REQUIRED',
  'DATA_INTEGRITY_ERROR',
  'INTERNAL_ERROR',
] as const;

export const ErrorCode = z.enum(ERROR_CODE_VALUES).openapi('ErrorCode');

export const Uuid = z.string().uuid().openapi({ example: '01a0b422-fd6f-7480-8586-444e7fc66080' });
export const Timestamp = z
  .string()
  .datetime({ offset: false })
  .openapi({ example: '2026-09-18T10:49:42.206Z' });

export const FieldError = z
  .object({ path: z.string(), code: z.string(), message: z.string() })
  .openapi('FieldError');

export const ProblemDetails = registry.register(
  'ProblemDetails',
  z
    .object({
      code: ErrorCode,
      message: z.string().openapi({ description: 'Safe, localizable message key (never PHI)' }),
      requestId: Uuid,
      fieldErrors: z.array(FieldError).optional(),
      retryAfterSeconds: z.number().int().min(0).optional(),
      details: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    })
    .openapi({ description: 'Error body for every non-2xx response (API-IMPLEMENTATION §1)' }),
);

export const ResponseMeta = registry.register(
  'ResponseMeta',
  z.object({
    requestId: Uuid,
    replayed: z
      .boolean()
      .optional()
      .openapi({ description: 'true when this response is an idempotent replay' }),
  }),
);

/** `{ data, meta }` success envelope. */
export function envelope<T extends ZodTypeAny>(data: T) {
  return z.object({ data, meta: ResponseMeta });
}

export const Money = z
  .string()
  .regex(/^\d{1,10}\.\d{2}$/)
  .openapi({ description: 'BDT decimal string (never a number)', example: '500.00' });

export const IdempotencyKeyHeader = z
  .string()
  .regex(/^[A-Za-z0-9_\-:.]{8,191}$/)
  .openapi({
    param: { name: 'Idempotency-Key', in: 'header' },
    example: '01a0b422-fd6f-7480-8586-444e7fc66081',
  });

export const TenantIdHeader = Uuid.openapi({ param: { name: 'X-Tenant-ID', in: 'header' } });

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: ProblemDetails } },
});

/** Standard error responses attached to every operation. */
export const errorResponses = {
  400: problem('Validation failed'),
  401: problem('Not authenticated'),
  403: problem('Forbidden'),
  404: problem('Not found'),
  409: problem('Conflict'),
  422: problem('Unprocessable (e.g. Idempotency-Key reused with another body)'),
  429: problem('Rate limited (see Retry-After)'),
  500: problem('Internal error'),
} as const;
