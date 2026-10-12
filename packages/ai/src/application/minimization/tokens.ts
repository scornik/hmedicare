/**
 * Minimization placeholders and the token map (AIPOL-004, AI-IMPLEMENTATION §5.2).
 *
 * The placeholder forms are fixed by the spec and are part of the prompt contract: a model is asked to
 * write about `⟦PATIENT⟧`, and the same token is what restore looks for in the answer. They use
 * mathematical brackets rather than ASCII ones so that a token cannot be confused with, or produced by,
 * ordinary clinical text — a doctor typing `[PATIENT]` in a note must not look like a placeholder.
 *
 * The relative-day token uses U+2212 MINUS SIGN, again exactly as specified, so a hyphen inside clinical
 * text can never be mistaken for one.
 */
export const IDENTIFIER_CATEGORIES = [
  'PATIENT_NAME',
  'RELATED_PERSON_NAME',
  'PHONE',
  'EMAIL',
  'ADDRESS',
  'NATIONAL_ID',
  'BIRTH_REGISTRATION',
  'MRN',
  'EXACT_DATE',
  'FACILITY_NAME',
  'CLINICIAN_NAME',
] as const;
export type IdentifierCategory = (typeof IDENTIFIER_CATEGORIES)[number];

export const PATIENT_TOKEN = '⟦PATIENT⟧';
export const PHONE_TOKEN = '⟦PHONE⟧';
export const EMAIL_TOKEN = '⟦EMAIL⟧';
export const ADDRESS_TOKEN = '⟦ADDRESS⟧';
export const ID_TOKEN = '⟦ID⟧';
export const MRN_TOKEN = '⟦MRN⟧';
export const FACILITY_TOKEN = '⟦FACILITY⟧';
export const CLINICIAN_TOKEN = '⟦CLINICIAN⟧';
export const relatedPersonToken = (index: number) => `⟦RELATED_${index}⟧`;

/** U+2212, not a hyphen. `days` is how many days before the anchor; 0 is the anchor itself. */
export const relativeDayToken = (days: number) => (days === 0 ? '⟦DAY0⟧' : `⟦DAY−${days}⟧`);
export const RELATIVE_DAY_RE = /⟦DAY(?:0|−(\d{1,6}))⟧/gu;

/** Matches any placeholder this service can emit, for the residual scan and for restore. */
export const ANY_TOKEN_RE = /⟦[A-Z0-9_−]+⟧/gu;

/**
 * Token → original value, for one job, in memory.
 *
 * Never persisted, logged or queued (AI-IMPLEMENTATION §5.1). `toJSON` is what enforces that in
 * practice: anything that serializes a payload — a log line, a job row, an error body — gets a marker
 * instead of the identifiers, so a mistake somewhere else cannot turn into a disclosure here.
 */
export class TokenMap {
  private readonly byToken = new Map<string, string>();

  set(token: string, original: string): this {
    if (!this.byToken.has(token)) this.byToken.set(token, original);
    return this;
  }

  get(token: string): string | undefined {
    return this.byToken.get(token);
  }

  has(token: string): boolean {
    return this.byToken.has(token);
  }

  get size(): number {
    return this.byToken.size;
  }

  /** The original values, for the residual scan only. */
  originals(): readonly string[] {
    return [...this.byToken.values()];
  }

  toJSON(): string {
    return '[token map withheld]';
  }
}
