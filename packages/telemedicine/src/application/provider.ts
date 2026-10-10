import type { ParticipantEventKind, ParticipantRole } from '../domain/session';

/** Only opaque session/participant identifiers cross this boundary. Application authorization precedes it. */
export interface TelemedicineProvider {
  readonly code: string;
  createSession(input: {
    requestId: string;
    expiresAt: Date;
    recordingPolicy: 'DISABLED';
  }): Promise<{ providerSessionId: string; expiresAt: Date }>;
  issueParticipantToken(input: {
    providerSessionId: string;
    participantId: string;
    role: ParticipantRole;
    expiresAt: Date;
  }): Promise<{ token: string; expiresAt: Date }>;
  endSession(providerSessionId: string): Promise<void>;
  recordParticipantEvent(input: ParticipantEvent): Promise<{ duplicate: boolean }>;
}

export interface ParticipantEvent {
  providerEventId: string;
  providerSessionId: string;
  participantId: string;
  kind: ParticipantEventKind;
  occurredAt: Date;
}
