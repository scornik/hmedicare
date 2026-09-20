import type { QueuePolicy } from '@hmedic/scheduling';
import { QUEUE_ACTIVE_STATUSES, type SerialStatus } from './transitions';

/**
 * Queue position assignment and the patient-facing view (QUEUE-IMPLEMENTATION §4). Pure functions over the
 * rows the service has already locked, so the placement rules are unit-testable without a database.
 *
 * A position is assigned when a serial enters `WAITING` (or `CHECKED_IN` when the policy requires staff
 * confirmation). `CALLED`, `IN_CONSULTATION` and `SKIPPED` keep theirs for history.
 */
export interface QueueRow {
  id: string;
  serialNumber: number;
  queuePosition: number | null;
  status: SerialStatus;
}

export interface Placement {
  /** Position for the arriving serial. */
  position: number;
  /** Serials whose position shifts by +1, in id order (locked before they are written). */
  shifted: Array<{ id: string; from: number; to: number }>;
  /** True when other serials moved, which bumps `queue_order_version` (QUEUE §4.1). */
  reordersOthers: boolean;
}

const activeWithPosition = (rows: readonly QueueRow[]): QueueRow[] =>
  rows.filter((r) => QUEUE_ACTIVE_STATUSES.has(r.status) && r.queuePosition !== null);

/** Appends after every queue-active serial. */
export function appendPlacement(rows: readonly QueueRow[]): Placement {
  const active = activeWithPosition(rows);
  const max = active.reduce((m, r) => Math.max(m, r.queuePosition!), 0);
  return { position: max + 1, shifted: [], reordersOthers: false };
}

/**
 * `BY_SERIAL_NUMBER`: the late arrival goes just after the last queue-active serial with a lower serial
 * number, and everything behind it shifts by one. With no lower-numbered serial it goes to the front.
 */
export function bySerialNumberPlacement(rows: readonly QueueRow[], serialNumber: number): Placement {
  const active = activeWithPosition(rows).sort((a, b) => a.queuePosition! - b.queuePosition!);
  const lower = active.filter((r) => r.serialNumber < serialNumber);
  const position = lower.length ? Math.max(...lower.map((r) => r.queuePosition!)) + 1 : 1;
  const shifted = active
    .filter((r) => r.queuePosition! >= position)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, from: r.queuePosition!, to: r.queuePosition! + 1 }));
  return { position, shifted, reordersOthers: shifted.length > 0 };
}

export interface ArrivalInput {
  rows: readonly QueueRow[];
  serialNumber: number;
  lateArrival: boolean;
  policy: Pick<QueuePolicy, 'lateArrivalPlacement'>;
}

/** Placement for a serial entering the queue (walk-in or check-in). */
export function placementFor(input: ArrivalInput): Placement {
  if (input.lateArrival && input.policy.lateArrivalPlacement === 'BY_SERIAL_NUMBER') {
    return bySerialNumberPlacement(input.rows, input.serialNumber);
  }
  return appendPlacement(input.rows);
}

/**
 * Late arrival (QUEUE §2 `lateArrivalGraceMinutes`): checking in later than the slot start (or the day's
 * local start when there is no slot) plus the grace period, or after a higher serial number was called.
 */
export function isLateArrival(input: {
  now: Date;
  expectedStart: Date;
  graceMinutes: number;
  serialNumber: number;
  rows: readonly QueueRow[];
}): boolean {
  if (input.now.getTime() > input.expectedStart.getTime() + input.graceMinutes * 60_000) return true;
  return input.rows.some(
    (r) => r.serialNumber > input.serialNumber && (r.status === 'CALLED' || r.status === 'IN_CONSULTATION'),
  );
}

/**
 * Reorder (QUEUE §5.3): the multiset of the listed serials' current positions, sorted ascending, is handed
 * to the ids in the requested order. Serials that are not listed keep their positions.
 */
export function reorderAssignments(
  rows: readonly QueueRow[],
  orderedSerialIds: readonly string[],
): Array<{ id: string; from: number; to: number }> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const positions = orderedSerialIds
    .map((id) => byId.get(id)?.queuePosition)
    .filter((p): p is number => p !== null && p !== undefined)
    .sort((a, b) => a - b);
  return orderedSerialIds.map((id, i) => ({ id, from: byId.get(id)!.queuePosition!, to: positions[i]! }));
}

/** Serials ahead of `position` that are still waiting to be called (QUEUE §4.2). */
export function peopleAhead(rows: readonly QueueRow[], position: number): number {
  return rows.filter(
    (r) =>
      (r.status === 'CHECKED_IN' || r.status === 'WAITING') &&
      r.queuePosition !== null &&
      r.queuePosition < position,
  ).length;
}

/**
 * Estimated position for a serial that has not arrived yet (QUEUE §4.2): the count of non-terminal serials
 * on the day with a lower serial number. Always labelled an estimate, never persisted.
 */
export function estimatedPosition(rows: readonly QueueRow[], serialNumber: number): number {
  const terminal: ReadonlySet<SerialStatus> = new Set(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED']);
  return rows.filter((r) => r.serialNumber < serialNumber && !terminal.has(r.status)).length + 1;
}

/**
 * Minutes until a serial is likely to be called, from the chamber policy and the recorded delay. An
 * estimate for display only (QUEUE §4.2): never stored, never promised.
 */
export function estimatedWaitMinutes(input: {
  ahead: number;
  avgConsultationMinutes: number;
  expectedDelayMinutes: number | null;
}): number {
  return input.ahead * input.avgConsultationMinutes + (input.expectedDelayMinutes ?? 0);
}
