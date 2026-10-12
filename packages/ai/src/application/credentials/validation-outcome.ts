import type { AIErrorClass, AIProviderResult } from '../providers/ai-provider-port';
import type { DeclaredTier } from '../policy/effective-policy';
import type { CredentialAction } from '../../domain/credential';

/**
 * What a validation attempt means for the credential (AICRED-004, ADR-017 §4).
 *
 * Kept pure and separate from the store so the mapping can be read, and tested, without a database or
 * a provider. The mapping is the whole substance of the job: a credential's status is what every later
 * policy decision reads, so a provider answer landing in the wrong status is either a key that silently
 * stops working or a key that is trusted when the provider has rejected it.
 *
 * Three outcomes are distinguished on purpose, because conflating them is the usual bug:
 *
 * - `SETTLE` — the provider gave a definite answer about the credential. Record it and stop.
 * - `RESCHEDULE` — the provider refused for now and said when. The status does not move, and the
 *   attempt is given back rather than burning the retry budget on a wait the provider asked for.
 * - `RETRY` — the attempt told us nothing about the credential (a transport failure, a timeout, an
 *   unparseable body). The status must not move, because `INVALID` here would disable a working key on
 *   a network blip.
 */
export type ValidationDecision =
  | {
      kind: 'SETTLE';
      action: CredentialAction;
      /** True only where the provider reported a tier that agreed with the declaration. */
      tierConfirmed?: boolean;
      errorClass?: AIErrorClass;
      reason?: string;
    }
  | { kind: 'RESCHEDULE'; errorClass: AIErrorClass; retryAfterSeconds: number }
  | { kind: 'RETRY'; errorClass: AIErrorClass };

/** Used when a provider rate-limits without saying when it will stop. */
export const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 15 * 60;

export function decideValidationOutcome(input: {
  declaredTier: DeclaredTier;
  result: AIProviderResult<{ tierSignal?: DeclaredTier }>;
}): ValidationDecision {
  const { declaredTier, result } = input;
  if (result.outcome === 'OK') {
    const signal = result.value.tierSignal;
    if (signal && signal !== declaredTier) {
      // ADR-017 §3: where a reliable signal exists and contradicts the declaration, the credential
      // cannot activate. Activating on the provider's tier instead would apply one set of data-use
      // terms to a credential the doctor acknowledged under another.
      return { kind: 'SETTLE', action: 'INVALID_CREDENTIAL', errorClass: 'TIER_MISMATCH' };
    }
    // `tierConfirmed` only where a signal agreed. Absent a signal the declaration stands and the UI
    // keeps saying so ("tier self-declared"), because a confirmation nobody made must not be shown.
    return { kind: 'SETTLE', action: 'VALIDATION_SUCCEEDED', tierConfirmed: signal !== undefined };
  }

  switch (result.errorClass) {
    case 'INVALID_CREDENTIAL':
      return { kind: 'SETTLE', action: 'INVALID_CREDENTIAL', errorClass: 'INVALID_CREDENTIAL' };
    case 'TIER_MISMATCH':
      return { kind: 'SETTLE', action: 'INVALID_CREDENTIAL', errorClass: 'TIER_MISMATCH' };
    case 'RATE_LIMITED':
      // The status does not move. A rate limit says nothing about the credential, and waiting is what
      // the provider asked for — so the attempt is given back rather than spent.
      return {
        kind: 'RESCHEDULE',
        errorClass: 'RATE_LIMITED',
        retryAfterSeconds: result.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_RETRY_SECONDS,
      };
    case 'QUOTA_EXHAUSTED':
      // Settles. A spent quota is a state of the account that no wait inside one job will clear, and
      // the doctor's screen should say so rather than showing a key stuck in validation.
      return { kind: 'SETTLE', action: 'QUOTA_EXHAUSTED', errorClass: 'QUOTA_EXHAUSTED' };
    case 'MODEL_UNAVAILABLE':
    case 'CONTENT_BLOCKED':
    case 'SCHEMA_INVALID':
      // Validation asks for nothing clinical and nothing schema-constrained, so these describe the
      // provider's surface rather than the key. Retrying a working key costs little; disabling it on
      // this evidence would cost the doctor their configuration.
      return { kind: 'RETRY', errorClass: result.errorClass };
    case 'PROVIDER_ERROR':
    case 'PROVIDER_UNAVAILABLE':
    case 'UNKNOWN_OUTCOME':
      return { kind: 'RETRY', errorClass: result.errorClass };
  }
}
