import { type Result, err, ok } from '@hmedic/kernel';
import { foldLatin, skeleton, toLatinDigits, transliterateBangla } from '@hmedic/localization';
import {
  ADDRESS_TOKEN,
  ANY_TOKEN_RE,
  CLINICIAN_TOKEN,
  EMAIL_TOKEN,
  FACILITY_TOKEN,
  ID_TOKEN,
  type IdentifierCategory,
  MRN_TOKEN,
  PATIENT_TOKEN,
  PHONE_TOKEN,
  RELATIVE_DAY_RE,
  TokenMap,
  relatedPersonToken,
  relativeDayToken,
} from './tokens';
import { ageAt, daysBefore, findDigitRuns, findEmails, findTextDates } from './detectors';

/**
 * `PhiMinimizationService` (AIPOL-004, AI-IMPLEMENTATION §5, ADR-017 §3).
 *
 * Removes identifiers from the context a prompt will carry, and fails closed. Everything here follows
 * from one fact: for a `MAY_TRAIN_OR_REVIEW` credential the provider may keep and learn from what it
 * receives, so an identifier that slips through is not a bug that can be fixed afterwards.
 *
 * Known values go first and patterns second. The record's own names, contacts, addresses and
 * identifiers are the values most likely to appear and the only ones that can be replaced with
 * certainty; the patterns then catch what a doctor typed that the record does not hold. The residual
 * scan re-runs both layers over the result, and anything still matching fails the job — the scan is
 * the only part of this service that decides whether a provider call happens at all.
 *
 * The token map restores only what can be restored without inventing anything. Where one placeholder
 * stood for several different values — two phone numbers, two clinicians — the mapping is ambiguous and
 * the token is deliberately left unmapped, so restore leaves a visible placeholder and the suggestion
 * is marked low confidence rather than putting a plausible wrong value into a clinical draft.
 *
 * It does not promise more than it does (§5.5): unknown names typed as free text, rare identifier
 * formats and identifying narratives survive this. That is why templates send doctor-selected sections
 * only, why raw media is blocked for these credentials, and why the acknowledgement text says so.
 */
export const MINIMIZATION_VERSION = 'phi-min-v1';

export interface MinimizationPatient {
  /** Legal and display names, in any script. */
  names: readonly string[];
  /** Phone numbers and email addresses as stored. */
  contacts?: readonly string[];
  identifiers?: readonly { category: 'NATIONAL_ID' | 'BIRTH_REGISTRATION' | 'MRN'; value: string }[];
  /** ISO date. Becomes an age in whole years; never sent as a date. */
  dateOfBirth?: string;
  addressLines?: readonly string[];
}

export interface MinimizationRelatedPerson {
  names: readonly string[];
  contacts?: readonly string[];
}

export interface TenantDictionary {
  /** Clinic, chamber and tenant names. */
  facilityNames?: readonly string[];
  /** Doctor and staff display names. */
  clinicianNames?: readonly string[];
}

export type MinimizationSection =
  | { key: string; contentType: 'text'; text: string }
  | {
      key: string;
      contentType: 'history_items';
      items: readonly { occurredOn?: string; text: string }[];
    };

export interface MinimizationInput {
  patient: MinimizationPatient;
  relatedPersons?: readonly MinimizationRelatedPerson[];
  tenantDictionary?: TenantDictionary;
  /** The consultation's local date. Every other date is expressed relative to this one. */
  encounterAnchorDate: string;
  sections: readonly MinimizationSection[];
  /** The template's input budget. Exceeding it after replacement fails the job (§5.3). */
  maxInputCharacters?: number;
}

export interface MinimizationReport {
  categories: Array<{ category: IdentifierCategory; count: number }>;
  residualScanPassed: boolean;
  version: string;
}

export interface MinimizedPayload {
  sections: Array<{ key: string; text: string }>;
  /** Whole years, or `90+`. Null where no date of birth was supplied. */
  patientAge: string | null;
  report: MinimizationReport;
  /** In-memory only, for one job. Never persisted, logged or queued. */
  tokenMap: TokenMap;
}

export interface PhiMinimizationFailed {
  errorClass: 'PHI_MINIMIZATION_FAILED';
  /** A category or rule name. Never a sample of the text that failed. */
  reason:
    | 'UNKNOWN_CONTENT_TYPE'
    | 'INVALID_ANCHOR_DATE'
    | 'RESIDUAL_IDENTIFIER'
    | 'INPUT_BUDGET_EXCEEDED'
    | 'UNEXPECTED_ERROR';
  /** Which detector still matched, where that is what failed. Category only, never a value. */
  residualCategory?: IdentifierCategory;
}

interface KnownValue {
  category: IdentifierCategory;
  token: string;
  /** What to search for. Several variants may share one original. */
  needle: string;
  original: string;
}

const parseDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * Name variants to search for.
 *
 * A name stored in Bangla is written in Latin by half the people who type it, and the other way round,
 * so searching for the stored form alone would leave the name in the text. The transliteration and the
 * folded Latin form are added for that reason. Tokens under three characters are dropped, as the spec
 * requires: a two-letter fragment matches inside ordinary words and would redact clinical text.
 */
function nameVariants(name: string): string[] {
  const out = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length >= 3) out.add(trimmed);
  };
  add(name);
  const folded = foldLatin(name);
  add(folded);
  const transliterated = transliterateBangla(name);
  if (transliterated !== name) {
    add(transliterated);
    add(foldLatin(transliterated));
  }
  for (const part of `${name} ${transliterated}`.split(/\s+/u)) add(part);
  return [...out];
}

/**
 * Minimum skeleton length for the Banglish pass.
 *
 * `skeleton` drops vowels, so short words collapse hard: `cough` becomes `k`. Matching on a skeleton
 * that short would redact ordinary clinical words, so only skeletons of three characters or more are
 * used — which still covers the cases this pass exists for, `rohim` and `rahim` both being `rhm`.
 */
const MIN_SKELETON_LENGTH = 3;

/**
 * Replaces whole words whose skeleton matches a known name's.
 *
 * This is what makes the Banglish requirement real. A name stored as `রহিম` transliterates to `rohim`,
 * and the staff member typing the note writes `Rahim`; neither exact form finds the other, and the
 * name would have been sent. The skeletons agree, so this pass catches it.
 *
 * It over-redacts rather than under-redacts where a clinical word's skeleton collides with a name's.
 * That costs the model some context; the other direction would send a patient's name to a provider
 * that may train on it.
 */
function replaceBySkeleton(
  text: string,
  skeletons: ReadonlyMap<string, string>,
): { text: string; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const replaced = text.replace(/[\p{L}\p{N}]{3,}/gu, (word) => {
    const token = skeletons.get(skeleton(foldLatin(word)));
    if (token === undefined) return word;
    counts.set(token, (counts.get(token) ?? 0) + 1);
    return token;
  });
  return { text: replaced, counts };
}

/** Word-boundary replacement that works for Bangla too, where `\b` does not. */
function replaceWord(text: string, needle: string, token: string): { text: string; count: number } {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escape(needle)})(?=[^\\p{L}\\p{N}]|$)`, 'giu');
  let count = 0;
  const replaced = text.replace(pattern, (_match, before: string) => {
    count += 1;
    return `${before}${token}`;
  });
  return { text: replaced, count };
}

export class PhiMinimizationService {
  minimize(input: MinimizationInput): Result<MinimizedPayload, PhiMinimizationFailed> {
    try {
      return this.run(input);
    } catch {
      // Fail closed (§5.3): any exception means nothing is sent. The thrown error is not reported
      // onwards, because its message may quote the text that caused it.
      return err({ errorClass: 'PHI_MINIMIZATION_FAILED', reason: 'UNEXPECTED_ERROR' });
    }
  }

  private run(input: MinimizationInput): Result<MinimizedPayload, PhiMinimizationFailed> {
    const anchor = parseDate(input.encounterAnchorDate);
    if (!anchor) return err({ errorClass: 'PHI_MINIMIZATION_FAILED', reason: 'INVALID_ANCHOR_DATE' });

    const known = this.knownValues(input);
    const skeletons = this.nameSkeletons(known);
    const categoryByToken = new Map(known.map((value) => [value.token, value.category]));
    const counts = new Map<IdentifierCategory, number>();
    const bump = (category: IdentifierCategory, by = 1) =>
      counts.set(category, (counts.get(category) ?? 0) + by);

    const sections: Array<{ key: string; text: string }> = [];
    for (const section of input.sections) {
      let text: string;
      if (section.contentType === 'text') {
        text = section.text;
      } else if (section.contentType === 'history_items') {
        // Structured dates are converted rather than detected: the value is known exactly, so there is
        // no reason to let a pattern guess at it.
        text = section.items
          .map((item) => {
            if (!item.occurredOn) return item.text;
            const date = parseDate(item.occurredOn);
            if (!date) return item.text;
            bump('EXACT_DATE');
            return `${relativeDayToken(daysBefore(anchor, date))}: ${item.text}`;
          })
          .join('\n');
      } else {
        // An unknown content type means retrieval produced something this service has not been taught
        // to read, and sending it unexamined is exactly what fail-closed forbids.
        return err({ errorClass: 'PHI_MINIMIZATION_FAILED', reason: 'UNKNOWN_CONTENT_TYPE' });
      }

      /*
       * Bangla digits become ASCII once, here, before anything looks at the text. A number written
       * `০১৭…` is a phone number to a reader and invisible to a pattern over ASCII, and normalizing
       * at the top is what lets every rule below be written for one script. The payload is prose for
       * a model, so the conversion costs nothing clinically.
       */
      text = toLatinDigits(text);
      /*
       * Patterns run before known values, which is the opposite of what reads naturally and is
       * deliberate. A name inside an email address has to become `⟦EMAIL⟧`, not a placeholder glued
       * to the rest of the address: replacing the name first left `⟦PATIENT⟧.⟦PATIENT⟧@example.net`
       * on the page, which discloses the domain and the shape of the address.
       */
      text = this.replacePatterns(text, anchor, bump);
      for (const value of known) {
        const replaced = replaceWord(text, value.needle, value.token);
        if (replaced.count > 0) bump(value.category, replaced.count);
        text = replaced.text;
      }
      const bySkeleton = replaceBySkeleton(text, skeletons);
      text = bySkeleton.text;
      for (const [token, count] of bySkeleton.counts) bump(categoryByToken.get(token)!, count);
      sections.push({ key: section.key, text });
    }

    const residual = this.residualScan(sections, known, categoryByToken);
    if (residual) {
      return err({
        errorClass: 'PHI_MINIMIZATION_FAILED',
        reason: 'RESIDUAL_IDENTIFIER',
        residualCategory: residual,
      });
    }

    const total = sections.reduce((sum, section) => sum + section.text.length, 0);
    if (input.maxInputCharacters !== undefined && total > input.maxInputCharacters) {
      // Checked after replacement, as the spec says: placeholders can be longer than what they
      // replaced, so a payload that fitted before minimization may not fit after it.
      return err({ errorClass: 'PHI_MINIMIZATION_FAILED', reason: 'INPUT_BUDGET_EXCEEDED' });
    }

    const dateOfBirth = input.patient.dateOfBirth ? parseDate(input.patient.dateOfBirth) : null;
    if (dateOfBirth) bump('EXACT_DATE');
    return ok({
      sections,
      patientAge: dateOfBirth ? ageAt(anchor, dateOfBirth) : null,
      report: {
        categories: [...counts.entries()]
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => a.category.localeCompare(b.category)),
        residualScanPassed: true,
        version: MINIMIZATION_VERSION,
      },
      tokenMap: this.tokenMap(known),
    });
  }

  /**
   * The known values to replace, longest needle first.
   *
   * Order is not cosmetic: replacing a surname before the full name would leave half the name behind,
   * followed by a placeholder.
   */
  private knownValues(input: MinimizationInput): KnownValue[] {
    const values: KnownValue[] = [];
    const push = (category: IdentifierCategory, token: string, original: string) => {
      for (const needle of nameVariants(original)) values.push({ category, token, needle, original });
    };
    const pushExact = (category: IdentifierCategory, token: string, original: string) => {
      const trimmed = original.trim();
      if (trimmed.length >= 3) values.push({ category, token, needle: trimmed, original: trimmed });
    };

    for (const name of input.patient.names) push('PATIENT_NAME', PATIENT_TOKEN, name);
    for (const contact of input.patient.contacts ?? []) {
      pushExact(
        contact.includes('@') ? 'EMAIL' : 'PHONE',
        contact.includes('@') ? EMAIL_TOKEN : PHONE_TOKEN,
        contact,
      );
    }
    for (const line of input.patient.addressLines ?? []) pushExact('ADDRESS', ADDRESS_TOKEN, line);
    for (const identifier of input.patient.identifiers ?? []) {
      pushExact(identifier.category, identifier.category === 'MRN' ? MRN_TOKEN : ID_TOKEN, identifier.value);
    }
    (input.relatedPersons ?? []).forEach((person, index) => {
      const token = relatedPersonToken(index + 1);
      for (const name of person.names) push('RELATED_PERSON_NAME', token, name);
      for (const contact of person.contacts ?? []) {
        pushExact(
          contact.includes('@') ? 'EMAIL' : 'PHONE',
          contact.includes('@') ? EMAIL_TOKEN : PHONE_TOKEN,
          contact,
        );
      }
    });
    for (const name of input.tenantDictionary?.facilityNames ?? [])
      push('FACILITY_NAME', FACILITY_TOKEN, name);
    for (const name of input.tenantDictionary?.clinicianNames ?? [])
      push('CLINICIAN_NAME', CLINICIAN_TOKEN, name);

    return values.sort((a, b) => b.needle.length - a.needle.length);
  }

  /**
   * Skeleton → placeholder, for name categories only.
   *
   * Contacts, identifiers and addresses are excluded: a skeleton of a digit string or an address line
   * is meaningless, and matching one would redact text at random.
   */
  private nameSkeletons(known: readonly KnownValue[]): Map<string, string> {
    const nameCategories = new Set<IdentifierCategory>([
      'PATIENT_NAME',
      'RELATED_PERSON_NAME',
      'FACILITY_NAME',
      'CLINICIAN_NAME',
    ]);
    const out = new Map<string, string>();
    for (const value of known) {
      if (!nameCategories.has(value.category)) continue;
      for (const part of value.needle.split(/[^\p{L}\p{N}]+/u)) {
        if (part.length < 3) continue;
        const key = skeleton(foldLatin(part));
        if (key.length < MIN_SKELETON_LENGTH) continue;
        // First writer wins, so the patient's own placeholder is not displaced by a clinician whose
        // name happens to share a skeleton.
        if (!out.has(key)) out.set(key, value.token);
      }
    }
    return out;
  }

  /**
   * Replaces the pattern layer: addresses a doctor typed that the record does not hold.
   *
   * Emails first, so an address is taken whole. Dates next, because a relative day is far more useful
   * to the model than a redaction. Digit runs last, and only the ones that classify as a phone number
   * or an identifier length — a dose, a blood pressure and a lab value are digit runs too, and
   * redacting them would strip the clinical content this payload exists to carry.
   */
  private replacePatterns(
    text: string,
    anchor: Date,
    bump: (category: IdentifierCategory, by?: number) => void,
  ): string {
    let out = text;
    for (const match of findEmails(out)) {
      if (!out.includes(match.value)) continue;
      out = out.split(match.value).join(EMAIL_TOKEN);
      bump('EMAIL');
    }
    for (const match of findTextDates(out)) {
      if (!out.includes(match.value)) continue;
      out = out.split(match.value).join(relativeDayToken(daysBefore(anchor, match.date)));
      bump('EXACT_DATE');
    }
    for (const run of findDigitRuns(out)) {
      if (run.kind === 'UNCLASSIFIED' || !out.includes(run.value)) continue;
      out = out.split(run.value).join(run.kind === 'PHONE' ? PHONE_TOKEN : ID_TOKEN);
      bump(run.kind === 'PHONE' ? 'PHONE' : 'NATIONAL_ID');
    }
    return out;
  }

  /**
   * Re-runs every detector over the minimized text, plus a search for each known original.
   *
   * This is the check that decides whether a provider call happens. It is deliberately the same
   * detectors rather than a cheaper second rule: a scan that looked for less than the replacement
   * layer did would pass exactly the cases the replacement layer got wrong.
   */
  private residualScan(
    sections: ReadonlyArray<{ key: string; text: string }>,
    known: readonly KnownValue[],
    categoryByToken: ReadonlyMap<string, IdentifierCategory>,
  ): IdentifierCategory | null {
    for (const section of sections) {
      // Placeholders are removed first so a detector cannot match the token it just produced.
      const stripped = toLatinDigits(section.text).replace(ANY_TOKEN_RE, ' ');
      if (findEmails(stripped).length > 0) return 'EMAIL';
      if (findTextDates(stripped).length > 0) return 'EXACT_DATE';
      for (const run of findDigitRuns(stripped)) {
        if (run.kind === 'PHONE') return 'PHONE';
        if (run.kind === 'ID') return 'NATIONAL_ID';
      }
      for (const value of known) {
        if (replaceWord(stripped, value.needle, '').count > 0) return value.category;
      }
      for (const [token] of replaceBySkeleton(stripped, this.nameSkeletons(known)).counts) {
        return categoryByToken.get(token) ?? 'PATIENT_NAME';
      }
    }
    return null;
  }

  /**
   * Maps only placeholders that stood for exactly one value.
   *
   * Where a token covered several different originals, restoring it would put one patient's phone
   * number where another's belonged. An unmapped token becomes a visible placeholder and a low
   * confidence mark, which is the honest outcome.
   */
  private tokenMap(known: readonly KnownValue[]): TokenMap {
    const originalsByToken = new Map<string, Set<string>>();
    for (const value of known) {
      const set = originalsByToken.get(value.token) ?? new Set<string>();
      set.add(value.original);
      originalsByToken.set(value.token, set);
    }
    const map = new TokenMap();
    for (const [token, originals] of originalsByToken) {
      if (originals.size === 1) map.set(token, [...originals][0]!);
    }
    return map;
  }

  /**
   * Restores one piece of model output (§5.4).
   *
   * Relative days become local dates again, mapped tokens become their originals, and anything else
   * is left exactly as the model wrote it. `unresolved` is what the caller turns into
   * `confidence='LOW'`: a token the model produced that this service never issued is a hallucination,
   * and guessing at what it meant would be worse than showing it.
   */
  restoreText(
    text: string,
    tokenMap: TokenMap,
    encounterAnchorDate: string,
  ): { text: string; unresolved: string[] } {
    const anchor = parseDate(encounterAnchorDate);
    const unresolved: string[] = [];
    let out = text.replace(RELATIVE_DAY_RE, (match, days?: string) => {
      if (!anchor) {
        unresolved.push(match);
        return match;
      }
      const date = new Date(anchor.getTime() - Number(days ?? 0) * 86_400_000);
      return date.toISOString().slice(0, 10);
    });
    out = out.replace(ANY_TOKEN_RE, (token) => {
      const original = tokenMap.get(token);
      if (original !== undefined) return original;
      unresolved.push(token);
      return token;
    });
    return { text: out, unresolved };
  }
}
