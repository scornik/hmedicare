/**
 * QueuePolicy (QUEUE-IMPLEMENTATION §2, audit C-44): chamber defaults snapshotted onto every chamber day.
 * Every value is a documented default, not a clinical rule. Validation of the wire shape lives in
 * `@hmedic/contracts`; this module owns the defaults, the merge and the invariants between fields.
 */
export type LateArrivalPlacement = 'APPEND' | 'BY_SERIAL_NUMBER';

export type DayCloseStatus = 'BOOKED' | 'CONFIRMED' | 'CHECKED_IN' | 'WAITING' | 'CALLED' | 'SKIPPED';
export type DayCloseDisposition = Record<DayCloseStatus, 'NO_SHOW' | 'CANCELLED'>;

export interface QueuePolicy {
  recallLimit: number;
  recallDeadlineMinutes: number;
  autoSkipOnRecallDeadline: boolean;
  noShowAfterMinutes: number;
  autoNoShowEnabled: boolean;
  waitingRequiresConfirmation: boolean;
  lateArrivalGraceMinutes: number;
  lateArrivalPlacement: LateArrivalPlacement;
  allowRemoteCallWithoutReady: boolean;
  receptionistMayCall: boolean;
  duplicateOverrideRoles: string[];
  dayCloseDisposition: DayCloseDisposition;
  capacity: number | null;
  advanceBookingEnabled: boolean;
  walkInsEnabled: boolean;
  maxBookedSerials: number | null;
  maxWalkIns: number | null;
  bookingWindowDays: number;
  bookingCutoffMinutes: number;
  earlyCheckInMinutes: number;
  avgConsultationMinutes: number;
  slotMinutes: number | null;
  slotCapacity: number;
}

export const DEFAULT_QUEUE_POLICY: Readonly<QueuePolicy> = Object.freeze<QueuePolicy>({
  recallLimit: 2,
  recallDeadlineMinutes: 5,
  autoSkipOnRecallDeadline: true,
  noShowAfterMinutes: 120,
  autoNoShowEnabled: true,
  waitingRequiresConfirmation: false,
  lateArrivalGraceMinutes: 15,
  lateArrivalPlacement: 'APPEND',
  allowRemoteCallWithoutReady: false,
  receptionistMayCall: false,
  duplicateOverrideRoles: ['clinic_admin', 'receptionist'],
  dayCloseDisposition: {
    BOOKED: 'NO_SHOW',
    CONFIRMED: 'NO_SHOW',
    CHECKED_IN: 'CANCELLED',
    WAITING: 'CANCELLED',
    CALLED: 'CANCELLED',
    SKIPPED: 'NO_SHOW',
  },
  capacity: null,
  advanceBookingEnabled: true,
  walkInsEnabled: true,
  maxBookedSerials: null,
  maxWalkIns: null,
  bookingWindowDays: 14,
  bookingCutoffMinutes: 60,
  earlyCheckInMinutes: 60,
  avgConsultationMinutes: 10,
  slotMinutes: null,
  slotCapacity: 1,
});

export type QueuePolicyPatch = Partial<QueuePolicy>;

/** Field-level problems the wire schema cannot express (cross-field invariants). */
export interface PolicyProblem {
  path: string;
  code: string;
}

/**
 * Merges a stored/partial policy over the defaults. Unknown keys are dropped, so a policy JSON written by
 * an older version still resolves to a complete policy.
 */
export function resolveQueuePolicy(partial: unknown): QueuePolicy {
  const src = (partial && typeof partial === 'object' ? partial : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...DEFAULT_QUEUE_POLICY };
  for (const key of Object.keys(DEFAULT_QUEUE_POLICY) as (keyof QueuePolicy)[]) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  out.dayCloseDisposition = {
    ...DEFAULT_QUEUE_POLICY.dayCloseDisposition,
    ...((src.dayCloseDisposition as Partial<DayCloseDisposition> | undefined) ?? {}),
  };
  return out as unknown as QueuePolicy;
}

/** Cross-field invariants (the wire schema already bounds each number). */
export function policyProblems(p: QueuePolicy): PolicyProblem[] {
  const problems: PolicyProblem[] = [];
  if (!p.advanceBookingEnabled && !p.walkInsEnabled) {
    problems.push({ path: 'walkInsEnabled', code: 'no_intake_channel' });
  }
  if (p.capacity !== null) {
    if (p.maxBookedSerials !== null && p.maxBookedSerials > p.capacity)
      problems.push({ path: 'maxBookedSerials', code: 'exceeds_capacity' });
    if (p.maxWalkIns !== null && p.maxWalkIns > p.capacity)
      problems.push({ path: 'maxWalkIns', code: 'exceeds_capacity' });
  }
  if (p.slotMinutes !== null && p.slotMinutes < 5) problems.push({ path: 'slotMinutes', code: 'too_short' });
  return problems;
}
