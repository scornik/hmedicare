/**
 * Encounter lifecycle (DATABASE-IMPLEMENTATION §3.7, DOMAIN-SERVICE-CONTRACTS). Kept as data rather than
 * as branches in the service, so the whole matrix can be read at once and tested exhaustively — the same
 * shape as the Stage 5 serial transitions.
 */
export const ENCOUNTER_STATUSES = ['IN_PROGRESS', 'INTERRUPTED', 'COMPLETED', 'ENTERED_IN_ERROR'] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

export const ENCOUNTER_COMMANDS = ['interrupt', 'resume', 'complete', 'enter_in_error'] as const;
export type EncounterCommand = (typeof ENCOUNTER_COMMANDS)[number];

/**
 * A completed encounter is terminal for everything except being voided: a consultation that happened
 * cannot un-happen, but it can turn out to have been recorded against the wrong patient, and that has to
 * be correctable. `ENTERED_IN_ERROR` is the only exit, it demands a reason, and the row stays for the
 * audit trail rather than being deleted.
 */
export const ENCOUNTER_TRANSITIONS: Readonly<
  Record<EncounterStatus, Partial<Record<EncounterCommand, EncounterStatus>>>
> = {
  IN_PROGRESS: {
    interrupt: 'INTERRUPTED',
    complete: 'COMPLETED',
    enter_in_error: 'ENTERED_IN_ERROR',
  },
  // Resume returns it to the room; completing straight from interrupted is allowed because a doctor who
  // stepped out and finished by phone should not have to re-enter the room to close the record.
  INTERRUPTED: {
    resume: 'IN_PROGRESS',
    complete: 'COMPLETED',
    enter_in_error: 'ENTERED_IN_ERROR',
  },
  COMPLETED: { enter_in_error: 'ENTERED_IN_ERROR' },
  ENTERED_IN_ERROR: {},
};

export function encounterTransition(
  from: EncounterStatus,
  command: EncounterCommand,
): EncounterStatus | null {
  return ENCOUNTER_TRANSITIONS[from][command] ?? null;
}

/** Statuses that hold the serial in consultation; exactly these keep `uq_encounters_serial`. */
export const LIVE_ENCOUNTER_STATUSES: ReadonlySet<EncounterStatus> = new Set<EncounterStatus>([
  'IN_PROGRESS',
  'INTERRUPTED',
  'COMPLETED',
]);

/** The note sections the domain model defines. No others are accepted, and none is mandatory (see ADR).
 * Everything else about a note — limits, normalization, the signed content hash — is in `note-sections.ts`. */
export const NOTE_SECTIONS = ['chiefComplaint', 'history', 'examination', 'assessment', 'plan'] as const;
export type NoteSection = (typeof NOTE_SECTIONS)[number];
