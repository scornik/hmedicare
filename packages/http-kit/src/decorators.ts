import { SetMetadata } from '@nestjs/common';
import type { RateLimitRule } from '@hmedic/jobs';

export const RAW_RESPONSE = 'hm:raw-response';
export const IDEMPOTENT = 'hm:idempotent';
export const RATE_LIMITS = 'hm:rate-limits';

/** Response is sent as-is (health, metrics): no `{data, meta}` envelope. */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

/**
 * `Idempotency-Key` handling (API-IMPLEMENTATION §1): `required` on POSTs that create or transition
 * state; `optional` on PUT/PATCH/DELETE.
 */
export const Idempotent = (mode: 'required' | 'optional' = 'required') => SetMetadata(IDEMPOTENT, mode);

export interface RouteRateLimit {
  rule: RateLimitRule;
  /** Subject: client IP. Body-keyed limits (phone, device) are enforced inside use cases. */
  by: 'ip';
}

/** DB-backed rate limits evaluated before the handler (429 RATE_LIMITED + Retry-After). */
export const RateLimit = (...limits: RouteRateLimit[]) => SetMetadata(RATE_LIMITS, limits);
