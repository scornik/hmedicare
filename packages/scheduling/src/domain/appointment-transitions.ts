/**
 * Appointment state machine (DATABASE §3.5, DOMAIN-MODEL §3). The appointment is the booking intent; the
 * serial (queue context) carries the visit lifecycle. `PENDING_PAYMENT` exists in the table but is never
 * written while payments are absent (audit C-45); `REQUESTED` is reserved for pending online booking.
 */
export type AppointmentStatus =
  'REQUESTED' | 'PENDING_PAYMENT' | 'BOOKED' | 'CANCELLED' | 'RESCHEDULED' | 'FULFILLED' | 'NO_SHOW';

export type AppointmentCommand =
  'confirm' | 'cancel' | 'reschedule' | 'no_show' | 'fulfil' | 'payment_confirmed';

export const APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentStatus, Partial<Record<AppointmentCommand, AppointmentStatus>>>
> = {
  REQUESTED: { confirm: 'BOOKED', cancel: 'CANCELLED' },
  PENDING_PAYMENT: { payment_confirmed: 'BOOKED', cancel: 'CANCELLED' },
  BOOKED: { cancel: 'CANCELLED', reschedule: 'RESCHEDULED', no_show: 'NO_SHOW', fulfil: 'FULFILLED' },
  CANCELLED: {},
  RESCHEDULED: {},
  FULFILLED: {},
  NO_SHOW: {},
};

export const APPOINTMENT_TERMINAL: ReadonlySet<AppointmentStatus> = new Set([
  'CANCELLED',
  'RESCHEDULED',
  'FULFILLED',
  'NO_SHOW',
]);

/** Target status for `(from, command)` or null when the edge is not in the table. */
export function appointmentTransition(
  from: AppointmentStatus,
  command: AppointmentCommand,
): AppointmentStatus | null {
  return APPOINTMENT_TRANSITIONS[from][command] ?? null;
}

/** Cancel reasons accepted from clients and jobs (`appointments.cancel_reason`, `serials.cancel_reason`). */
export const CANCEL_REASONS = [
  'PATIENT_REQUEST',
  'STAFF_REQUEST',
  'DOCTOR_UNAVAILABLE',
  'DAY_CANCELLED',
  'DAY_CLOSED',
  'DUPLICATE',
  'RESCHEDULED',
  'NO_SHOW_POLICY',
  'PAYMENT_NOT_COMPLETED',
  'OTHER',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
