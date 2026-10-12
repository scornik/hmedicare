import { describe, expect, it } from 'vitest';
import {
  AI_CREDENTIAL_FAULTS,
  DEFAULT_RATE_LIMIT_RETRY_SECONDS,
  type AIErrorClass,
  decideValidationOutcome,
} from '../../src/public/index';

/**
 * The validation mapping (AICRED-004).
 *
 * Every error class is covered, and the classes are pinned to the three kinds rather than only spot
 * checked, because the kind is what decides whether a doctor's working key keeps working: `SETTLE`
 * moves the credential's status, `RESCHEDULE` waits without moving it, and `RETRY` moves nothing
 * because the attempt learned nothing.
 */
const ok = (tierSignal?: 'FREE' | 'PAID') =>
  ({ outcome: 'OK', value: tierSignal ? { tierSignal } : {} }) as const;
const err = (errorClass: AIErrorClass, retryAfterSeconds?: number) =>
  ({ outcome: 'ERROR', errorClass, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }) as const;

describe('decideValidationOutcome', () => {
  it('activates a credential the provider accepted', () => {
    expect(decideValidationOutcome({ declaredTier: 'FREE', result: ok() })).toEqual({
      kind: 'SETTLE',
      action: 'VALIDATION_SUCCEEDED',
      // No signal, so nothing was confirmed and the UI keeps saying "tier self-declared".
      tierConfirmed: false,
    });
  });

  it('confirms the tier only where the provider reported an agreeing one', () => {
    expect(decideValidationOutcome({ declaredTier: 'PAID', result: ok('PAID') })).toEqual({
      kind: 'SETTLE',
      action: 'VALIDATION_SUCCEEDED',
      tierConfirmed: true,
    });
  });

  it('refuses to activate when the provider contradicts the declaration', () => {
    // ADR-017 §3. Activating on the provider's tier instead would apply one set of data-use terms to
    // a credential the doctor acknowledged under another.
    expect(decideValidationOutcome({ declaredTier: 'PAID', result: ok('FREE') })).toEqual({
      kind: 'SETTLE',
      action: 'INVALID_CREDENTIAL',
      errorClass: 'TIER_MISMATCH',
    });
  });

  it.each([
    ['INVALID_CREDENTIAL', 'INVALID_CREDENTIAL'],
    ['TIER_MISMATCH', 'INVALID_CREDENTIAL'],
    ['QUOTA_EXHAUSTED', 'QUOTA_EXHAUSTED'],
  ] as [AIErrorClass, string][])('settles %s', (errorClass, action) => {
    expect(decideValidationOutcome({ declaredTier: 'FREE', result: err(errorClass) })).toEqual({
      kind: 'SETTLE',
      action,
      errorClass,
    });
  });

  it('waits the delay a rate limit carried, without moving the status', () => {
    expect(decideValidationOutcome({ declaredTier: 'FREE', result: err('RATE_LIMITED', 42) })).toEqual({
      kind: 'RESCHEDULE',
      errorClass: 'RATE_LIMITED',
      retryAfterSeconds: 42,
    });
  });

  it('falls back to a default delay when the provider named none', () => {
    const decision = decideValidationOutcome({ declaredTier: 'FREE', result: err('RATE_LIMITED') });
    expect(decision).toEqual({
      kind: 'RESCHEDULE',
      errorClass: 'RATE_LIMITED',
      retryAfterSeconds: DEFAULT_RATE_LIMIT_RETRY_SECONDS,
    });
  });

  it.each([
    'MODEL_UNAVAILABLE',
    'CONTENT_BLOCKED',
    'SCHEMA_INVALID',
    'PROVIDER_ERROR',
    'PROVIDER_UNAVAILABLE',
    'UNKNOWN_OUTCOME',
  ] as AIErrorClass[])('retries %s without moving the status', (errorClass) => {
    // None of these describes the key. `INVALID` on this evidence would disable a working credential
    // because a provider had a bad minute.
    expect(decideValidationOutcome({ declaredTier: 'FREE', result: err(errorClass) })).toEqual({
      kind: 'RETRY',
      errorClass,
    });
  });

  it('never settles on a class that is not a credential fault', () => {
    // The guard against the mapping drifting: a class may settle the credential only if it is one of
    // the classes that describe the credential rather than the request.
    const settling: AIErrorClass[] = [
      'INVALID_CREDENTIAL',
      'TIER_MISMATCH',
      'QUOTA_EXHAUSTED',
      'RATE_LIMITED',
      'MODEL_UNAVAILABLE',
      'CONTENT_BLOCKED',
      'SCHEMA_INVALID',
      'PROVIDER_ERROR',
      'PROVIDER_UNAVAILABLE',
      'UNKNOWN_OUTCOME',
    ].filter(
      (errorClass) =>
        decideValidationOutcome({ declaredTier: 'FREE', result: err(errorClass as AIErrorClass) }).kind ===
        'SETTLE',
    ) as AIErrorClass[];
    for (const errorClass of settling) expect(AI_CREDENTIAL_FAULTS).toContain(errorClass);
  });
});
