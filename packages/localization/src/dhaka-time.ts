import type { Locale } from './locale';

/**
 * Clinic-local time (Asia/Dhaka, UTC+06:00, no DST since 2009). Instants are stored in UTC; business dates
 * (chamber day, serial day) are Dhaka calendar dates `YYYY-MM-DD`.
 */
export const CLINIC_TIME_ZONE = 'Asia/Dhaka';
const DHAKA_OFFSET_MS = 6 * 3_600_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Dhaka calendar date of an instant. */
export function dhakaDate(instant: Date): string {
  return dateParts.format(instant);
}

function parseDate(date: string): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError('expected YYYY-MM-DD');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new RangeError('invalid calendar date');
  }
  return [y, mo, d];
}

/** UTC instant of 00:00 Dhaka on `date`. */
export function startOfDhakaDay(date: string): Date {
  const [y, mo, d] = parseDate(date);
  return new Date(Date.UTC(y, mo - 1, d) - DHAKA_OFFSET_MS);
}

/** Half-open UTC range `[start, end)` covering a Dhaka calendar day. */
export function dhakaDayRange(date: string): { start: Date; end: Date } {
  const start = startOfDhakaDay(date);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function addDays(date: string, days: number): string {
  const [y, mo, d] = parseDate(date);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/** Locale display of an instant in Dhaka time (bn-BD uses Bangla digits). */
export function formatDhakaDateTime(instant: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: CLINIC_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(instant);
}
