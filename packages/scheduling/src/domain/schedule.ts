import { addDays, dhakaDate, startOfDhakaDay } from '@hmedic/localization';

/**
 * Schedule rules → chamber-day window (DATABASE §3.5, QUEUE §5.6). Local times are `HH:MM` on the Dhaka
 * calendar date; instants are UTC. One chamber has at most one chamber day per local date
 * (`uq_chamber_days_date`), so a date resolves to exactly one window or none.
 */
export type RuleType = 'WEEKLY' | 'EXCEPTION_OPEN' | 'EXCEPTION_CLOSED';

export interface ScheduleRuleFacts {
  id: string;
  ruleType: RuleType;
  /** ISO weekday 1 (Monday) … 7 (Sunday); WEEKLY only. */
  weekday: number | null;
  /** `YYYY-MM-DD`; exceptions only. */
  exceptionDate: string | null;
  localStartTime: string;
  localEndTime: string;
  capacity: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface DayWindow {
  localDate: string;
  localStartTime: string;
  localEndTime: string;
  capacity: number | null;
  /** The rule that produced the window. */
  ruleId: string;
}

const TIME_MINUTES_MAX = 24 * 60;

/** `HH:MM` → minutes since local midnight, or null when malformed. */
export function timeToMinutes(value: string): number | null {
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  if (parts[0]!.length !== 2 || parts[1]!.length !== 2) return null;
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
export function isoWeekday(localDate: string): number {
  const [y, mo, d] = localDate.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** UTC instant of `HH:MM` local on a Dhaka calendar date. */
export function localInstant(localDate: string, localTime: string): Date {
  const minutes = timeToMinutes(localTime);
  if (minutes === null) throw new RangeError(`invalid local time ${localTime}`);
  return new Date(startOfDhakaDay(localDate).getTime() + minutes * 60_000);
}

/** Dhaka calendar date and `HH:MM` of an instant. */
export function localClock(instant: Date): { localDate: string; localTime: string } {
  const localDate = dhakaDate(instant);
  const minutes = Math.floor((instant.getTime() - startOfDhakaDay(localDate).getTime()) / 60_000);
  return { localDate, localTime: minutesToTime(Math.min(minutes, TIME_MINUTES_MAX - 1)) };
}

function inEffect(rule: ScheduleRuleFacts, localDate: string): boolean {
  return rule.effectiveFrom <= localDate && (rule.effectiveTo === null || localDate <= rule.effectiveTo);
}

/**
 * Resolves the window for a local date: a closed exception wins, then an open exception, then the weekly
 * rule of that weekday in effect. With several weekly rules for the same weekday (rejected on create when
 * they overlap), the earliest start wins deterministically.
 */
export function resolveDayWindow(rules: readonly ScheduleRuleFacts[], localDate: string): DayWindow | null {
  const onDate = rules.filter((r) => inEffect(r, localDate));
  if (onDate.some((r) => r.ruleType === 'EXCEPTION_CLOSED' && r.exceptionDate === localDate)) return null;
  const open = onDate.filter((r) => r.ruleType === 'EXCEPTION_OPEN' && r.exceptionDate === localDate);
  const weekday = isoWeekday(localDate);
  const weekly = onDate.filter((r) => r.ruleType === 'WEEKLY' && r.weekday === weekday);
  const pick = (open.length ? open : weekly).sort((a, b) =>
    a.localStartTime === b.localStartTime
      ? a.id.localeCompare(b.id)
      : a.localStartTime.localeCompare(b.localStartTime),
  )[0];
  if (!pick) return null;
  return {
    localDate,
    localStartTime: pick.localStartTime,
    localEndTime: pick.localEndTime,
    capacity: pick.capacity,
    ruleId: pick.id,
  };
}

/** Two weekly rules for one weekday collide when their effective ranges and local windows both overlap. */
export function weeklyRulesOverlap(a: ScheduleRuleFacts, b: ScheduleRuleFacts): boolean {
  if (a.ruleType !== 'WEEKLY' || b.ruleType !== 'WEEKLY' || a.weekday !== b.weekday) return false;
  const rangesOverlap =
    a.effectiveFrom <= (b.effectiveTo ?? '9999-12-31') && b.effectiveFrom <= (a.effectiveTo ?? '9999-12-31');
  const timesOverlap = a.localStartTime < b.localEndTime && b.localStartTime < a.localEndTime;
  return rangesOverlap && timesOverlap;
}

export interface SlotSpec {
  startsAt: Date;
  endsAt: Date;
  localLabel: string;
  capacity: number;
}

/** Slots of `slotMinutes` across the window (last partial slot dropped); none when serial-number booking. */
export function slotsForWindow(
  window: DayWindow,
  slotMinutes: number | null,
  slotCapacity: number,
): SlotSpec[] {
  if (slotMinutes === null) return [];
  const start = timeToMinutes(window.localStartTime)!;
  const end = timeToMinutes(window.localEndTime)!;
  const slots: SlotSpec[] = [];
  for (let m = start; m + slotMinutes <= end; m += slotMinutes) {
    slots.push({
      startsAt: localInstant(window.localDate, minutesToTime(m)),
      endsAt: localInstant(window.localDate, minutesToTime(m + slotMinutes)),
      localLabel: `${minutesToTime(m)}–${minutesToTime(m + slotMinutes)}`,
      capacity: slotCapacity,
    });
  }
  return slots;
}

/** Local dates `from … to` inclusive (bounded by the caller). */
export function localDateRange(from: string, to: string, maxDays = 62): string[] {
  const out: string[] = [];
  for (let d = from, i = 0; d <= to && i < maxDays; d = addDays(d, 1), i++) out.push(d);
  return out;
}
