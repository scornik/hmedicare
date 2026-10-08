import { describe, expect, it } from 'vitest';
import { CreateFollowUp, dueInstant, requireTransition } from '../../src/public';
describe('follow-up dates and lifecycle', () => {
  it.each(['2024-02-29', '2026-12-31'])('accepts a real local date %s', (dueStartDate) => {
    expect(CreateFollowUp.safeParse({ dueStartDate, reason: 'review' }).success).toBe(true);
  });
  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01'])(
    'rejects an invalid local date %s',
    (dueStartDate) => {
      expect(CreateFollowUp.safeParse({ dueStartDate, reason: 'review' }).success).toBe(false);
    },
  );
  it('uses the Dhaka day boundary across a year change', () => {
    expect(dueInstant('2027-01-01').toISOString()).toBe('2026-12-31T18:00:00.000Z');
  });
  it.each(['COMPLETED', 'CANCELLED', 'MISSED'])('refuses reopening terminal state %s', (state) => {
    expect(() => requireTransition(state, 'PLANNED')).toThrow();
  });
});
