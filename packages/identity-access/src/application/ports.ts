/** Ports of the identity-access context (AUTH-IMPLEMENTATION.md §1). */

export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  /** True when the stored hash uses parameters other than the configured ones (rehash on login). */
  needsRehash(hash: string): boolean;
}

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
  tokenVersion: number;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

export interface AccessTokenPort {
  issue(claims: AccessTokenClaims): Promise<IssuedAccessToken>;
  /** Throws AppError UNAUTHENTICATED on any signature/claim problem. */
  verify(token: string): Promise<AccessTokenClaims>;
}

/** OTP delivery outcomes (ADR-018 §4). */
export type OtpDeliveryOutcome = 'ACCEPTED' | 'REJECTED' | 'PROVIDER_UNAVAILABLE' | 'UNKNOWN_OUTCOME';

export interface OtpMessage {
  challengeId: string;
  /** E.164 destination; never logged. */
  phoneE164: string;
  code: string;
  purpose: 'LOGIN' | 'PHONE_VERIFY' | 'RECOVERY';
  locale: 'bn-BD' | 'en-BD';
  ttlSeconds: number;
}

/**
 * OtpDeliveryPort (renamed from OtpProvider, ADR-018 §1). Called synchronously after the challenge commit;
 * implementations never throw for provider failures and never log the code or phone.
 */
export interface OtpDeliveryPort {
  send(message: OtpMessage): Promise<{ outcome: OtpDeliveryOutcome; errorClass?: string }>;
}

/**
 * Password reset delivery. Email is outside Stage 4 (communications beyond OTP/SMS), so only the mock
 * inbox exists; deployed environments get a NoopPasswordResetNotifier until the email adapter lands.
 */
export interface PasswordResetNotifierPort {
  send(message: { userId: string; token: string; expiresAt: Date; locale: 'bn-BD' | 'en-BD' }): Promise<void>;
}
