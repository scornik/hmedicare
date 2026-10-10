import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError, newId } from '@hmedic/kernel';
import { PrismaAuditPort } from '@hmedic/audit';
import { AssignmentPolicy, ClinicalAccessPolicy, type ClinicalActor } from '@hmedic/clinical';
import { TenantContextResolver } from '@hmedic/identity-access';
import { PatientContextResolver } from '@hmedic/patient';
import { MockTelemedicineProvider, TelemedicineSessionService } from '../../src/public';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';

const db = openTestDatabase({ poolMax: 12 });
const start = new Date('2026-10-10T10:00:00Z');
afterAll(() => db.close());
beforeEach(() => truncateAll());

async function fixture() {
  const f = await chamberWithCalledSerial(db.prisma, 'telemedicine', start);
  const encounterId = newId();
  await db.prisma.encounter.create({
    data: {
      id: encounterId,
      tenantId: f.tenantId,
      patientId: f.patientId,
      doctorProfileId: f.doctorProfileId,
      chamberId: f.chamberId,
      serialId: f.serial.id,
      status: 'IN_PROGRESS',
      careMode: 'REMOTE',
      startedAt: start,
      createdAt: start,
      updatedAt: start,
    },
  });
  await db.prisma.tenantMembership.create({
    data: {
      id: f.actor.tenant.membershipId,
      tenantId: f.tenantId,
      userId: f.userId,
      role: 'doctor',
      permissions: {},
      clinicIds: [],
      chamberIds: [],
      status: 'ACTIVE',
      rolePermissionsVersion: 2,
      createdAt: start,
      updatedAt: start,
    },
  });
  let now = start;
  const clock = { now: () => new Date(now) };
  const provider = new MockTelemedicineProvider(() => clock.now());
  const tenants = new TenantContextResolver(db.prisma);
  const refreshStaff = async (actor: ClinicalActor) => {
    const tenant = await tenants.resolve(actor.userId, actor.tenant.tenantId);
    if (!tenant || !(await db.prisma.user.count({ where: { id: actor.userId, status: 'ACTIVE' } })))
      throw new AppError('FORBIDDEN');
    const profile = await db.prisma.doctorProfile.findFirst({
      where: { tenantId: tenant.tenantId, userId: actor.userId, status: 'ACTIVE' },
    });
    return { ...actor, tenant, doctorProfileId: profile?.id ?? null };
  };
  const service = new TelemedicineSessionService({
    prisma: db.prisma,
    audit: new PrismaAuditPort(clock),
    access: new ClinicalAccessPolicy(db.prisma, new AssignmentPolicy(db.prisma, () => clock.now())),
    patients: new PatientContextResolver(db.prisma),
    refreshStaff,
    provider,
    clock,
  });
  const patientUserId = newId(),
    accountId = newId();
  await db.prisma.user.create({
    data: {
      id: patientUserId,
      email: `${patientUserId}@example.invalid`,
      emailNormalized: `${patientUserId}@example.invalid`,
      status: 'ACTIVE',
      createdAt: start,
      updatedAt: start,
    },
  });
  await db.prisma.patientAccount.create({
    data: {
      id: accountId,
      tenantId: f.tenantId,
      patientId: f.patientId,
      userId: patientUserId,
      relationship: 'SELF',
      verificationMethod: 'STAFF_VERIFIED_IN_PERSON',
      status: 'ACTIVE',
      verifiedAt: start,
      createdAt: start,
      updatedAt: start,
    },
  });
  return {
    ...f,
    encounterId,
    provider,
    service,
    clock,
    accountId,
    patientActor: { userId: patientUserId, tenantId: f.tenantId, patientId: f.patientId },
    advance: (seconds: number) => {
      now = new Date(start.getTime() + seconds * 1000);
    },
  };
}

describe('durable remote sessions', () => {
  it('commits PENDING before provider I/O and concurrent creation reserves only one room', async () => {
    const f = await fixture(),
      create = f.provider.createSession.bind(f.provider);
    let calls = 0;
    f.provider.createSession = async (input) => {
      calls++;
      expect(
        (await db.prisma.telemedicineSession.findUniqueOrThrow({ where: { id: input.requestId } })).status,
      ).toBe('PENDING');
      return create(input);
    };
    const rows = await Promise.all([
      f.service.create(f.actor, f.encounterId),
      f.service.create(f.actor, f.encounterId),
    ]);
    expect(rows[0]!.id).toBe(rows[1]!.id);
    expect(calls).toBe(1);
    expect((await db.prisma.telemedicineSession.findFirstOrThrow()).status).toBe('ACTIVE');
    expect(rows.every((row) => row.recordingPolicy === 'DISABLED')).toBe(true);
  });
  it('persists provider failure without changing the encounter and permits a new attempt', async () => {
    const f = await fixture();
    f.provider.enqueue('timeout');
    expect((await f.service.create(f.actor, f.encounterId)).status).toBe('FAILED');
    expect((await db.prisma.encounter.findFirstOrThrow()).status).toBe('IN_PROGRESS');
    expect((await f.service.create(f.actor, f.encounterId)).status).toBe('ACTIVE');
    expect(await db.prisma.telemedicineSession.count()).toBe(2);
  });
  it.each(['PHYSICAL', 'COMPLETED'])('rejects an ineligible encounter: %s', async (state) => {
    const f = await fixture();
    await db.prisma.encounter.update({
      where: { id: f.encounterId },
      data: state === 'PHYSICAL' ? { careMode: state } : { status: state },
    });
    await expect(f.service.create(f.actor, f.encounterId)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    expect(await db.prisma.telemedicineSession.count()).toBe(0);
  });
  it('uses live permissions and assignment rather than caller-supplied doctor fields', async () => {
    const f = await fixture();
    await db.prisma.tenantMembership.update({
      where: { id: f.actor.tenant.membershipId },
      data: { permissions: { denials: ['telemedicine.start'] } },
    });
    await expect(f.service.create(f.actor, f.encounterId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db.prisma.tenantMembership.update({
      where: { id: f.actor.tenant.membershipId },
      data: { permissions: {} },
    });
    await db.prisma.doctorProfile.update({ where: { id: f.doctorProfileId }, data: { status: 'INACTIVE' } });
    await expect(f.service.create(f.actor, f.encounterId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('does not activate a room after permission is revoked during provider creation', async () => {
    const f = await fixture(),
      create = f.provider.createSession.bind(f.provider);
    f.provider.createSession = async (input) => {
      const result = await create(input);
      await db.prisma.tenantMembership.update({
        where: { id: f.actor.tenant.membershipId },
        data: { status: 'SUSPENDED' },
      });
      return result;
    };
    expect((await f.service.create(f.actor, f.encounterId)).status).toBe('FAILED');
    expect((await db.prisma.encounter.findFirstOrThrow()).status).toBe('IN_PROGRESS');
  });
  it('allows the assigned doctor and self patient, scopes tokens, and never stores tokens', async () => {
    const f = await fixture(),
      session = await f.service.create(f.actor, f.encounterId);
    const doctor = await f.service.join(f.actor, session.id),
      patient = await f.service.join(f.patientActor, session.id);
    const room = await db.prisma.telemedicineSession.findFirstOrThrow();
    expect(f.provider.authenticateToken(doctor.token, room.providerSessionId!, doctor.participantId)).toEqual(
      { role: 'DOCTOR' },
    );
    expect(
      f.provider.authenticateToken(patient.token, room.providerSessionId!, patient.participantId),
    ).toEqual({ role: 'PATIENT' });
    const rows = [
      await db.prisma.telemedicineSession.findMany(),
      await db.prisma.telemedicineParticipant.findMany(),
      await db.prisma.auditLog.findMany(),
      await db.prisma.outboxEvent.findMany(),
    ];
    const json = JSON.stringify(rows, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(json).not.toContain(doctor.token);
    expect(json).not.toContain(patient.token);
    expect(
      await db.prisma.auditLog.count({
        where: { actorType: 'PATIENT_CONTEXT', onBehalfOfPatientId: f.patientId, actingAs: 'SELF' },
      }),
    ).toBe(1);
  });
  it('rejects cross-tenant, unrelated patient and revoked self access', async () => {
    const f = await fixture(),
      session = await f.service.create(f.actor, f.encounterId);
    await expect(f.service.join({ ...f.patientActor, tenantId: newId() }, session.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(f.service.join({ ...f.patientActor, patientId: newId() }, session.id)).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    await db.prisma.patientAccount.update({ where: { id: f.accountId }, data: { status: 'REVOKED' } });
    await expect(f.service.join(f.patientActor, session.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await db.prisma.telemedicineParticipant.count()).toBe(0);
  });
  it('withholds a token when patient access is revoked during provider issuance', async () => {
    const f = await fixture(),
      session = await f.service.create(f.actor, f.encounterId),
      issue = f.provider.issueParticipantToken.bind(f.provider);
    f.provider.issueParticipantToken = async (input) => {
      const token = await issue(input);
      await db.prisma.patientAccount.update({ where: { id: f.accountId }, data: { status: 'REVOKED' } });
      return token;
    };
    await expect(f.service.join(f.patientActor, session.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await db.prisma.auditLog.count({ where: { action: 'TELEMEDICINE_JOIN_TOKEN_ISSUED' } })).toBe(0);
  });
  it('requires live guardian JOIN_TELEMEDICINE authority', async () => {
    const f = await fixture(),
      session = await f.service.create(f.actor, f.encounterId);
    await db.prisma.patientAccount.update({ where: { id: f.accountId }, data: { status: 'REVOKED' } });
    const id = newId();
    await db.prisma.patientGuardianship.create({
      data: {
        id,
        tenantId: f.tenantId,
        guardianUserId: f.patientActor.userId,
        dependentPatientId: f.patientId,
        relationship: 'PARENT',
        authorityScope: ['VIEW_RECORDS'],
        status: 'ACTIVE',
        startsOn: new Date('2026-10-01'),
        createdAt: start,
        updatedAt: start,
      },
    });
    await expect(f.service.join(f.patientActor, session.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db.prisma.patientGuardianship.update({
      where: { id },
      data: { authorityScope: ['JOIN_TELEMEDICINE'] },
    });
    expect((await f.service.join(f.patientActor, session.id)).participantId).toBeTruthy();
    await db.prisma.patientGuardianship.update({ where: { id }, data: { status: 'REVOKED' } });
    await expect(f.service.join(f.patientActor, session.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('expires joins at the exact deadline and releases the old active-session key on create', async () => {
    const f = await fixture(),
      session = await f.service.create(f.actor, f.encounterId);
    f.advance(7200);
    await expect(f.service.join(f.actor, session.id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect((await f.service.create(f.actor, f.encounterId)).id).not.toBe(session.id);
    expect(
      (await db.prisma.telemedicineSession.findUniqueOrThrow({ where: { id: session.id } })).status,
    ).toBe('EXPIRED');
    expect((await db.prisma.encounter.findFirstOrThrow()).status).toBe('IN_PROGRESS');
  });
  it('keeps an active session on provider end failure and ends on retry without completing care', async () => {
    const f = await fixture(),
      session = await f.service.create(f.actor, f.encounterId);
    f.provider.enqueue('timeout');
    await expect(f.service.end(f.actor, session.id)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect((await db.prisma.telemedicineSession.findFirstOrThrow()).status).toBe('ACTIVE');
    expect((await f.service.end(f.actor, session.id)).status).toBe('ENDED');
    expect((await f.service.end(f.actor, session.id)).status).toBe('ENDED');
    expect((await db.prisma.encounter.findFirstOrThrow()).status).toBe('IN_PROGRESS');
    expect(await db.prisma.outboxEvent.count({ where: { eventName: 'TelemedicineSessionEnded' } })).toBe(1);
  });
  it('records duplicate-safe event counters and rejects changed replays', async () => {
    const f = await fixture(),
      session = await f.service.create(f.actor, f.encounterId),
      joined = await f.service.join(f.actor, session.id);
    const room = await db.prisma.telemedicineSession.findFirstOrThrow();
    const event = {
      providerSessionId: room.providerSessionId!,
      participantId: joined.participantId,
      providerEventId: 'synthetic-joined',
      kind: 'JOINED' as const,
      occurredAt: start,
    };
    const results = await Promise.all([
      f.service.participantEvent(f.tenantId, event),
      f.service.participantEvent(f.tenantId, event),
    ]);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);
    await expect(f.service.participantEvent(f.tenantId, { ...event, kind: 'LEFT' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    await f.service.participantEvent(f.tenantId, {
      ...event,
      providerEventId: 'reconnect',
      kind: 'RECONNECTED',
    });
    await f.service.end(f.actor, session.id);
    await f.service.participantEvent(f.tenantId, { ...event, providerEventId: 'left', kind: 'LEFT' });
    expect(await db.prisma.telemedicineParticipant.findFirstOrThrow()).toMatchObject({
      joinCount: 1,
      leaveCount: 1,
      reconnectCount: 1,
    });
    expect(await db.prisma.telemedicineParticipantEvent.count()).toBe(3);
  });
  it('database rejects a second active room, cross-tenant participants and participants from another session in events', async () => {
    const f = await fixture(),
      session = await f.service.create(f.actor, f.encounterId),
      joined = await f.service.join(f.actor, session.id);
    const row = await db.prisma.telemedicineSession.findFirstOrThrow();
    await expect(
      db.prisma.telemedicineSession.create({
        data: { ...row, id: newId(), providerSessionId: 'other-room' },
      }),
    ).rejects.toThrow();
    const participant = await db.prisma.telemedicineParticipant.findFirstOrThrow();
    await expect(
      db.prisma.telemedicineParticipant.create({ data: { ...participant, id: newId(), tenantId: newId() } }),
    ).rejects.toThrow();
    await f.service.end(f.actor, session.id);
    const next = await f.service.create(f.actor, f.encounterId);
    await expect(
      db.prisma.telemedicineParticipantEvent.create({
        data: {
          id: newId(),
          tenantId: f.tenantId,
          sessionId: next.id,
          participantId: joined.participantId,
          providerAdapter: 'mock',
          providerEventId: 'wrong-session',
          kind: 'JOINED',
          occurredAt: start,
          receivedAt: start,
          payloadSha256: 'a'.repeat(64),
        },
      }),
    ).rejects.toThrow();
  });
});
