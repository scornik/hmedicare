/** Handler outcomes that change retry behavior (ADR-015 §3). */
export class NonRetryableJobError extends Error {
  constructor(readonly errorClass: string) {
    super(errorClass);
    this.name = 'NonRetryableJobError';
  }
}

/** Provider rate limit: the job waits until `retryAt` and gives back the attempt it used. */
export class RateLimitedJobError extends Error {
  constructor(readonly retryAt: Date) {
    super('RATE_LIMITED');
    this.name = 'RateLimitedJobError';
  }
}

export class JobPayloadError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid job payload: ${problems.join('; ')}`);
    this.name = 'JobPayloadError';
  }
}

/** Normalized error class for storage/metrics: never a raw provider message. */
export function errorClassOf(error: unknown): string {
  if (error instanceof NonRetryableJobError) return error.errorClass;
  if (error instanceof RateLimitedJobError) return 'RATE_LIMITED';
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code;
    if (/^[A-Z][A-Z0-9_]{2,63}$/.test(code)) return code;
  }
  return 'UNHANDLED_ERROR';
}
