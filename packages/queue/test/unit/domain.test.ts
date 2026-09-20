import { describe, expect, it } from 'vitest';
import {
  SERIAL_COMMANDS,
  SERIAL_STATUSES,
  SERIAL_TRANSITIONS,
  TERMINAL_STATUSES,
  appendPlacement,
  bySerialNumberPlacement,
  estimatedPosition,
  estimatedWaitMinutes,
  eventForTransition,
  isLateArrival,
  peopleAhead,
  placementFor,
  type QueueRow,
  reorderAssignments,
  type SerialCommand,
  type SerialStatus,
  serialTransition,
} from '../../src/public/index';

const row = (
  id: string,
  serialNumber: number,
  queuePosition: number | null,
  status: SerialStatus,
): QueueRow => ({
  id,
  serialNumber,
  queuePosition,
  status,
});

describe('serial transition table (QUEUE §3.2)', () => {
  it('covers the full (status, command) matrix: every pair is either documented or rejected', () => {
    const documented = new Set<string>();
    for (const from of SERIAL_STATUSES) {
      for (const [command, to] of Object.entries(SERIAL_TRANSITIONS[from])) {
        documented.add(`${from}:${command}`);
        expect(SERIAL_STATUSES).toContain(to);
      }
    }
    let rejected = 0;
    for (const from of SERIAL_STATUSES) {
      for (const command of SERIAL_COMMANDS) {
        const target = serialTransition(from, command);
        if (documented.has(`${from}:${command}`)) expect(target).not.toBeNull();
        else {
          expect(target).toBeNull();
          rejected++;
        }
      }
    }
    // 11 statuses × 11 commands, minus the documented edges.
    expect(documented.size + rejected).toBe(SERIAL_STATUSES.length * SERIAL_COMMANDS.length);
    // QUEUE §3.2 documents 25 edges: 5 + 4 + 4 + 3 + 4 + 3 + 2 across the seven non-terminal statuses.
    expect(documented.size).toBe(25);
  });

  it('terminal statuses have no outgoing edge', () => {
    for (const s of TERMINAL_STATUSES) {
      expect(Object.keys(SERIAL_TRANSITIONS[s])).toEqual([]);
      for (const c of SERIAL_COMMANDS) expect(serialTransition(s, c)).toBeNull();
    }
  });

  it('maps each command to its queue event type', () => {
    const pairs: Array<[SerialCommand, string]> = [
      ['confirm', 'CONFIRMED'],
      ['check_in', 'CHECKED_IN'],
      ['mark_waiting', 'WAITING'],
      ['call', 'CALLED'],
      ['skip', 'SKIPPED'],
      ['recall', 'RECALLED'],
      ['no_show', 'NO_SHOW'],
      ['cancel', 'CANCELLED'],
      ['reschedule', 'RESCHEDULED'],
      ['start_consultation', 'CONSULTATION_STARTED'],
      ['complete', 'COMPLETED'],
    ];
    for (const [command, event] of pairs) expect(eventForTransition(command)).toBe(event);
  });
});

describe('queue positions (QUEUE §4.1)', () => {
  const queue: QueueRow[] = [
    row('a', 1, 1, 'WAITING'),
    row('b', 2, 2, 'CALLED'),
    row('c', 5, 3, 'WAITING'),
    row('d', 6, null, 'BOOKED'),
    row('e', 3, 4, 'SKIPPED'),
    row('f', 4, null, 'CANCELLED'),
  ];

  it('appends after every queue-active serial and ignores terminal ones', () => {
    expect(appendPlacement(queue)).toEqual({ position: 5, shifted: [], reordersOthers: false });
    expect(appendPlacement([])).toEqual({ position: 1, shifted: [], reordersOthers: false });
    expect(appendPlacement([row('x', 9, null, 'BOOKED')])).toMatchObject({ position: 1 });
  });

  it('BY_SERIAL_NUMBER inserts among the queue-active serials and shifts the rest', () => {
    // Serial 3 sits after the serials numbered 1 and 2 (positions 1 and 2) → position 3; c and e shift.
    const placement = bySerialNumberPlacement(queue, 3);
    expect(placement.position).toBe(3);
    expect(placement.reordersOthers).toBe(true);
    expect(placement.shifted).toEqual([
      { id: 'c', from: 3, to: 4 },
      { id: 'e', from: 4, to: 5 },
    ]);
    // The lowest serial number goes to the front and shifts everybody.
    expect(bySerialNumberPlacement(queue, 0).position).toBe(1);
    expect(bySerialNumberPlacement(queue, 0).shifted).toHaveLength(4);
    // A higher number than anybody queue-active appends without shifting.
    expect(bySerialNumberPlacement(queue, 99)).toEqual({ position: 5, shifted: [], reordersOthers: false });
  });

  it('placementFor only uses BY_SERIAL_NUMBER for a late arrival under that policy', () => {
    const onTime = placementFor({
      rows: queue,
      serialNumber: 3,
      lateArrival: false,
      policy: { lateArrivalPlacement: 'BY_SERIAL_NUMBER' },
    });
    expect(onTime.position).toBe(5);
    const late = placementFor({
      rows: queue,
      serialNumber: 3,
      lateArrival: true,
      policy: { lateArrivalPlacement: 'BY_SERIAL_NUMBER' },
    });
    expect(late.position).toBe(3);
    const appendPolicy = placementFor({
      rows: queue,
      serialNumber: 3,
      lateArrival: true,
      policy: { lateArrivalPlacement: 'APPEND' },
    });
    expect(appendPolicy.position).toBe(5);
  });

  it('detects a late arrival by the grace period or by a higher serial already called', () => {
    const start = new Date('2026-09-19T11:00:00Z');
    const base = { expectedStart: start, graceMinutes: 15, serialNumber: 5, rows: [] as QueueRow[] };
    expect(isLateArrival({ ...base, now: new Date('2026-09-19T11:14:00Z') })).toBe(false);
    expect(isLateArrival({ ...base, now: new Date('2026-09-19T11:16:00Z') })).toBe(true);
    expect(
      isLateArrival({ ...base, now: new Date('2026-09-19T10:00:00Z'), rows: [row('z', 7, 2, 'CALLED')] }),
    ).toBe(true);
    expect(
      isLateArrival({ ...base, now: new Date('2026-09-19T10:00:00Z'), rows: [row('z', 3, 2, 'CALLED')] }),
    ).toBe(false);
  });

  it('reorder hands the sorted multiset of positions to the requested order', () => {
    const rows = [row('a', 1, 1, 'WAITING'), row('b', 2, 2, 'WAITING'), row('c', 3, 3, 'WAITING')];
    expect(reorderAssignments(rows, ['c', 'a'])).toEqual([
      { id: 'c', from: 3, to: 1 },
      { id: 'a', from: 1, to: 3 },
    ]);
    // A single-element reorder is a no-op; b keeps position 2 either way.
    expect(reorderAssignments(rows, ['b'])).toEqual([{ id: 'b', from: 2, to: 2 }]);
  });
});

describe('patient-facing view (QUEUE §4.2)', () => {
  const rows: QueueRow[] = [
    row('a', 1, 1, 'WAITING'),
    row('b', 2, 2, 'CALLED'),
    row('c', 3, 3, 'CHECKED_IN'),
    row('d', 4, null, 'BOOKED'),
    row('e', 5, null, 'CANCELLED'),
  ];

  it('people ahead counts only those still waiting', () => {
    expect(peopleAhead(rows, 4)).toBe(2); // a and c; b was already called
    expect(peopleAhead(rows, 1)).toBe(0);
  });

  it('an unarrived serial gets an estimated position from the lower non-terminal serial numbers', () => {
    expect(estimatedPosition(rows, 4)).toBe(4); // a, b, c are not terminal
    expect(estimatedPosition(rows, 1)).toBe(1);
    expect(estimatedPosition(rows, 6)).toBe(5); // e is cancelled and does not count
  });

  it('the wait estimate adds the recorded delay to the queue ahead', () => {
    expect(estimatedWaitMinutes({ ahead: 3, avgConsultationMinutes: 10, expectedDelayMinutes: 15 })).toBe(45);
    expect(estimatedWaitMinutes({ ahead: 0, avgConsultationMinutes: 10, expectedDelayMinutes: null })).toBe(
      0,
    );
  });
});
