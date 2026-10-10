import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ParticipantEvent, TelemedicineProvider } from '../application/provider';
import {
  TelemedicineError,
  joinTokenExpiry,
  requireFutureExpiry,
  requireJoinable,
  type ParticipantRole,
  type SessionStatus,
} from '../domain/session';

type MockSession = {
  status: SessionStatus;
  expiresAt: Date;
  participants: Map<string, ParticipantRole>;
};
type MockToken = { sessionId: string; participantId: string; role: ParticipantRole; expiresAt: Date };
export type MockVideoScenario = 'success' | 'timeout' | 'unavailable' | 'unauthorized';

/** Local/CI adapter only. It creates no media transport and performs no external I/O. */
export class MockTelemedicineProvider implements TelemedicineProvider {
  readonly code = 'mock';
  private readonly sessions = new Map<string, MockSession>();
  private readonly requests = new Map<string, { sessionId: string; fingerprint: string }>();
  private readonly tokens = new Map<string, MockToken>();
  private readonly events = new Map<string, string>();
  private readonly scenarios: MockVideoScenario[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}

  enqueue(...scenarios: MockVideoScenario[]) {
    this.scenarios.push(...scenarios);
  }
  private scenario() {
    const scenario = this.scenarios.shift() ?? 'success';
    if (scenario === 'timeout') throw new TelemedicineError('PROVIDER_TIMEOUT');
    if (scenario === 'unavailable') throw new TelemedicineError('PROVIDER_UNAVAILABLE');
    if (scenario === 'unauthorized') throw new TelemedicineError('PARTICIPANT_UNAUTHORIZED');
  }
  private session(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new TelemedicineError('SESSION_NOT_FOUND');
    return session;
  }
  async createSession(input: Parameters<TelemedicineProvider['createSession']>[0]) {
    if (input.recordingPolicy !== 'DISABLED') throw new TelemedicineError('RECORDING_DISABLED');
    requireFutureExpiry(input.expiresAt, this.now());
    const fingerprint = input.expiresAt.toISOString();
    const previous = this.requests.get(input.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new TelemedicineError('EVENT_REPLAY_MISMATCH');
      return {
        providerSessionId: previous.sessionId,
        expiresAt: new Date(this.session(previous.sessionId).expiresAt),
      };
    }
    this.scenario();
    const id = randomUUID();
    this.sessions.set(id, {
      status: 'ACTIVE',
      expiresAt: new Date(input.expiresAt),
      participants: new Map(),
    });
    this.requests.set(input.requestId, { sessionId: id, fingerprint });
    return { providerSessionId: id, expiresAt: new Date(input.expiresAt) };
  }
  async issueParticipantToken(input: Parameters<TelemedicineProvider['issueParticipantToken']>[0]) {
    const session = this.session(input.providerSessionId);
    requireJoinable(session.status, session.expiresAt, this.now());
    if (!['DOCTOR', 'PATIENT', 'GUARDIAN'].includes(input.role) || !input.participantId)
      throw new TelemedicineError('PARTICIPANT_UNAUTHORIZED');
    const previousRole = session.participants.get(input.participantId);
    if (previousRole && previousRole !== input.role) throw new TelemedicineError('PARTICIPANT_UNAUTHORIZED');
    const expiresAt = joinTokenExpiry(input.expiresAt, session.expiresAt, this.now());
    this.scenario();
    const token = randomBytes(32).toString('base64url');
    session.participants.set(input.participantId, input.role);
    this.tokens.set(token, {
      sessionId: input.providerSessionId,
      participantId: input.participantId,
      role: input.role,
      expiresAt,
    });
    return { token, expiresAt: new Date(expiresAt) };
  }
  /** Synthetic provider-side handshake used by tests. Tokens are scoped to one session and participant. */
  authenticateToken(token: string, sessionId: string, participantId: string) {
    const value = this.tokens.get(token);
    if (!value || value.sessionId !== sessionId || value.participantId !== participantId)
      throw new TelemedicineError('PARTICIPANT_UNAUTHORIZED');
    requireJoinable(this.session(sessionId).status, this.session(sessionId).expiresAt, this.now());
    if (value.expiresAt <= this.now()) throw new TelemedicineError('JOIN_TOKEN_EXPIRED');
    return { role: value.role };
  }
  async endSession(id: string) {
    const session = this.session(id);
    if (session.status === 'ENDED') return;
    this.scenario();
    session.status = 'ENDED';
  }
  async recordParticipantEvent(input: ParticipantEvent) {
    const session = this.session(input.providerSessionId);
    if (!session.participants.has(input.participantId))
      throw new TelemedicineError('PARTICIPANT_UNAUTHORIZED');
    if (
      !['JOINED', 'LEFT', 'RECONNECTED'].includes(input.kind) ||
      !Number.isFinite(input.occurredAt.getTime())
    )
      throw new TelemedicineError('INVALID_TRANSITION');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          input.providerSessionId,
          input.participantId,
          input.kind,
          input.occurredAt.toISOString(),
        ]),
      )
      .digest('hex');
    const previous = this.events.get(input.providerEventId);
    if (previous) {
      if (previous !== fingerprint) throw new TelemedicineError('EVENT_REPLAY_MISMATCH');
      return { duplicate: true };
    }
    this.scenario();
    this.events.set(input.providerEventId, fingerprint);
    return { duplicate: false };
  }
}
