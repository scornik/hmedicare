import { describe, expect, it } from 'vitest';
import { transactionalSmsDecision } from '../../src/public';
const now = new Date('2026-10-10T04:00:00Z');
const history = { unknownOutcomes: 0, unavailableFailures: 0, balanceSuspendedSince: null };
describe('transactional SMS decision policy', () => {
  it('never interprets acceptance as verified delivery', () => {
    expect(
      transactionalSmsDecision({ outcome: 'ACCEPTED', encoding: 'text', segmentsEstimated: 1 }, history, now),
    ).toMatchObject({
      communicationStatus: 'SENT',
      attemptStatus: 'SENT',
      retry: 'NONE',
      possibleDuplicate: false,
    });
  });
  it('allows one unknown retry and marks its possible duplicate; the second unknown stops', () => {
    const result = { outcome: 'UNKNOWN_OUTCOME', errorClass: 'UNKNOWN_OUTCOME' } as const;
    expect(transactionalSmsDecision(result, history, now)).toMatchObject({
      communicationStatus: 'RETRY_SCHEDULED',
      attemptStatus: 'UNKNOWN',
      retry: 'ONCE',
      possibleDuplicate: false,
    });
    expect(transactionalSmsDecision(result, { ...history, unknownOutcomes: 1 }, now)).toMatchObject({
      communicationStatus: 'SENT',
      attemptStatus: 'UNKNOWN',
      retry: 'NONE',
      possibleDuplicate: true,
    });
    expect(
      transactionalSmsDecision(
        { outcome: 'ACCEPTED', encoding: 'text', segmentsEstimated: 1 },
        { ...history, unknownOutcomes: 1 },
        now,
      ).possibleDuplicate,
    ).toBe(true);
  });
  it('bounds provider-unavailable retries to five failures', () => {
    const result = { outcome: 'PROVIDER_UNAVAILABLE', errorClass: 'PROVIDER_UNAVAILABLE' } as const;
    expect(transactionalSmsDecision(result, { ...history, unavailableFailures: 3 }, now).retry).toBe(
      'BACKOFF',
    );
    expect(transactionalSmsDecision(result, { ...history, unavailableFailures: 4 }, now)).toMatchObject({
      communicationStatus: 'FAILED',
      retry: 'NONE',
    });
  });
  it('suspends an empty credential and stops waiting after 24 hours', () => {
    const result = { outcome: 'REJECTED', errorClass: 'INSUFFICIENT_BALANCE' } as const;
    expect(transactionalSmsDecision(result, history, now)).toMatchObject({
      communicationStatus: 'RETRY_SCHEDULED',
      retry: 'BALANCE_CHECK',
      credentialAction: 'SUSPEND_BALANCE',
    });
    expect(
      transactionalSmsDecision(
        result,
        { ...history, balanceSuspendedSince: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        now,
      ),
    ).toMatchObject({ communicationStatus: 'FAILED', retry: 'NONE' });
  });
  it('marks bad credentials invalid and treats destination/transport rejection as permanent', () => {
    for (const errorClass of ['INVALID_CREDENTIAL', 'SENDER_ID_INVALID'] as const)
      expect(transactionalSmsDecision({ outcome: 'REJECTED', errorClass }, history, now)).toMatchObject({
        credentialAction: 'INVALID',
        retry: 'NONE',
      });
    for (const errorClass of [
      'DESTINATION_UNSUPPORTED',
      'INVALID_DESTINATION_FORMAT',
      'INVALID_REQUEST',
      'TRANSPORT_REFUSED',
    ] as const)
      expect(transactionalSmsDecision({ outcome: 'REJECTED', errorClass }, history, now)).toMatchObject({
        communicationStatus: 'FAILED',
        credentialAction: 'NONE',
        retry: 'NONE',
      });
  });
});
