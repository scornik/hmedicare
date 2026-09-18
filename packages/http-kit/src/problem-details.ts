import { HttpException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';
import { AppError, type ErrorCode, type FieldError } from '@hmedic/kernel';

/**
 * ProblemDetails (API-IMPLEMENTATION.md §1): `{code, message, requestId, fieldErrors?, retryAfterSeconds?,
 * details?}`. The message is a safe key, never an exception message from a library or the database.
 */
export interface ProblemBody {
  code: ErrorCode;
  message: string;
  requestId: string;
  fieldErrors?: FieldError[];
  retryAfterSeconds?: number;
  details?: Record<string, string | number | boolean | null>;
}

export interface Problem {
  status: number;
  body: ProblemBody;
  /** True for unexpected errors (logged at error level with the stack). */
  unexpected: boolean;
}

const SAFE_MESSAGE = /^[a-z][a-z0-9_.]*$|^[A-Z][A-Z0-9_]*$/;

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'RESOURCE_NOT_FOUND',
  405: 'RESOURCE_NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'CONTENT_TYPE_NOT_ALLOWED',
  429: 'RATE_LIMITED',
};

export function zodFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((i) => ({
    path: i.path.join('.'),
    code: i.code,
    message: `validation.${i.code}`,
  }));
}

function fromStatus(status: number, requestId: string): Problem {
  const code = STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED');
  const finalStatus = STATUS_CODES[status] ? status : status >= 500 ? 500 : 400;
  return { status: finalStatus, body: { code, message: code, requestId }, unexpected: finalStatus >= 500 };
}

export function toProblem(error: unknown, requestId: string): Problem {
  if (error instanceof AppError) {
    const body: ProblemBody = {
      code: error.code,
      message: SAFE_MESSAGE.test(error.message) ? error.message : error.code,
      requestId,
    };
    if (error.fieldErrors?.length) body.fieldErrors = error.fieldErrors;
    if (error.retryAfterSeconds !== undefined) body.retryAfterSeconds = error.retryAfterSeconds;
    if (error.details) body.details = error.details;
    return { status: error.status, body, unexpected: error.status >= 500 };
  }
  if (error instanceof ZodValidationException) {
    return {
      status: 400,
      body: {
        code: 'VALIDATION_FAILED',
        message: 'VALIDATION_FAILED',
        requestId,
        fieldErrors: zodFieldErrors(error.getZodError() as ZodError),
      },
      unexpected: false,
    };
  }
  if (error instanceof HttpException) return fromStatus(error.getStatus(), requestId);
  // Fastify errors (body parsing, limits) carry `statusCode`.
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    return fromStatus(statusCode, requestId);
  }
  return {
    status: 500,
    body: { code: 'INTERNAL_ERROR', message: 'INTERNAL_ERROR', requestId },
    unexpected: true,
  };
}
