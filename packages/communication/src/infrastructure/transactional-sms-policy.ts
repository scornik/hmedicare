import type { SmsSendResult } from '../application/sms-ports';

export type TransactionalSmsDecision = {
  communicationStatus: 'SENT' | 'FAILED' | 'RETRY_SCHEDULED';
  attemptStatus: 'SENT' | 'FAILED' | 'UNKNOWN';
  retry: 'NONE' | 'BACKOFF' | 'BALANCE_CHECK' | 'ONCE';
  possibleDuplicate: boolean;
  credentialAction: 'NONE' | 'SUSPEND_BALANCE' | 'INVALID';
};
/** SMS-006 outcome policy. OTP uses its own synchronous policy and never calls this function. */
export function transactionalSmsDecision(
  result: SmsSendResult,
  history: { unknownOutcomes: number; unavailableFailures: number; balanceSuspendedSince: Date | null },
  now: Date,
): TransactionalSmsDecision {
  const base = {
    communicationStatus: 'FAILED' as const,
    attemptStatus: 'FAILED' as const,
    retry: 'NONE' as const,
    possibleDuplicate: history.unknownOutcomes > 0,
    credentialAction: 'NONE' as const,
  };
  if (result.outcome === 'ACCEPTED') return { ...base, communicationStatus: 'SENT', attemptStatus: 'SENT' };
  if (result.outcome === 'UNKNOWN_OUTCOME')
    return history.unknownOutcomes === 0
      ? { ...base, communicationStatus: 'RETRY_SCHEDULED', attemptStatus: 'UNKNOWN', retry: 'ONCE' }
      : { ...base, communicationStatus: 'SENT', attemptStatus: 'UNKNOWN', possibleDuplicate: true };
  if (result.outcome === 'PROVIDER_UNAVAILABLE')
    return history.unavailableFailures < 4
      ? { ...base, communicationStatus: 'RETRY_SCHEDULED', retry: 'BACKOFF' }
      : base;
  if (result.errorClass === 'INSUFFICIENT_BALANCE')
    return history.balanceSuspendedSince &&
      now.getTime() - history.balanceSuspendedSince.getTime() >= 24 * 60 * 60 * 1000
      ? { ...base, credentialAction: 'SUSPEND_BALANCE' }
      : {
          ...base,
          communicationStatus: 'RETRY_SCHEDULED',
          retry: 'BALANCE_CHECK',
          credentialAction: 'SUSPEND_BALANCE',
        };
  if (['INVALID_CREDENTIAL', 'SENDER_ID_INVALID'].includes(result.errorClass))
    return { ...base, credentialAction: 'INVALID' };
  return base;
}
