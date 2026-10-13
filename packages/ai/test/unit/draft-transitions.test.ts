import { describe, expect, it } from 'vitest';
import {
  AIDraftTransitionError,
  type AISuggestionStatus,
  type SuggestionDecision,
  TERMINAL_SUGGESTION_STATUSES,
  draftAcceptsReview,
  draftShouldClose,
  nextSuggestionStatus,
} from '../../src/public/index';

/**
 * Draft and suggestion transitions (AI-002, AI-IMPLEMENTATION §7.1–§7.2).
 *
 * The machine's shape is the point: a doctor may change their mind as often as they like while the
 * draft is open, and none of that touches a chart. The single irreversible step is the one that writes
 * a clinical record, and it is reachable only from a decision the doctor already made.
 */
describe('nextSuggestionStatus', () => {
  it.each([
    ['PENDING', 'ACCEPT', 'ACCEPTED'],
    ['PENDING', 'EDIT', 'EDITED'],
    ['PENDING', 'REJECT', 'REJECTED'],
    ['PENDING', 'IGNORE', 'IGNORED'],
    ['ACCEPTED', 'EDIT', 'EDITED'],
    ['EDITED', 'ACCEPT', 'ACCEPTED'],
    ['REJECTED', 'REOPEN', 'PENDING'],
    ['IGNORED', 'REOPEN', 'PENDING'],
  ] as [AISuggestionStatus, SuggestionDecision, AISuggestionStatus][])(
    '%s + %s → %s',
    (status, decision, expected) => {
      expect(nextSuggestionStatus(status, decision)).toBe(expected);
    },
  );

  it('refuses to review an approved suggestion', () => {
    // The only status backed by a clinical record. Undoing it is a clinical correction — voiding the
    // diagnosis, or a new note revision — not a review decision.
    for (const decision of ['ACCEPT', 'EDIT', 'REJECT', 'IGNORE', 'REOPEN'] as SuggestionDecision[]) {
      expect(() => nextSuggestionStatus('APPROVED', decision)).toThrow(AIDraftTransitionError);
    }
  });

  it('refuses a reopen of something already waiting', () => {
    // Reopening an accepted suggestion would mean nothing: it is already in front of the doctor.
    for (const status of ['PENDING', 'ACCEPTED', 'EDITED'] as AISuggestionStatus[]) {
      expect(() => nextSuggestionStatus(status, 'REOPEN')).toThrow(AIDraftTransitionError);
    }
  });

  it('refuses a repeat of the same dismissal', () => {
    // Not an error a client should hit, and succeeding silently would move `reviewed_at` for a
    // decision nobody made twice.
    expect(() => nextSuggestionStatus('REJECTED', 'REJECT')).toThrow(AIDraftTransitionError);
    expect(() => nextSuggestionStatus('IGNORED', 'IGNORE')).toThrow(AIDraftTransitionError);
  });

  it('allows a dismissal to be changed to the other kind', () => {
    // Rejecting what was ignored is a real decision: ignored means "not now", rejected means "no".
    expect(nextSuggestionStatus('IGNORED', 'REJECT')).toBe('REJECTED');
    expect(nextSuggestionStatus('REJECTED', 'IGNORE')).toBe('IGNORED');
  });

  it('never reaches APPROVED', () => {
    // Approval is a transaction in the clinical context, not a review decision, so no decision here
    // can produce it.
    const reachable = new Set<AISuggestionStatus>();
    for (const status of ['PENDING', 'ACCEPTED', 'EDITED', 'REJECTED', 'IGNORED'] as const) {
      for (const decision of ['ACCEPT', 'EDIT', 'REJECT', 'IGNORE', 'REOPEN'] as const) {
        try {
          reachable.add(nextSuggestionStatus(status, decision));
        } catch {
          // Refused transitions are the subject of the cases above.
        }
      }
    }
    expect([...reachable].sort()).toEqual(['ACCEPTED', 'EDITED', 'IGNORED', 'PENDING', 'REJECTED']);
  });
});

describe('draftAcceptsReview', () => {
  it('accepts an open draft and refuses a finished one', () => {
    expect(draftAcceptsReview('READY_FOR_REVIEW')).toBe(true);
    expect(draftAcceptsReview('IN_REVIEW')).toBe(true);
    // An expired draft is about a consultation nobody is in; a closed one is finished.
    expect(draftAcceptsReview('CLOSED')).toBe(false);
    expect(draftAcceptsReview('EXPIRED')).toBe(false);
  });
});

describe('draftShouldClose', () => {
  it('closes when every suggestion is terminal', () => {
    expect(draftShouldClose(['APPROVED', 'REJECTED', 'IGNORED'])).toBe(true);
  });

  it('stays open while anything is still waiting', () => {
    expect(draftShouldClose(['APPROVED', 'PENDING'])).toBe(false);
    // Accepted is not terminal: the doctor said yes but has not approved it into the chart.
    expect(draftShouldClose(['ACCEPTED'])).toBe(false);
    expect(draftShouldClose(['EDITED', 'REJECTED'])).toBe(false);
  });

  it('does not close an empty draft', () => {
    // A draft whose suggestions were all dropped for citing nothing still has to be seen and closed
    // by the doctor, so they know the answer was "nothing traceable" rather than "nothing happened".
    expect(draftShouldClose([])).toBe(false);
  });

  it('counts only the three terminal statuses', () => {
    expect([...TERMINAL_SUGGESTION_STATUSES].sort()).toEqual(['APPROVED', 'IGNORED', 'REJECTED']);
  });
});
