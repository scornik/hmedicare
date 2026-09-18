import { SetMetadata } from '@nestjs/common';
import type { RateLimitRule } from '@hmedic/jobs';

export const RAW_RESPONSE = 'hm:raw-response';
export const IDEMPOTENT = 'hm:idempotent';
export const RATE_LIMITS = 'hm:rate-limits';
export const PUBLIC_ROUTE = 'hm:public';
export const IDEMPOTENT_REPLAY = 'hm:idempotent-replay';

/** No end-user authentication (health, internal-token routes, login/OTP/refresh). Default is deny. */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

/** Response is sent as-is (health, metrics): no `{data, meta}` envelope. */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

/**
 * `Idempotency-Key` handling (API-IMPLEMENTATION §1): `required` on POSTs that create or transition
 * state; `optional` on PUT/PATCH/DELETE.
 */
export const Idempotent =
  (mode: 'required' | 'optional' = 'required', options: { replay?: 'snapshot' | 'refuse' } = {}) =>
  (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(IDEMPOTENT, mode)(target, key as string, descriptor as PropertyDescriptor);
    // `refuse`: credential-issuing routes never store their response (snapshots hold no secrets, audit
    // C-40); a repeat of the same key gets 422 IDEMPOTENCY_KEY_REUSED (`idempotency.not_replayable`).
    SetMetadata(IDEMPOTENT_REPLAY, options.replay ?? 'snapshot')(
      target,
      key as string,
      descriptor as PropertyDescriptor,
    );
  };

export interface RouteRateLimit {
  rule: RateLimitRule;
  /** Subject: client IP. Body-keyed limits (phone, device) are enforced inside use cases. */
  by: 'ip';
}

/** DB-backed rate limits evaluated before the handler (429 RATE_LIMITED + Retry-After). */
export const RateLimit = (...limits: RouteRateLimit[]) => SetMetadata(RATE_LIMITS, limits);
