import { createHash } from 'node:crypto';
import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, dbErrorInfo, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { OutboxPort } from '@hmedic/jobs';
import { RemoteEncounterSource, type ClinicalAccessPolicy, type ClinicalActor } from '@hmedic/clinical';
import type { PatientContextResolver } from '@hmedic/patient';
import type { ParticipantEvent, TelemedicineProvider } from '../application/provider';
import {
  TelemedicineError,
  requireJoinable,
  type ParticipantRole,
  type SessionStatus,
} from '../domain/session';

type Session = Awaited<ReturnType<PrismaClient['telemedicineSession']['findFirstOrThrow']>>;
export interface RemotePatientActor {
  userId: string;
  tenantId: string;
  patientId: string;
  actingAs?: 'SELF' | 'GUARDIAN';
  requestId?: string;
}
type JoinActor = ClinicalActor | RemotePatientActor;
const tenantOf = (actor: JoinActor) => ('tenant' in actor ? actor.tenant.tenantId : actor.tenantId);
export const sessionView = (row: Session) => ({
  id: row.id,
  encounterId: row.encounterId,
  status: row.status,
  issuedAt: row.issuedAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
  endedReason: row.endedReason,
  recordingPolicy: 'DISABLED' as const,
  rowVersion: row.rowVersion,
});

export class TelemedicineSessionService {
  private readonly clock: Clock;
  private readonly source = new RemoteEncounterSource();
  private readonly outbox: OutboxPort;
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      audit: PrismaAuditPort;
      access: ClinicalAccessPolicy;
      patients: Pick<PatientContextResolver, 'resolve'>;
      refreshStaff(actor: ClinicalActor): Promise<ClinicalActor>;
      provider: TelemedicineProvider;
      clock?: Clock;
    },
  ) {
    this.clock = deps.clock ?? systemClock;
    this.outbox = new OutboxPort(this.clock);
  }
  private async staff(actor: ClinicalActor, encounterId: string, permission: string, assigned = false) {
    const live = await this.deps.refreshStaff(actor);
    if (!live.tenant.effectivePermissions.has(permission)) throw new AppError('FORBIDDEN');
    if (assigned) await this.deps.access.assigned(live, encounterId);
    else
      await this.deps.access.assignedOrScoped(
        ['tenant_owner', 'clinic_admin'].includes(live.tenant.role)
          ? { ...live, doctorProfileId: null }
          : live,
        encounterId,
      );
    return live;
  }
  private async authorize(
    actor: JoinActor,
    encounterId: string,
    patientId: string,
  ): Promise<ParticipantRole> {
    if (!(await this.deps.prisma.user.count({ where: { id: actor.userId, status: 'ACTIVE' } })))
      throw new AppError('FORBIDDEN');
    if ('tenant' in actor) {
      const live = await this.staff(actor, encounterId, 'telemedicine.join');
      return live.doctorProfileId ? 'DOCTOR' : 'STAFF';
    }
    if (actor.patientId !== patientId) throw new AppError('FORBIDDEN');
    const live = await this.deps.patients.resolve(
      actor.userId,
      actor.tenantId,
      actor.patientId,
      this.clock.now(),
    );
    if (!live || (live.actingAs === 'GUARDIAN' && !live.authorityScope.has('JOIN_TELEMEDICINE')))
      throw new AppError('FORBIDDEN');
    return live.actingAs === 'SELF' ? 'PATIENT' : 'GUARDIAN';
  }
  private async require(tenantId: string, id: string, db: PrismaClient | Tx = this.deps.prisma) {
    const row = await db.telemedicineSession.findFirst({ where: { tenantId, id } });
    if (!row) throw new AppError('RESOURCE_NOT_FOUND');
    return row;
  }
  private async record(
    tx: Tx,
    row: Session,
    actor: JoinActor,
    event: string,
    participantId?: string,
    system = false,
  ) {
    await this.outbox.append(tx, {
      tenantId: row.tenantId,
      eventName: event,
      eventVersion: 1,
      aggregateType: 'telemedicine_session',
      aggregateId: row.id,
      correlationId: actor.requestId ?? newId(),
      causationId: null,
      actorId: system ? null : actor.userId,
      idempotencyKey: null,
      payload: {
        sessionId: row.id,
        encounterId: row.encounterId,
        status: row.status,
        ...(participantId ? { participantId } : {}),
      },
    });
    await this.deps.audit.append(tx, {
      tenantId: row.tenantId,
      actorUserId: system ? null : actor.userId,
      actorType: system ? 'SYSTEM' : 'tenant' in actor ? 'USER' : 'PATIENT_CONTEXT',
      actingAs: system || 'tenant' in actor ? null : (actor.actingAs ?? null),
      onBehalfOfPatientId: system || 'tenant' in actor ? null : actor.patientId,
      action: event.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(),
      resourceType: 'telemedicine_session',
      resourceId: row.id,
      outcome: 'SUCCESS',
      requestId: actor.requestId ?? null,
      metadata: { status: row.status, ...(participantId ? { participantId } : {}) },
    });
  }
  async create(actor: ClinicalActor, encounterId: string) {
    await this.staff(actor, encounterId, 'telemedicine.start', true);
    const tenantId = tenantOf(actor),
      now = this.clock.now();
    const prepared = await withTransaction(this.deps.prisma, async (tx) => {
      await this.source.lock(tx, tenantId, encounterId);
      await this.staff(actor, encounterId, 'telemedicine.start', true);
      const existing = await tx.telemedicineSession.findFirst({
        where: { tenantId, encounterId, status: { in: ['PENDING', 'ACTIVE'] } },
      });
      if (existing) {
        await lockRow(tx, 'telemedicine_sessions', existing.id, tenantId);
        if (existing.expiresAt > now) return { fresh: false, row: existing };
        await tx.telemedicineSession.update({
          where: { id: existing.id },
          data: {
            status: existing.status === 'PENDING' ? 'FAILED' : 'EXPIRED',
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });
      }
      const row = await tx.telemedicineSession.create({
        data: {
          id: newId(),
          tenantId,
          encounterId,
          providerAdapter: this.deps.provider.code,
          status: 'PENDING',
          recordingPolicy: 'DISABLED',
          issuedAt: now,
          expiresAt: new Date(now.getTime() + 7200000),
          createdAt: now,
          updatedAt: now,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await this.record(tx, row, actor, 'TelemedicineSessionRequested');
      return { fresh: true, row };
    });
    if (!prepared.fresh) return sessionView(prepared.row);
    let result: Awaited<ReturnType<TelemedicineProvider['createSession']>> | null = null;
    try {
      result = await this.deps.provider.createSession({
        requestId: prepared.row.id,
        expiresAt: prepared.row.expiresAt,
        recordingPolicy: 'DISABLED',
      });
      if (
        !result.providerSessionId ||
        result.providerSessionId.length > 191 ||
        !Number.isFinite(result.expiresAt.getTime()) ||
        result.expiresAt <= this.clock.now()
      )
        result = null;
    } catch {
      result = null; /* Provider details never enter audit, outbox or response. */
    }
    const completed = await withTransaction(this.deps.prisma, async (tx) => {
      let eligible = true;
      try {
        await this.source.lock(tx, tenantId, encounterId);
        await this.staff(actor, encounterId, 'telemedicine.start', true);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        eligible = false;
      }
      await lockRow(tx, 'telemedicine_sessions', prepared.row.id, tenantId);
      const current = await this.require(tenantId, prepared.row.id, tx);
      if (current.status !== 'PENDING' || current.rowVersion !== prepared.row.rowVersion) return current;
      const active = eligible && result !== null && current.expiresAt > this.clock.now();
      const row = await tx.telemedicineSession.update({
        where: { id: current.id },
        data: {
          status: active ? 'ACTIVE' : 'FAILED',
          providerSessionId: result?.providerSessionId ?? null,
          expiresAt: result
            ? new Date(Math.min(result.expiresAt.getTime(), current.expiresAt.getTime()))
            : current.expiresAt,
          updatedAt: this.clock.now(),
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, row, actor, active ? 'TelemedicineSessionCreated' : 'TelemedicineSessionFailed');
      return row;
    });
    if (result && completed.status !== 'ACTIVE') {
      try {
        await this.deps.provider.endSession(result.providerSessionId);
      } catch {
        /* Provider expiry bounds an orphan room. */
      }
    }
    return sessionView(completed);
  }
  async join(actor: JoinActor, id: string) {
    const tenantId = tenantOf(actor);
    const snapshot = await this.require(tenantId, id);
    const prepared = await withTransaction(this.deps.prisma, async (tx) => {
      const source = await this.source.lock(tx, tenantId, snapshot.encounterId);
      const role = await this.authorize(actor, snapshot.encounterId, source.patientId);
      await lockRow(tx, 'telemedicine_sessions', id, tenantId);
      const session = await this.require(tenantId, id, tx);
      this.joinable(session);
      const participantType = 'tenant' in actor ? 'STAFF' : 'PATIENT_CONTEXT';
      let participant = await tx.telemedicineParticipant.findFirst({
        where: { tenantId, sessionId: id, participantType, participantUserId: actor.userId },
      });
      if (participant) {
        await lockRow(tx, 'telemedicine_participants', participant.id, tenantId);
        if (participant.authorizationState !== 'AUTHORIZED' || participant.role !== role)
          throw new AppError('FORBIDDEN');
      } else
        participant = await tx.telemedicineParticipant.create({
          data: {
            id: newId(),
            tenantId,
            sessionId: id,
            participantType,
            participantUserId: actor.userId,
            participantPatientId: participantType === 'PATIENT_CONTEXT' ? source.patientId : null,
            role,
            authorizationState: 'AUTHORIZED',
            createdAt: this.clock.now(),
            updatedAt: this.clock.now(),
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
        });
      return { session, participant, patientId: source.patientId };
    });
    let token: Awaited<ReturnType<TelemedicineProvider['issueParticipantToken']>>;
    try {
      token = await this.deps.provider.issueParticipantToken({
        providerSessionId: prepared.session.providerSessionId!,
        participantId: prepared.participant.id,
        role: prepared.participant.role as ParticipantRole,
        expiresAt: new Date(
          Math.min(this.clock.now().getTime() + 300000, prepared.session.expiresAt.getTime()),
        ),
      });
    } catch {
      throw new AppError('PROVIDER_UNAVAILABLE');
    }
    return withTransaction(this.deps.prisma, async (tx) => {
      const source = await this.source.lock(tx, tenantId, snapshot.encounterId);
      const role = await this.authorize(actor, snapshot.encounterId, source.patientId);
      await lockRow(tx, 'telemedicine_sessions', id, tenantId);
      const session = await this.require(tenantId, id, tx);
      this.joinable(session);
      await lockRow(tx, 'telemedicine_participants', prepared.participant.id, tenantId);
      const participant = await tx.telemedicineParticipant.findFirstOrThrow({
        where: { tenantId, id: prepared.participant.id },
      });
      if (
        participant.authorizationState !== 'AUTHORIZED' ||
        participant.role !== role ||
        session.rowVersion !== prepared.session.rowVersion
      )
        throw new AppError('FORBIDDEN');
      if (
        !token.token ||
        token.token.length > 8192 ||
        !Number.isFinite(token.expiresAt.getTime()) ||
        token.expiresAt <= this.clock.now() ||
        token.expiresAt > session.expiresAt ||
        token.expiresAt.getTime() > this.clock.now().getTime() + 300000
      )
        throw new AppError('PROVIDER_ERROR');
      await this.record(
        tx,
        session,
        'tenant' in actor ? actor : { ...actor, actingAs: role === 'GUARDIAN' ? 'GUARDIAN' : 'SELF' },
        'TelemedicineJoinTokenIssued',
        participant.id,
      );
      return {
        sessionId: id,
        participantId: participant.id,
        provider: session.providerAdapter,
        token: token.token,
        expiresAt: token.expiresAt.toISOString(),
        recordingPolicy: 'DISABLED' as const,
      };
    });
  }
  private joinable(session: Session) {
    if (session.providerAdapter !== this.deps.provider.code || !session.providerSessionId)
      throw new AppError('INVALID_TRANSITION');
    try {
      requireJoinable(session.status as SessionStatus, session.expiresAt, this.clock.now());
    } catch (error) {
      if (error instanceof TelemedicineError) throw new AppError('INVALID_TRANSITION');
      throw error;
    }
  }
  async read(actor: JoinActor, id: string) {
    const tenantId = tenantOf(actor),
      snapshot = await this.require(tenantId, id);
    return withTransaction(this.deps.prisma, async (tx) => {
      const source = await this.source.lock(tx, tenantId, snapshot.encounterId, false);
      if ('tenant' in actor) {
        const live = await this.deps.refreshStaff(actor);
        await this.staff(
          actor,
          snapshot.encounterId,
          live.tenant.effectivePermissions.has('telemedicine.manage')
            ? 'telemedicine.manage'
            : 'telemedicine.join',
        );
      } else await this.authorize(actor, snapshot.encounterId, source.patientId);
      await lockRow(tx, 'telemedicine_sessions', id, tenantId);
      let row = await this.require(tenantId, id, tx);
      if (['PENDING', 'ACTIVE'].includes(row.status) && row.expiresAt <= this.clock.now()) {
        row = await tx.telemedicineSession.update({
          where: { id },
          data: {
            status: row.status === 'PENDING' ? 'FAILED' : 'EXPIRED',
            updatedAt: this.clock.now(),
            rowVersion: { increment: 1 },
          },
        });
        await this.record(
          tx,
          row,
          actor,
          row.status === 'EXPIRED' ? 'TelemedicineSessionExpired' : 'TelemedicineSessionFailed',
        );
      }
      return sessionView(row);
    });
  }
  async end(actor: ClinicalActor, id: string) {
    const tenantId = tenantOf(actor),
      snapshot = await this.require(tenantId, id);
    await this.staff(actor, snapshot.encounterId, 'telemedicine.manage');
    if (snapshot.status === 'ENDED') return sessionView(snapshot);
    if (
      snapshot.status !== 'ACTIVE' ||
      !snapshot.providerSessionId ||
      snapshot.providerAdapter !== this.deps.provider.code
    )
      throw new AppError('INVALID_TRANSITION');
    try {
      await this.deps.provider.endSession(snapshot.providerSessionId);
    } catch {
      throw new AppError('PROVIDER_UNAVAILABLE');
    }
    return withTransaction(this.deps.prisma, async (tx) => {
      await this.source.lock(tx, tenantId, snapshot.encounterId, false);
      await this.staff(actor, snapshot.encounterId, 'telemedicine.manage');
      await lockRow(tx, 'telemedicine_sessions', id, tenantId);
      const current = await this.require(tenantId, id, tx);
      if (current.status === 'ENDED') return sessionView(current);
      if (current.status !== 'ACTIVE') throw new AppError('INVALID_TRANSITION');
      const row = await tx.telemedicineSession.update({
        where: { id },
        data: {
          status: 'ENDED',
          endedAt: this.clock.now(),
          endedReason: 'USER_ENDED',
          updatedAt: this.clock.now(),
          updatedByUserId: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, row, actor, 'TelemedicineSessionEnded');
      return sessionView(row);
    });
  }
  /** Internal verified-event ingress. Public webhook verification/client attribution is composed separately. */
  async participantEvent(tenantId: string, event: ParticipantEvent) {
    const snapshot = await this.deps.prisma.telemedicineSession.findFirst({
      where: {
        tenantId,
        providerAdapter: this.deps.provider.code,
        providerSessionId: event.providerSessionId,
      },
    });
    if (!snapshot) throw new AppError('RESOURCE_NOT_FOUND');
    if (
      !event.providerEventId ||
      event.providerEventId.length > 191 ||
      !['JOINED', 'LEFT', 'RECONNECTED'].includes(event.kind) ||
      !Number.isFinite(event.occurredAt.getTime())
    )
      throw new AppError('VALIDATION_FAILED');
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          event.providerSessionId,
          event.participantId,
          event.kind,
          event.occurredAt.toISOString(),
        ]),
      )
      .digest('hex');
    return withTransaction(this.deps.prisma, async (tx) => {
      await lockRow(tx, 'telemedicine_sessions', snapshot.id, tenantId);
      await lockRow(tx, 'telemedicine_participants', event.participantId, tenantId);
      const participant = await tx.telemedicineParticipant.findFirst({
        where: { tenantId, id: event.participantId, sessionId: snapshot.id },
      });
      if (!participant) throw new AppError('RESOURCE_NOT_FOUND');
      const previous = await tx.telemedicineParticipantEvent.findUnique({
        where: {
          providerAdapter_providerEventId: {
            providerAdapter: this.deps.provider.code,
            providerEventId: event.providerEventId,
          },
        },
      });
      if (previous) {
        if (previous.payloadSha256 !== hash || previous.tenantId !== tenantId)
          throw new AppError('IDEMPOTENCY_KEY_REUSED');
        return { duplicate: true };
      }
      await tx.telemedicineParticipantEvent.create({
        data: {
          id: newId(),
          tenantId,
          sessionId: snapshot.id,
          participantId: participant.id,
          providerAdapter: this.deps.provider.code,
          providerEventId: event.providerEventId,
          kind: event.kind,
          occurredAt: event.occurredAt,
          receivedAt: this.clock.now(),
          payloadSha256: hash,
        },
      });
      const count =
        event.kind === 'JOINED' ? 'joinCount' : event.kind === 'LEFT' ? 'leaveCount' : 'reconnectCount';
      await tx.telemedicineParticipant.update({
        where: { id: participant.id },
        data: {
          [count]: Math.min(participant[count] + 1, 65535),
          ...(event.kind === 'JOINED'
            ? {
                lastJoinedAt:
                  participant.lastJoinedAt && participant.lastJoinedAt > event.occurredAt
                    ? participant.lastJoinedAt
                    : event.occurredAt,
              }
            : {}),
          updatedAt: this.clock.now(),
          rowVersion: { increment: 1 },
        },
      });
      await this.record(
        tx,
        snapshot,
        {
          userId: participant.participantUserId,
          tenantId,
          patientId: participant.participantPatientId ?? '',
          requestId: newId(),
        },
        event.kind === 'JOINED'
          ? 'ParticipantJoined'
          : event.kind === 'LEFT'
            ? 'ParticipantLeft'
            : 'ParticipantReconnected',
        participant.id,
        true,
      );
      return { duplicate: false };
    }).catch((error: unknown) => {
      if (dbErrorInfo(error).kind === 'UNIQUE_VIOLATION') throw new AppError('IDEMPOTENCY_KEY_REUSED');
      throw error;
    });
  }
}
