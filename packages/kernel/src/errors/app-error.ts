import { type ErrorCode, httpStatusFor } from './codes';

export interface FieldError {
  path: string;
  code: string;
  message: string;
}

export interface AppErrorOptions {
  /** Safe, non-PHI details (e.g. `{ reason: 'SMS_HTTP_GATE_OPEN' }`). Never secrets or personal data. */
  details?: Record<string, string | number | boolean | null>;
  fieldErrors?: FieldError[];
  retryAfterSeconds?: number;
  cause?: unknown;
}

/**
 * Typed application error. The message is a safe, localizable key (never PHI);
 * HTTP mapping is derived from the canonical code table.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: AppErrorOptions['details'];
  readonly fieldErrors: FieldError[] | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ErrorCode, message?: string, options: AppErrorOptions = {}) {
    super(message ?? code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = httpStatusFor(code);
    this.details = options.details;
    this.fieldErrors = options.fieldErrors;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
