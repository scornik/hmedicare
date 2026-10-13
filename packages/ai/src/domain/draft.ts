/**
 * Draft and suggestion transitions (AI-002, AI-IMPLEMENTATION §7.1–§7.2).
 *
 * Pure, so the rules can be read in one place and tested without a database. The store owns
 * authorization, row versions and the clinical write; this owns only what may follow what.
 *
 * The shape of the suggestion machine is worth stating plainly. A doctor may change their mind as
 * often as they like while the draft is open — reject something and reopen it, accept it and then
 * edit it — and none of that touches a chart. The one transition that cannot be undone is the step to
 * `APPROVED`, which is exactly the step that writes a clinical record, and it is reachable only from
 * `ACCEPTED` or `EDITED`: a doctor cannot approve something they have not first said yes to.
 */
export const AI_DRAFT_STATUSES = ['READY_FOR_REVIEW', 'IN_REVIEW', 'CLOSED', 'EXPIRED'] as const;
export type AIDraftStatus = (typeof AI_DRAFT_STATUSES)[number];

export const AI_SUGGESTION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'EDITED',
  'REJECTED',
  'IGNORED',
  'APPROVED',
] as const;
export type AISuggestionStatus = (typeof AI_SUGGESTION_STATUSES)[number];

/** A decision a doctor records. `REOPEN` returns a dismissed suggestion to review. */
export type SuggestionDecision = 'ACCEPT' | 'EDIT' | 'REJECT' | 'IGNORE' | 'REOPEN';

/** Statuses from which nothing further is expected of the doctor. */
export const TERMINAL_SUGGESTION_STATUSES: readonly AISuggestionStatus[] = [
  'APPROVED',
  'REJECTED',
  'IGNORED',
];

export class AIDraftTransitionError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
  constructor(message = 'AI draft transition is not allowed') {
    super(message);
    this.name = 'AIDraftTransitionError';
  }
}

/** A draft accepts review only while it is open. */
export function draftAcceptsReview(status: AIDraftStatus): boolean {
  return status === 'READY_FOR_REVIEW' || status === 'IN_REVIEW';
}

/**
 * The next suggestion status for a decision.
 *
 * Deliberately refuses rather than ignoring an impossible decision: a request to reject something
 * already approved is a client working from a stale screen, and silently succeeding would tell the
 * doctor their rejection took effect on a record that is already in the chart.
 */
export function nextSuggestionStatus(
  status: AISuggestionStatus,
  decision: SuggestionDecision,
): AISuggestionStatus {
  if (status === 'APPROVED') {
    // Terminal, and the only status backed by a clinical record. Undoing it is a clinical correction
    // — voiding the diagnosis or writing a new note revision — not a review decision.
    throw new AIDraftTransitionError('an approved suggestion cannot be reviewed again');
  }
  switch (decision) {
    case 'ACCEPT':
      if (['PENDING', 'ACCEPTED', 'EDITED'].includes(status)) return 'ACCEPTED';
      break;
    case 'EDIT':
      // Editing implies accepting the edited version, so it is reachable from the same places.
      if (['PENDING', 'ACCEPTED', 'EDITED'].includes(status)) return 'EDITED';
      break;
    case 'REJECT':
      if (status !== 'REJECTED') return 'REJECTED';
      break;
    case 'IGNORE':
      if (status !== 'IGNORED') return 'IGNORED';
      break;
    case 'REOPEN':
      // Only from a dismissal. Reopening an accepted suggestion would mean nothing: it is already
      // waiting for the doctor.
      if (status === 'REJECTED' || status === 'IGNORED') return 'PENDING';
      break;
  }
  throw new AIDraftTransitionError();
}

/**
 * Whether a draft should close because every suggestion is terminal.
 *
 * Automatic closing is a convenience with a sharp edge: a draft that closed itself must not be
 * reopenable by a reopen decision, or a doctor could reopen one suggestion and find the draft
 * refusing the next one. So the store checks `draftAcceptsReview` first and this only decides whether
 * the last decision finished the work.
 */
export function draftShouldClose(statuses: readonly AISuggestionStatus[]): boolean {
  return statuses.length > 0 && statuses.every((status) => TERMINAL_SUGGESTION_STATUSES.includes(status));
}
