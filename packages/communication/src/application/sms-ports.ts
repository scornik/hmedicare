import type { SmsEncoding } from '../domain/sms-encoding';

/** Normalized SMS error classes (ADR-018 §4). */
export type SmsErrorClass =
  | 'INVALID_CREDENTIAL'
  | 'SENDER_ID_INVALID'
  | 'INVALID_REQUEST'
  | 'DESTINATION_UNSUPPORTED'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_DESTINATION_FORMAT'
  /** Adapter refused plain HTTP in production without the flag + an unexpired GATE-SMS-HTTP decision. */
  | 'TRANSPORT_REFUSED';

/**
 * Credential handle resolved server-side (platform env account or a tenant vault row). The key is only
 * reachable inside `withKey`, so it can never be put in a payload, log or error.
 */
export interface SmsCredentialHandle {
  readonly scope: 'PLATFORM' | 'TENANT';
  readonly credentialId: string | null;
  readonly tenantId: string | null;
  readonly senderId: string;
  withKey<T>(fn: (apiKey: string) => Promise<T>): Promise<T>;
}

export type SmsSendResult =
  | { outcome: 'ACCEPTED'; providerMessageId?: string; segmentsEstimated: number; encoding: SmsEncoding }
  | { outcome: 'REJECTED'; errorClass: SmsErrorClass; providerCode?: string }
  | { outcome: 'PROVIDER_UNAVAILABLE'; errorClass: 'PROVIDER_UNAVAILABLE' }
  | { outcome: 'UNKNOWN_OUTCOME'; errorClass: 'UNKNOWN_OUTCOME' };

export type SmsBalanceResult =
  | { outcome: 'OK'; parseStatus: 'PARSED'; balance: string; currencyText: string | null }
  | { outcome: 'OK'; parseStatus: 'UNPARSED'; balance: null; currencyText: null }
  | { outcome: 'REJECTED'; errorClass: SmsErrorClass; providerCode?: string }
  | { outcome: 'ERROR'; errorClass: 'PROVIDER_UNAVAILABLE' | 'UNKNOWN_OUTCOME' };

/** SmsProvider port (ADR-018 §1). Implemented only in packages/communication-adapters/*. */
export interface SmsProvider {
  readonly code: 'zamanit' | 'mock';
  send(input: {
    credential: SmsCredentialHandle;
    /** Canonical E.164 `+8801XXXXXXXXX`. */
    destination: string;
    /** Rendered template text; never PHI. */
    text: string;
    purpose: 'OTP' | 'TRANSACTIONAL';
    correlationId: string;
  }): Promise<SmsSendResult>;
  checkBalance(credential: SmsCredentialHandle): Promise<SmsBalanceResult>;
}
