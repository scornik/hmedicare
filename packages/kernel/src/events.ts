/**
 * Event envelope (EVENT-ARCHITECTURE.md §2). Payloads carry ids, statuses and enums only:
 * no names, phone numbers, clinical text or secrets.
 */
export interface EventEnvelope<TName extends string = string, TPayload = Record<string, unknown>> {
  readonly eventId: string;
  readonly eventName: TName;
  readonly eventVersion: number;
  readonly tenantId: string | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly actorId: string | null;
  readonly idempotencyKey: string | null;
  readonly payload: TPayload;
}

/** Field names that may never appear in job or event payloads (PHI and secret deny-list). */
export const PAYLOAD_DENY_LIST: readonly RegExp[] = [
  /phone/i,
  /email/i,
  /name$/i,
  /^name/i,
  /address/i,
  /password/i,
  /secret/i,
  /token/i,
  /otp/i,
  /^code$/i,
  /api_?key/i,
  /signature/i,
  /note/i,
  /diagnos/i,
  /prescri/i,
  /^message$/i,
  /body$/i,
  /text$/i,
  /dob|birth/i,
  /^nid$|national_?id/i,
];

/** Returns the offending key paths, or [] when the payload is safe (ids/enums/timestamps only). */
export function findDeniedPayloadKeys(payload: unknown, path = ''): string[] {
  if (payload === null || typeof payload !== 'object') return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const p = path ? `${path}.${key}` : key;
    if (PAYLOAD_DENY_LIST.some((re) => re.test(key))) found.push(p);
    found.push(...findDeniedPayloadKeys(value, p));
  }
  return found;
}
