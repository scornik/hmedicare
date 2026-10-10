export type SessionStatus = 'PENDING' | 'ACTIVE' | 'ENDED' | 'FAILED' | 'EXPIRED';
export type ParticipantRole = 'DOCTOR' | 'PATIENT' | 'GUARDIAN';
export type ParticipantEventKind = 'JOINED' | 'LEFT' | 'RECONNECTED';
export type TelemedicineErrorCode =
  | 'INVALID_TRANSITION'
  | 'INVALID_EXPIRY'
  | 'RECORDING_DISABLED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_NOT_ACTIVE'
  | 'SESSION_EXPIRED'
  | 'PARTICIPANT_UNAUTHORIZED'
  | 'JOIN_TOKEN_EXPIRED'
  | 'EVENT_REPLAY_MISMATCH'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE';

export class TelemedicineError extends Error {
  constructor(readonly code: TelemedicineErrorCode) {
    super(code);
    this.name = 'TelemedicineError';
  }
}

const transitions: Record<SessionStatus, readonly SessionStatus[]> = {
  PENDING: ['ACTIVE', 'FAILED'],
  ACTIVE: ['ENDED', 'EXPIRED'],
  ENDED: [],
  FAILED: [],
  EXPIRED: [],
};

export function requireSessionTransition(current: SessionStatus, next: SessionStatus): void {
  if (!transitions[current]?.includes(next)) throw new TelemedicineError('INVALID_TRANSITION');
}

export function requireFutureExpiry(expiresAt: Date, now: Date): void {
  if (!Number.isFinite(expiresAt.getTime()) || !Number.isFinite(now.getTime()) || expiresAt <= now)
    throw new TelemedicineError('INVALID_EXPIRY');
}

export function requireJoinable(status: SessionStatus, expiresAt: Date, now: Date): void {
  if (status !== 'ACTIVE') throw new TelemedicineError('SESSION_NOT_ACTIVE');
  if (!Number.isFinite(expiresAt.getTime()) || !Number.isFinite(now.getTime()))
    throw new TelemedicineError('INVALID_EXPIRY');
  if (expiresAt <= now) throw new TelemedicineError('SESSION_EXPIRED');
}

/** Application policy: tokens cannot outlive their session or a five-minute issuance window. */
export const MAX_JOIN_TOKEN_SECONDS = 300;
export function joinTokenExpiry(requested: Date, sessionExpiry: Date, now: Date): Date {
  requireFutureExpiry(requested, now);
  requireFutureExpiry(sessionExpiry, now);
  return new Date(
    Math.min(requested.getTime(), sessionExpiry.getTime(), now.getTime() + MAX_JOIN_TOKEN_SECONDS * 1000),
  );
}
