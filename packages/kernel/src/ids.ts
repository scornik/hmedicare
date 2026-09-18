import { uuidv7 } from 'uuidv7';

/**
 * Application-generated UUIDv7 identifiers (ADR-014): stored as VARCHAR(36) ascii_bin, never CHAR.
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type Id = Brand<string, 'Id'>;
export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type MembershipId = Brand<string, 'MembershipId'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function newId<T extends string = Id>(): T {
  return uuidv7() as T;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Returns the embedded millisecond timestamp of a UUIDv7 (used only for diagnostics). */
export function uuidv7Timestamp(id: string): number {
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
