// Public surface of the identity-access context (REPOSITORY-STRUCTURE.md §2.2).
export * from '../domain/authz/permissions';
export * from '../domain/authz/role-permissions';
export * from '../domain/authz/policy-engine';
export * from '../application/ports';
export { MockOtpDelivery } from '../infrastructure/otp-service';
export type { OtpPurpose, OtpRequestHint, OtpRequestResult } from '../infrastructure/otp-service';
export type { ClientType } from '../infrastructure/session-service';
export { Argon2idHasher, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../infrastructure/argon2-hasher';
export { PlatformOperatorService } from '../infrastructure/platform-operators';
