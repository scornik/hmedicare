/**
 * Pattern detectors (AIPOL-004, AI-IMPLEMENTATION §5.2).
 *
 * Known values are replaced first and matter most; these patterns are the second layer, for an
 * identifier a doctor typed that the record does not hold. They are also what the residual scan
 * re-runs, which is why each one is written to be run over already-minimized text: a detector that
 * matched its own placeholder would fail every job.
 *
 * Bangla digits are converted to ASCII before any of this runs, by the service: `০১৭…` is a phone
 * number to a reader and a run of unmatched characters to a regex over ASCII, and converting once at
 * the top is why the date and digit rules below need only one script each.
 */

/** RFC-lite: enough to catch what a person types, not a validator. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/gu;
const SLASH_DATE = /(?<!\d)(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?!\d)/gu;
/**
 * A maximal run of digits with the separators people put inside numbers.
 *
 * One scanner rather than a phone pattern and an ID pattern competing: with two patterns the longer
 * identifier was being claimed by the shorter one's rule, so `1990123456789` read as a phone number
 * and the remaining digits stayed in the text. Here the run is found once, its separators are
 * stripped, and the cleaned digits decide what it is.
 */
const DIGIT_RUN = /\+?\d(?:[\s.\-]?\d){7,24}/gu;
const BD_MOBILE_CLEAN = /^(?:\+?88)?0?1[3-9]\d{8}$/u;
const E164_CLEAN = /^\+?\d{8,15}$/u;
/** NID (10 or 17), birth registration (17), and the older 13. */
const ID_LENGTHS = new Set([10, 13, 17]);

const EN_MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
/** Bangla month names, both the Gregorian transliterations and the Bangla calendar's own. */
const BN_MONTHS = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];
const MONTH_ALTERNATIVES = [...EN_MONTHS.flatMap((m) => [m, m.slice(0, 3)]), ...BN_MONTHS].join('|');
const TEXT_DATE = new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${MONTH_ALTERNATIVES})\\.?\\s+(\\d{4})(?!\\d)`, 'giu');

export interface PatternMatch {
  value: string;
  index: number;
  length: number;
}

const collect = (text: string, re: RegExp): PatternMatch[] => {
  const out: PatternMatch[] = [];
  for (const m of text.matchAll(re)) {
    out.push({ value: m[0], index: m.index, length: m[0].length });
  }
  return out;
};

export const findEmails = (text: string): PatternMatch[] => collect(text, EMAIL);

export type DigitRunKind = 'PHONE' | 'ID' | 'UNCLASSIFIED';
export interface DigitRun extends PatternMatch {
  /** Separators removed, Bangla digits already converted by the caller. */
  cleaned: string;
  kind: DigitRunKind;
}

/**
 * Every digit run in the text, classified.
 *
 * `UNCLASSIFIED` runs are left in place: a dose, a blood pressure and a lab value are all digit runs,
 * and redacting them would strip the clinical content this payload exists to carry.
 */
export function findDigitRuns(text: string): DigitRun[] {
  const out: DigitRun[] = [];
  for (const m of text.matchAll(DIGIT_RUN)) {
    const cleaned = m[0].replace(/[\s.\-]/gu, '');
    const kind: DigitRunKind = BD_MOBILE_CLEAN.test(cleaned)
      ? 'PHONE'
      : ID_LENGTHS.has(cleaned.length)
        ? 'ID'
        : E164_CLEAN.test(cleaned) && cleaned.startsWith('+')
          ? 'PHONE'
          : 'UNCLASSIFIED';
    out.push({ value: m[0], index: m.index, length: m[0].length, cleaned, kind });
  }
  return out;
}

export const findPhones = (text: string): DigitRun[] =>
  findDigitRuns(text).filter((run) => run.kind === 'PHONE');
export const findIdDigitRuns = (text: string): DigitRun[] =>
  findDigitRuns(text).filter((run) => run.kind === 'ID');

export interface DateMatch extends PatternMatch {
  /** Local calendar date, midnight UTC, so day arithmetic cannot drift across a timezone. */
  date: Date;
}

const utcDate = (year: number, month: number, day: number): Date | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31 February and friends, which `Date.UTC` would roll over silently.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
};

/**
 * Free-text dates in the formats the spec names.
 *
 * Day-first for the slash form, which is how dates are written in Bangladesh. An ambiguous
 * `03/04/2026` is therefore 3 April; reading it as 3 March would shift the relative day, and there is
 * no way to tell from the text which was meant. The relative day is approximate clinical context, not
 * a fact anyone treats, which is what makes one consistent reading acceptable here.
 */
export function findTextDates(text: string): DateMatch[] {
  const out: DateMatch[] = [];
  for (const m of text.matchAll(ISO_DATE)) {
    const date = utcDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (date) out.push({ value: m[0], index: m.index, length: m[0].length, date });
  }
  for (const m of text.matchAll(SLASH_DATE)) {
    const date = utcDate(Number(m[3]), Number(m[2]), Number(m[1]));
    if (date) out.push({ value: m[0], index: m.index, length: m[0].length, date });
  }
  for (const m of text.matchAll(TEXT_DATE)) {
    const month = m[2]!.toLowerCase();
    const index =
      EN_MONTHS.findIndex((name) => name === month || name.slice(0, 3) === month) >= 0
        ? EN_MONTHS.findIndex((name) => name === month || name.slice(0, 3) === month)
        : BN_MONTHS.indexOf(m[2]!);
    const date = index >= 0 ? utcDate(Number(m[3]), index + 1, Number(m[1])) : null;
    if (date) out.push({ value: m[0], index: m.index, length: m[0].length, date });
  }
  return out;
}

/** Whole days between an anchor and an earlier date. Negative where the date is after the anchor. */
export function daysBefore(anchor: Date, date: Date): number {
  return Math.round((anchor.getTime() - date.getTime()) / 86_400_000);
}

/** Age in whole years at the anchor, with 90 and above collapsed (AI-IMPLEMENTATION §5.2). */
export function ageAt(anchor: Date, dateOfBirth: Date): string {
  let age = anchor.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    anchor.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (anchor.getUTCMonth() === dateOfBirth.getUTCMonth() && anchor.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age < 0) return '0';
  // A single bucket above 90: an exact age that high is identifying on its own in a small population.
  return age >= 90 ? '90+' : String(age);
}
