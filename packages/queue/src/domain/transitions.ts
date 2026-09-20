/**
 * Serial state machine (QUEUE-IMPLEMENTATION §3.2, DOMAIN-MODEL §3). The table is the single source of
 * truth for every `(from, command)` edge; the acceptance test enumerates the full matrix. Policy-dependent
 * conditions (recall limit, remote readiness, waiting confirmation) are checked by the service on top.
 */
export type SerialStatus =
  | 'BOOKED'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'WAITING'
  | 'CALLED'
  | 'IN_CONSULTATION'
  | 'SKIPPED'
  | 'NO_SHOW'
  | 'CANCELLED'
  | 'RESCHEDULED'
  | 'COMPLETED';

export type SerialCommand =
  | 'confirm'
  | 'check_in'
  | 'mark_waiting'
  | 'call'
  | 'skip'
  | 'recall'
  | 'no_show'
  | 'cancel'
  | 'reschedule'
  | 'start_consultation'
  | 'complete';

export const SERIAL_STATUSES: readonly SerialStatus[] = [
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'WAITING',
  'CALLED',
  'IN_CONSULTATION',
  'SKIPPED',
  'NO_SHOW',
  'CANCELLED',
  'RESCHEDULED',
  'COMPLETED',
];

export const SERIAL_COMMANDS: readonly SerialCommand[] = [
  'confirm',
  'check_in',
  'mark_waiting',
  'call',
  'skip',
  'recall',
  'no_show',
  'cancel',
  'reschedule',
  'start_consultation',
  'complete',
];

export const SERIAL_TRANSITIONS: Readonly<
  Record<SerialStatus, Partial<Record<SerialCommand, SerialStatus>>>
> = {
  BOOKED: {
    confirm: 'CONFIRMED',
    check_in: 'CHECKED_IN',
    no_show: 'NO_SHOW',
    cancel: 'CANCELLED',
    reschedule: 'RESCHEDULED',
  },
  CONFIRMED: { check_in: 'CHECKED_IN', no_show: 'NO_SHOW', cancel: 'CANCELLED', reschedule: 'RESCHEDULED' },
  CHECKED_IN: { mark_waiting: 'WAITING', call: 'CALLED', no_show: 'NO_SHOW', cancel: 'CANCELLED' },
  WAITING: { call: 'CALLED', no_show: 'NO_SHOW', cancel: 'CANCELLED' },
  CALLED: { start_consultation: 'IN_CONSULTATION', skip: 'SKIPPED', no_show: 'NO_SHOW', cancel: 'CANCELLED' },
  SKIPPED: { recall: 'CALLED', no_show: 'NO_SHOW', cancel: 'CANCELLED' },
  IN_CONSULTATION: { complete: 'COMPLETED', cancel: 'CANCELLED' },
  NO_SHOW: {},
  CANCELLED: {},
  RESCHEDULED: {},
  COMPLETED: {},
};

export const TERMINAL_STATUSES: ReadonlySet<SerialStatus> = new Set([
  'NO_SHOW',
  'CANCELLED',
  'RESCHEDULED',
  'COMPLETED',
]);

/** Statuses that hold a `queue_position` (QUEUE §3). */
export const QUEUE_ACTIVE_STATUSES: ReadonlySet<SerialStatus> = new Set([
  'CHECKED_IN',
  'WAITING',
  'CALLED',
  'IN_CONSULTATION',
  'SKIPPED',
]);

/** Statuses guarded by `uq_serials_active_patient_day` (one per patient and day unless overridden). */
export const DUPLICATE_GUARDED_STATUSES: ReadonlySet<SerialStatus> = new Set([
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'WAITING',
  'CALLED',
  'SKIPPED',
  'IN_CONSULTATION',
]);

/** Statuses a patient context may cancel from (QUEUE §1 CancelSerial). */
export const PATIENT_CANCELLABLE: ReadonlySet<SerialStatus> = new Set(['BOOKED', 'CONFIRMED']);

/** Target of `(from, command)` or null when the edge is absent (→ INVALID_TRANSITION). */
export function serialTransition(from: SerialStatus, command: SerialCommand): SerialStatus | null {
  return SERIAL_TRANSITIONS[from][command] ?? null;
}

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status as SerialStatus);
}

/** Queue event type recorded for a transition target (QUEUE §3.2 side effects). */
export function eventForTransition(command: SerialCommand): string {
  switch (command) {
    case 'confirm':
      return 'CONFIRMED';
    case 'check_in':
      return 'CHECKED_IN';
    case 'mark_waiting':
      return 'WAITING';
    case 'call':
      return 'CALLED';
    case 'skip':
      return 'SKIPPED';
    case 'recall':
      return 'RECALLED';
    case 'no_show':
      return 'NO_SHOW';
    case 'cancel':
      return 'CANCELLED';
    case 'reschedule':
      return 'RESCHEDULED';
    case 'start_consultation':
      return 'CONSULTATION_STARTED';
    case 'complete':
      return 'COMPLETED';
  }
}
