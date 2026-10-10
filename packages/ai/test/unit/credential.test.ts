import { describe, expect, it } from 'vitest';
import {
  AI_CREDENTIAL_STATUSES,
  AICredentialTransitionError,
  nextAICredentialStatus,
  type AICredentialStatus,
  type CredentialAction,
} from '../../src/public';

describe('AI credential lifecycle', () => {
  it('validates every state/action combination against the documented graph', () => {
    const actions: CredentialAction[] = [
      'VALIDATION_SUCCEEDED',
      'INVALID_CREDENTIAL',
      'QUOTA_EXHAUSTED',
      'REVALIDATE',
      'DISABLE',
      'ENABLE',
      'REVOKE',
    ];
    const graph: Record<AICredentialStatus, Partial<Record<CredentialAction, AICredentialStatus>>> = {
      PENDING_VALIDATION: {
        VALIDATION_SUCCEEDED: 'ACTIVE',
        INVALID_CREDENTIAL: 'INVALID',
        QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
        DISABLE: 'DISABLED',
        REVOKE: 'REVOKED',
      },
      ACTIVE: {
        INVALID_CREDENTIAL: 'INVALID',
        QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
        REVALIDATE: 'PENDING_VALIDATION',
        DISABLE: 'DISABLED',
        REVOKE: 'REVOKED',
      },
      INVALID: { REVALIDATE: 'PENDING_VALIDATION', DISABLE: 'DISABLED', REVOKE: 'REVOKED' },
      QUOTA_EXHAUSTED: { REVALIDATE: 'PENDING_VALIDATION', DISABLE: 'DISABLED', REVOKE: 'REVOKED' },
      DISABLED: { ENABLE: 'PENDING_VALIDATION', REVOKE: 'REVOKED' },
      REVOKED: {},
    };
    for (const state of AI_CREDENTIAL_STATUSES) {
      for (const action of actions) {
        const expected = graph[state][action];
        if (expected) expect(nextAICredentialStatus(state, action)).toBe(expected);
        else expect(() => nextAICredentialStatus(state, action)).toThrow(AICredentialTransitionError);
      }
    }
  });
  it('cannot revive a revoked credential or directly activate a disabled one', () => {
    const revoked = nextAICredentialStatus('ACTIVE', 'REVOKE');
    expect(() => nextAICredentialStatus(revoked, 'ENABLE')).toThrow();
    expect(() => nextAICredentialStatus(revoked, 'REVALIDATE')).toThrow();
    expect(() => nextAICredentialStatus('DISABLED', 'VALIDATION_SUCCEEDED')).toThrow();
    expect(nextAICredentialStatus('DISABLED', 'ENABLE')).toBe('PENDING_VALIDATION');
  });
});
