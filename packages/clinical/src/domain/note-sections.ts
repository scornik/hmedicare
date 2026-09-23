import { createHash } from 'node:crypto';
import { NOTE_SECTIONS, type NoteSection } from './encounter-transitions';

/**
 * How an encounter note behaves: limits, normalization and the content hash frozen into a signature.
 * The section set itself is next door with the transitions, because the lifecycle refers to it too.
 *
 * The set is fixed and documented. A free-form note would be easier to build and much worse to read back:
 * a doctor looking at last month's visit wants to find the plan without reading the whole account of it,
 * and a later stage cannot project what it cannot locate.
 */
export type { NoteSection };

/** Column names, for the places that write SQL rather than Prisma. */
export const NOTE_SECTION_COLUMNS: Readonly<Record<NoteSection, string>> = {
  chiefComplaint: 'chief_complaint',
  history: 'history',
  examination: 'examination',
  assessment: 'assessment',
  plan: 'plan',
};

/**
 * Per-section length limit (DATABASE §1.2: "length validated in application (default 20,000 chars)").
 *
 * Counted in characters, not bytes. A Bangla consultation note is three bytes per character in utf8mb4,
 * so a byte limit would silently give Bangla-writing doctors a third of the room — the same note, refused
 * for the language it was written in.
 */
export const MAX_SECTION_CHARS = 20_000;

/** Where a section's text came from. `ai_approved` is Stage 10; nothing in this stage can write it. */
export type NoteSectionSource = 'doctor' | 'nurse' | 'ai_approved';

export interface NoteSectionSourceEntry {
  section: NoteSection;
  source: NoteSectionSource;
  aiApprovalId?: string;
}

export type NoteSectionText = Partial<Record<NoteSection, string | null>>;

/**
 * Normalizes one section's submitted text. Trailing whitespace is dropped and an empty section becomes
 * null, so "cleared" and "never written" are the same state rather than two that look different in the
 * database and identical on screen.
 */
export function normalizeSection(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.replace(/[ \t]+$/gm, '').trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** The sections a save is allowed to carry, normalized. Unknown keys are rejected by the DTO, not here. */
export function normalizeSections(input: NoteSectionText): Record<NoteSection, string | null> {
  const out = {} as Record<NoteSection, string | null>;
  for (const section of NOTE_SECTIONS) out[section] = normalizeSection(input[section]);
  return out;
}

/** The sections that exceed the limit, so the error can name all of them at once rather than one per retry. */
export function oversizedSections(input: NoteSectionText): NoteSection[] {
  return NOTE_SECTIONS.filter((s) => {
    const v = input[s];
    return typeof v === 'string' && [...v].length > MAX_SECTION_CHARS;
  });
}

/** True when every section is empty: an untouched draft, which is not worth signing. */
export function isEmptyNote(sections: Record<NoteSection, string | null>): boolean {
  return NOTE_SECTIONS.every((s) => sections[s] === null);
}

/**
 * The content hash frozen into a signed revision. It covers the sections and the schema version and
 * nothing else — not the revision number, not the signer, not the time. Those live in the row and are
 * covered by the row hash. Keeping them out means two revisions with identical text hash identically,
 * which is how "this correction changed the reason, not the record" becomes checkable rather than claimed.
 */
export function noteContentSha256(input: {
  sections: Record<NoteSection, string | null>;
  extensions: unknown;
  schemaVersion: number;
}): string {
  const canonical = {
    schemaVersion: input.schemaVersion,
    sections: Object.fromEntries(NOTE_SECTIONS.map((s) => [s, input.sections[s]])),
    extensions: input.extensions ?? null,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** The chain key for an encounter's signed revisions: one chain per encounter (DATABASE §3.7). */
export function noteChainKey(tenantId: string, encounterId: string): string {
  return `encounter_note:${tenantId}:${encounterId}`;
}
