import { addDays } from '@hmedic/localization';
import type { QueuePolicy } from './queue-policy';

/**
 * Booking rules (QUEUE §2 C-44 fields, audit C-45). Pure decisions over policy, chamber facts and counts;
 * the services translate a `BookingRefusal` into the documented error code.
 */
export type CareMode = 'PHYSICAL' | 'REMOTE' | 'HYBRID';
export type ChamberPaymentMode = 'PAY_AT_CHAMBER' | 'PREPAID_REQUIRED' | 'OPTIONAL_ONLINE';
export type TelemedicinePaymentMode = 'PREPAID_REQUIRED' | 'OPTIONAL_ONLINE';

export interface ChamberBookingFacts {
  supportsPhysical: boolean;
  supportsRemote: boolean;
  supportsHybrid: boolean;
  chamberPaymentMode: ChamberPaymentMode;
  telemedicinePaymentMode: TelemedicinePaymentMode;
}

export type BookingRefusal =
  | {
      code: 'VALIDATION_FAILED';
      reason:
        | 'care_mode_unsupported'
        | 'booking_disabled'
        | 'walk_ins_disabled'
        | 'outside_booking_window'
        | 'past_date'
        | 'booking_cutoff_passed'
        | 'day_not_bookable';
    }
  | { code: 'CAPACITY_EXCEEDED'; reason: 'capacity' | 'max_booked_serials' | 'max_walk_ins' | 'slot_full' }
  | { code: 'FEATURE_DISABLED'; reason: 'PAYMENTS_NOT_AVAILABLE' };

export function careModeSupported(chamber: ChamberBookingFacts, careMode: CareMode): boolean {
  return careMode === 'PHYSICAL'
    ? chamber.supportsPhysical
    : careMode === 'REMOTE'
      ? chamber.supportsRemote
      : chamber.supportsHybrid;
}

export interface PaymentTerms {
  requirement: 'NONE' | 'OPTIONAL' | 'PREPAID';
  status: 'NOT_REQUIRED' | 'PENDING';
}

/**
 * Audit C-45: while the payments module is absent, a prepaid-required booking is refused with
 * `FEATURE_DISABLED` (`PAYMENTS_NOT_AVAILABLE`); `OPTIONAL_ONLINE` behaves as pay-at-chamber with an
 * informational `OPTIONAL`/`PENDING` pair. Walk-ins never require payment.
 */
export function paymentTermsFor(
  chamber: ChamberBookingFacts,
  careMode: CareMode,
  paymentsAvailable: boolean,
): PaymentTerms | BookingRefusal {
  const mode: ChamberPaymentMode =
    careMode === 'REMOTE' ? chamber.telemedicinePaymentMode : chamber.chamberPaymentMode;
  if (mode === 'PREPAID_REQUIRED') {
    if (!paymentsAvailable) return { code: 'FEATURE_DISABLED', reason: 'PAYMENTS_NOT_AVAILABLE' };
    return { requirement: 'PREPAID', status: 'PENDING' };
  }
  if (mode === 'OPTIONAL_ONLINE') return { requirement: 'OPTIONAL', status: 'PENDING' };
  return { requirement: 'NONE', status: 'NOT_REQUIRED' };
}

export function isRefusal(v: unknown): v is BookingRefusal {
  return typeof v === 'object' && v !== null && 'code' in v && 'reason' in v;
}

/** The furthest local date bookable from `todayLocal` (chamber time zone); never a past date. */
export function bookingDateRefusal(
  policy: QueuePolicy,
  todayLocal: string,
  targetLocal: string,
): BookingRefusal | null {
  if (targetLocal < todayLocal) return { code: 'VALIDATION_FAILED', reason: 'past_date' };
  if (targetLocal > addDays(todayLocal, policy.bookingWindowDays))
    return { code: 'VALIDATION_FAILED', reason: 'outside_booking_window' };
  return null;
}

/** Booking closes `bookingCutoffMinutes` before the day's local start; staff bookings are exempt. */
export function bookingCutoffPassed(
  policy: QueuePolicy,
  now: Date,
  dayStartUtc: Date,
  staff: boolean,
): boolean {
  if (staff) return false;
  return now.getTime() >= dayStartUtc.getTime() - policy.bookingCutoffMinutes * 60_000;
}

export interface SerialCounts {
  /** Non-cancelled serials of every source on the day. */
  nonCancelled: number;
  /** Non-cancelled advance-booking (incl. follow-up/reschedule) serials. */
  booked: number;
  /** Non-cancelled walk-in serials. */
  walkIns: number;
}

/** Capacity checks for one more serial of `kind` (QUEUE §2: `capacity`, `maxBookedSerials`, `maxWalkIns`). */
export function capacityRefusal(
  policy: QueuePolicy,
  counts: SerialCounts,
  kind: 'booked' | 'walkIn',
): BookingRefusal | null {
  if (policy.capacity !== null && counts.nonCancelled >= policy.capacity)
    return { code: 'CAPACITY_EXCEEDED', reason: 'capacity' };
  if (kind === 'booked' && policy.maxBookedSerials !== null && counts.booked >= policy.maxBookedSerials)
    return { code: 'CAPACITY_EXCEEDED', reason: 'max_booked_serials' };
  if (kind === 'walkIn' && policy.maxWalkIns !== null && counts.walkIns >= policy.maxWalkIns)
    return { code: 'CAPACITY_EXCEEDED', reason: 'max_walk_ins' };
  return null;
}

/** Chamber-day statuses that accept a new advance booking / walk-in. */
export const BOOKABLE_DAY_STATUSES: ReadonlySet<string> = new Set(['SCHEDULED', 'OPEN', 'PAUSED']);
export const WALK_IN_DAY_STATUSES: ReadonlySet<string> = new Set(['OPEN', 'PAUSED']);
