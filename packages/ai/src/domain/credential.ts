export const AI_CREDENTIAL_STATUSES = [
  'PENDING_VALIDATION',
  'ACTIVE',
  'INVALID',
  'QUOTA_EXHAUSTED',
  'DISABLED',
  'REVOKED',
] as const;
export type AICredentialStatus = (typeof AI_CREDENTIAL_STATUSES)[number];
export type CredentialAction =
  | 'VALIDATION_SUCCEEDED'
  | 'INVALID_CREDENTIAL'
  | 'QUOTA_EXHAUSTED'
  | 'REVALIDATE'
  | 'DISABLE'
  | 'ENABLE'
  | 'REVOKE';
export class AICredentialTransitionError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
  constructor() {
    super('AI credential transition is not allowed');
    this.name = 'AICredentialTransitionError';
  }
}

/** Authorization, activation policy, row-version checks and secret tombstoning belong to the use case. */
export function nextAICredentialStatus(
  status: AICredentialStatus,
  action: CredentialAction,
): AICredentialStatus {
  if (!AI_CREDENTIAL_STATUSES.includes(status) || status === 'REVOKED')
    throw new AICredentialTransitionError();
  if (action === 'REVOKE') return 'REVOKED';
  if (action === 'DISABLE' && status !== 'DISABLED') return 'DISABLED';
  if (action === 'ENABLE' && status === 'DISABLED') return 'PENDING_VALIDATION';
  if (action === 'REVALIDATE' && ['ACTIVE', 'INVALID', 'QUOTA_EXHAUSTED'].includes(status))
    return 'PENDING_VALIDATION';
  if (action === 'VALIDATION_SUCCEEDED' && status === 'PENDING_VALIDATION') return 'ACTIVE';
  if (['PENDING_VALIDATION', 'ACTIVE'].includes(status)) {
    if (action === 'INVALID_CREDENTIAL') return 'INVALID';
    if (action === 'QUOTA_EXHAUSTED') return 'QUOTA_EXHAUSTED';
  }
  throw new AICredentialTransitionError();
}
