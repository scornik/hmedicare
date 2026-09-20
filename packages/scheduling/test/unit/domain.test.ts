import { describe, expect, it } from 'vitest';
import {
  APPOINTMENT_TRANSITIONS,
  DEFAULT_QUEUE_POLICY,
  type ScheduleRuleFacts,
  appointmentTransition,
  bookingCutoffPassed,
  bookingDateRefusal,
  capacityRefusal,
  isoWeekday,
  localClock,
  localInstant,
  paymentTermsFor,
  policyProblems,
  resolveDayWindow,
  resolveQueuePolicy,
  slotsForWindow,
  timeToMinutes,
  weeklyRulesOverlap,
} from '../../src/public/index';

const rule = (o: Partial<ScheduleRuleFacts> & { id: string }): ScheduleRuleFacts => ({
  ruleType: 'WEEKLY',
  weekday: null,
  exceptionDate: null,
  localStartTime: '17:00',
  localEndTime: '21:00',
  capacity: null,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  ...o,
});

describe('queue policy (QUEUE §2, C-44)', () => {
  it('resolves partial JSON over the documented defaults and drops unknown keys', () => {
    const p = resolveQueuePolicy({
      recallLimit: 3,
      unknown: 1,
      dayCloseDisposition: { BOOKED: 'CANCELLED' },
    });
    expect(p.recallLimit).toBe(3);
    expect(p.bookingWindowDays).toBe(14);
    expect(p.dayCloseDisposition).toEqual({
      ...DEFAULT_QUEUE_POLICY.dayCloseDisposition,
      BOOKED: 'CANCELLED',
    });
    expect((p as unknown as Record<string, unknown>).unknown).toBeUndefined();
    expect(resolveQueuePolicy(null)).toEqual(DEFAULT_QUEUE_POLICY);
  });

  it('flags cross-field invariants', () => {
    expect(
      policyProblems(resolveQueuePolicy({ advanceBookingEnabled: false, walkInsEnabled: false })),
    ).toEqual([{ path: 'walkInsEnabled', code: 'no_intake_channel' }]);
    expect(policyProblems(resolveQueuePolicy({ capacity: 10, maxBookedSerials: 20 }))).toEqual([
      { path: 'maxBookedSerials', code: 'exceeds_capacity' },
    ]);
    expect(policyProblems(DEFAULT_QUEUE_POLICY)).toEqual([]);
  });
});

describe('schedule resolution (DATABASE §3.5, QUEUE §5.6)', () => {
  it('parses HH:MM strictly and computes ISO weekdays', () => {
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('9:30')).toBeNull();
    expect(timeToMinutes('24:00')).toBeNull();
    expect(isoWeekday('2026-09-19')).toBe(6); // Saturday
    expect(isoWeekday('2026-09-20')).toBe(7); // Sunday
    expect(isoWeekday('2026-09-21')).toBe(1); // Monday
  });

  it('converts local Dhaka clock times to UTC and back across the day boundary', () => {
    expect(localInstant('2026-09-17', '00:05').toISOString()).toBe('2026-09-16T18:05:00.000Z');
    expect(localClock(new Date('2026-09-16T18:05:00Z'))).toEqual({
      localDate: '2026-09-17',
      localTime: '00:05',
    });
    expect(localClock(new Date('2026-09-17T17:59:59Z'))).toEqual({
      localDate: '2026-09-17',
      localTime: '23:59',
    });
  });

  it('closed exception wins, open exception beats weekly, weekly by weekday in effect', () => {
    const rules = [
      rule({ id: 'w-sat', weekday: 6 }),
      rule({
        id: 'w-sat-old',
        weekday: 6,
        localStartTime: '09:00',
        localEndTime: '12:00',
        effectiveTo: '2026-06-30',
      }),
      rule({
        id: 'x-open',
        ruleType: 'EXCEPTION_OPEN',
        exceptionDate: '2026-09-20',
        localStartTime: '10:00',
        localEndTime: '13:00',
        capacity: 20,
      }),
      rule({ id: 'x-closed', ruleType: 'EXCEPTION_CLOSED', exceptionDate: '2026-09-26' }),
    ];
    expect(resolveDayWindow(rules, '2026-09-19')).toMatchObject({ ruleId: 'w-sat', localStartTime: '17:00' });
    expect(resolveDayWindow(rules, '2026-09-26')).toBeNull(); // holiday
    expect(resolveDayWindow(rules, '2026-09-20')).toMatchObject({ ruleId: 'x-open', capacity: 20 });
    expect(resolveDayWindow(rules, '2026-09-21')).toBeNull(); // no Monday rule
    expect(resolveDayWindow(rules, '2026-03-07')).toMatchObject({ ruleId: 'w-sat-old' }); // old rule in effect
  });

  it('detects overlapping weekly rules and generates slots', () => {
    const a = rule({ id: 'a', weekday: 2 });
    expect(
      weeklyRulesOverlap(a, rule({ id: 'b', weekday: 2, localStartTime: '20:00', localEndTime: '22:00' })),
    ).toBe(true);
    expect(
      weeklyRulesOverlap(a, rule({ id: 'c', weekday: 2, localStartTime: '21:00', localEndTime: '22:00' })),
    ).toBe(false);
    expect(weeklyRulesOverlap(a, rule({ id: 'd', weekday: 3 }))).toBe(false);
    expect(weeklyRulesOverlap(a, rule({ id: 'e', weekday: 2, effectiveFrom: '2027-01-01' }))).toBe(true);
    const window = resolveDayWindow([a], '2026-09-22')!;
    const slots = slotsForWindow(window, 90, 2);
    expect(slots.map((s) => s.localLabel)).toEqual(['17:00–18:30', '18:30–20:00']);
    expect(slots[0]!.startsAt.toISOString()).toBe('2026-09-22T11:00:00.000Z');
    expect(slotsForWindow(window, null, 1)).toEqual([]);
  });
});

describe('booking rules (C-44, C-45)', () => {
  const chamber = {
    supportsPhysical: true,
    supportsRemote: true,
    supportsHybrid: false,
    chamberPaymentMode: 'PAY_AT_CHAMBER' as const,
    telemedicinePaymentMode: 'PREPAID_REQUIRED' as const,
  };

  it('prepaid without the payments module is FEATURE_DISABLED; optional online is informational', () => {
    expect(paymentTermsFor(chamber, 'PHYSICAL', false)).toEqual({
      requirement: 'NONE',
      status: 'NOT_REQUIRED',
    });
    expect(paymentTermsFor(chamber, 'REMOTE', false)).toEqual({
      code: 'FEATURE_DISABLED',
      reason: 'PAYMENTS_NOT_AVAILABLE',
    });
    expect(paymentTermsFor({ ...chamber, chamberPaymentMode: 'OPTIONAL_ONLINE' }, 'PHYSICAL', false)).toEqual(
      {
        requirement: 'OPTIONAL',
        status: 'PENDING',
      },
    );
    expect(
      paymentTermsFor({ ...chamber, chamberPaymentMode: 'PREPAID_REQUIRED' }, 'PHYSICAL', false),
    ).toEqual({
      code: 'FEATURE_DISABLED',
      reason: 'PAYMENTS_NOT_AVAILABLE',
    });
  });

  it('booking window, cut-off (staff exempt) and capacity ceilings', () => {
    const p = resolveQueuePolicy({ capacity: 5, maxBookedSerials: 3, maxWalkIns: 2 });
    expect(bookingDateRefusal(p, '2026-09-19', '2026-09-18')).toEqual({
      code: 'VALIDATION_FAILED',
      reason: 'past_date',
    });
    expect(bookingDateRefusal(p, '2026-09-19', '2026-10-03')).toBeNull();
    expect(bookingDateRefusal(p, '2026-09-19', '2026-10-04')).toEqual({
      code: 'VALIDATION_FAILED',
      reason: 'outside_booking_window',
    });
    const start = localInstant('2026-09-19', '17:00');
    expect(bookingCutoffPassed(p, new Date(start.getTime() - 61 * 60_000), start, false)).toBe(false);
    expect(bookingCutoffPassed(p, new Date(start.getTime() - 59 * 60_000), start, false)).toBe(true);
    expect(bookingCutoffPassed(p, new Date(start.getTime() - 59 * 60_000), start, true)).toBe(false);
    expect(capacityRefusal(p, { nonCancelled: 2, booked: 2, walkIns: 0 }, 'booked')).toBeNull();
    expect(capacityRefusal(p, { nonCancelled: 3, booked: 3, walkIns: 0 }, 'booked')).toEqual({
      code: 'CAPACITY_EXCEEDED',
      reason: 'max_booked_serials',
    });
    expect(capacityRefusal(p, { nonCancelled: 4, booked: 2, walkIns: 2 }, 'walkIn')).toEqual({
      code: 'CAPACITY_EXCEEDED',
      reason: 'max_walk_ins',
    });
    expect(capacityRefusal(p, { nonCancelled: 5, booked: 3, walkIns: 2 }, 'walkIn')).toEqual({
      code: 'CAPACITY_EXCEEDED',
      reason: 'capacity',
    });
  });
});

describe('appointment state machine', () => {
  it('only the documented edges exist; terminal states have none', () => {
    expect(appointmentTransition('BOOKED', 'cancel')).toBe('CANCELLED');
    expect(appointmentTransition('BOOKED', 'reschedule')).toBe('RESCHEDULED');
    expect(appointmentTransition('BOOKED', 'no_show')).toBe('NO_SHOW');
    expect(appointmentTransition('BOOKED', 'confirm')).toBeNull();
    for (const s of ['CANCELLED', 'RESCHEDULED', 'FULFILLED', 'NO_SHOW'] as const) {
      expect(Object.keys(APPOINTMENT_TRANSITIONS[s])).toEqual([]);
    }
  });
});
