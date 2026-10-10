import { describe, expect, it } from 'vitest';
import {
  MockTelemedicineProvider,
  joinTokenExpiry,
  requireJoinable,
  requireSessionTransition,
  type ParticipantEvent,
  type SessionStatus,
} from '../../src/public';

const start = new Date('2026-10-10T10:00:00Z');
const plus = (seconds: number) => new Date(start.getTime() + seconds * 1000);

async function fixture(expiry = 3600) {
  let now = start;
  const provider = new MockTelemedicineProvider(() => new Date(now));
  const session = await provider.createSession({
    requestId: 'synthetic-request',
    expiresAt: plus(expiry),
    recordingPolicy: 'DISABLED',
  });
  const participantId = 'synthetic-participant';
  const token = await provider.issueParticipantToken({
    providerSessionId: session.providerSessionId,
    participantId,
    role: 'DOCTOR',
    expiresAt: plus(600),
  });
  return {
    provider,
    session,
    token,
    participantId,
    advance: (seconds: number) => {
      now = plus(seconds);
    },
  };
}

describe('remote session lifecycle policy', () => {
  it('permits only creation outcomes and explicit terminal transitions', () => {
    const statuses: SessionStatus[] = ['PENDING', 'ACTIVE', 'ENDED', 'FAILED', 'EXPIRED'];
    const allowed = new Set(['PENDING:ACTIVE', 'PENDING:FAILED', 'ACTIVE:ENDED', 'ACTIVE:EXPIRED']);
    for (const from of statuses)
      for (const to of statuses)
        if (allowed.has(`${from}:${to}`)) expect(() => requireSessionTransition(from, to)).not.toThrow();
        else expect(() => requireSessionTransition(from, to)).toThrow('INVALID_TRANSITION');
  });
  it('caps join tokens to five minutes or the remaining session lifetime', () => {
    expect(joinTokenExpiry(plus(900), plus(3600), start)).toEqual(plus(300));
    expect(joinTokenExpiry(plus(900), plus(45), start)).toEqual(plus(45));
    expect(joinTokenExpiry(plus(20), plus(3600), start)).toEqual(plus(20));
    expect(() => joinTokenExpiry(start, plus(3600), start)).toThrow('INVALID_EXPIRY');
    expect(() => joinTokenExpiry(plus(90), new Date('invalid'), start)).toThrow('INVALID_EXPIRY');
  });
  it('stops joins at the exact session deadline and in every inactive state', () => {
    expect(() => requireJoinable('ACTIVE', start, start)).toThrow('SESSION_EXPIRED');
    for (const status of ['PENDING', 'ENDED', 'FAILED', 'EXPIRED'] as const)
      expect(() => requireJoinable(status, plus(60), start)).toThrow('SESSION_NOT_ACTIVE');
  });
});

describe('mock remote provider', () => {
  it('replays identical session creation and rejects changed requests and recording', async () => {
    const f = await fixture();
    await expect(
      f.provider.createSession({
        requestId: 'synthetic-request',
        expiresAt: plus(3600),
        recordingPolicy: 'DISABLED',
      }),
    ).resolves.toEqual(f.session);
    await expect(
      f.provider.createSession({
        requestId: 'synthetic-request',
        expiresAt: plus(7200),
        recordingPolicy: 'DISABLED',
      }),
    ).rejects.toThrow('EVENT_REPLAY_MISMATCH');
    await expect(
      f.provider.createSession({
        requestId: 'another',
        expiresAt: plus(3600),
        recordingPolicy: 'ENABLED' as 'DISABLED',
      }),
    ).rejects.toThrow('RECORDING_DISABLED');
  });
  it('issues opaque tokens scoped to one session and participant', async () => {
    const f = await fixture();
    expect(f.token.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.token.token).not.toContain(f.participantId);
    expect(f.provider.authenticateToken(f.token.token, f.session.providerSessionId, f.participantId)).toEqual(
      { role: 'DOCTOR' },
    );
    for (const [token, session, participant] of [
      ['unknown', f.session.providerSessionId, f.participantId],
      [f.token.token, 'other-session', f.participantId],
      [f.token.token, f.session.providerSessionId, 'other-participant'],
    ])
      expect(() => f.provider.authenticateToken(token!, session!, participant!)).toThrow(
        'PARTICIPANT_UNAUTHORIZED',
      );
  });
  it('expires a token exactly at its deadline and permits a fresh reconnect token', async () => {
    const f = await fixture();
    f.advance(300);
    expect(() =>
      f.provider.authenticateToken(f.token.token, f.session.providerSessionId, f.participantId),
    ).toThrow('JOIN_TOKEN_EXPIRED');
    const refreshed = await f.provider.issueParticipantToken({
      providerSessionId: f.session.providerSessionId,
      participantId: f.participantId,
      role: 'DOCTOR',
      expiresAt: plus(900),
    });
    expect(refreshed.token).not.toBe(f.token.token);
    expect(refreshed.expiresAt).toEqual(plus(600));
    expect(
      f.provider.authenticateToken(refreshed.token, f.session.providerSessionId, f.participantId),
    ).toEqual({ role: 'DOCTOR' });
  });
  it('does not issue tokens once the session expires', async () => {
    const f = await fixture(60);
    expect(f.token.expiresAt).toEqual(plus(60));
    f.advance(60);
    await expect(
      f.provider.issueParticipantToken({
        providerSessionId: f.session.providerSessionId,
        participantId: f.participantId,
        role: 'DOCTOR',
        expiresAt: plus(120),
      }),
    ).rejects.toThrow('SESSION_EXPIRED');
  });
  it('rejects participant role changes and provider authorization failures', async () => {
    const f = await fixture();
    const input = {
      providerSessionId: f.session.providerSessionId,
      participantId: f.participantId,
      role: 'PATIENT' as const,
      expiresAt: plus(120),
    };
    await expect(f.provider.issueParticipantToken(input)).rejects.toThrow('PARTICIPANT_UNAUTHORIZED');
    f.provider.enqueue('unauthorized');
    await expect(
      f.provider.issueParticipantToken({ ...input, participantId: 'new-participant' }),
    ).rejects.toThrow('PARTICIPANT_UNAUTHORIZED');
  });
  it.each(['timeout', 'unavailable'] as const)(
    'fails creation on provider %s without reserving a successful replay',
    async (scenario) => {
      const provider = new MockTelemedicineProvider(() => start);
      provider.enqueue(scenario);
      const input = { requestId: 'request', expiresAt: plus(60), recordingPolicy: 'DISABLED' as const };
      await expect(provider.createSession(input)).rejects.toThrow(
        scenario === 'timeout' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
      );
      await expect(provider.createSession(input)).resolves.toMatchObject({ expiresAt: plus(60) });
    },
  );
  it('keeps a session usable after end failure and closes it on successful retry', async () => {
    const f = await fixture();
    f.provider.enqueue('timeout');
    await expect(f.provider.endSession(f.session.providerSessionId)).rejects.toThrow('PROVIDER_TIMEOUT');
    expect(() =>
      f.provider.authenticateToken(f.token.token, f.session.providerSessionId, f.participantId),
    ).not.toThrow();
    await f.provider.endSession(f.session.providerSessionId);
    await f.provider.endSession(f.session.providerSessionId);
    expect(() =>
      f.provider.authenticateToken(f.token.token, f.session.providerSessionId, f.participantId),
    ).toThrow('SESSION_NOT_ACTIVE');
  });
  it('deduplicates participant events and rejects changed replays', async () => {
    const f = await fixture();
    const event: ParticipantEvent = {
      providerEventId: 'provider-event',
      providerSessionId: f.session.providerSessionId,
      participantId: f.participantId,
      kind: 'JOINED',
      occurredAt: start,
    };
    await expect(f.provider.recordParticipantEvent(event)).resolves.toEqual({ duplicate: false });
    await expect(
      f.provider.recordParticipantEvent({
        occurredAt: start,
        kind: 'JOINED',
        participantId: f.participantId,
        providerSessionId: f.session.providerSessionId,
        providerEventId: 'provider-event',
      }),
    ).resolves.toEqual({ duplicate: true });
    await expect(f.provider.recordParticipantEvent({ ...event, kind: 'LEFT' })).rejects.toThrow(
      'EVENT_REPLAY_MISMATCH',
    );
    await expect(
      f.provider.recordParticipantEvent({ ...event, providerEventId: 'reconnect', kind: 'RECONNECTED' }),
    ).resolves.toEqual({ duplicate: false });
    await f.provider.endSession(f.session.providerSessionId);
    await expect(
      f.provider.recordParticipantEvent({ ...event, providerEventId: 'late-left', kind: 'LEFT' }),
    ).resolves.toEqual({ duplicate: false });
  });
  it('rejects events from participants without an issued role', async () => {
    const f = await fixture();
    await expect(
      f.provider.recordParticipantEvent({
        providerEventId: 'unknown',
        providerSessionId: f.session.providerSessionId,
        participantId: 'unknown-participant',
        kind: 'JOINED',
        occurredAt: start,
      }),
    ).rejects.toThrow('PARTICIPANT_UNAUTHORIZED');
  });
});
