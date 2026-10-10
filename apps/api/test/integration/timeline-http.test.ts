import { createHmac } from 'node:crypto';
import { CommunicationSummary, CommunicationPreferenceView } from '@hmedic/contracts';
import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { loadConfig, type ServerConfig } from '@hmedic/config';
import { testEnv } from '@hmedic/config/testing';
import { AppError, FixedClock, newId } from '@hmedic/kernel';
import { withTransaction } from '@hmedic/database';
import { Argon2idHasher, PolicyEngine } from '@hmedic/identity-access';
import { QueueEventWriter } from '@hmedic/scheduling';
import { TimelineProjector, TimelineReader, TimelineRepository, timelineSources } from '@hmedic/timeline';
import { TimelinePage } from '@hmedic/contracts';
import { buildApi, type ApiInstance } from '../../src/compose';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { testDatabaseUrl, truncateAll } from '../../../../tests/support/db';
let api: ApiInstance, server: Parameters<typeof request>[0];
let base: Awaited<ReturnType<typeof chamberWithCalledSerial>>;
let encounterId: string, rxId: string, doctor: Record<string, string>;
const now = new Date('2026-10-01T12:00:00.000Z'),
  password = 'correct horse battery';
const hasher = new Argon2idHasher({ memoryKiB: 8192, timeCost: 2, parallelism: 1 });
beforeAll(async () => {
  api = await buildApi(
    loadConfig<ServerConfig>('api', testEnv({ DATABASE_URL: testDatabaseUrl(), JOB_RUNNER_MODE: 'off' })),
  );
  server = api.app.getHttpServer();
});
afterAll(async () => {
  await api?.close();
});
async function login(userId: string) {
  const user = await api.runtime.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const r = await request(server)
    .post('/api/v1/auth/password/login')
    .set('idempotency-key', newId())
    .send({ email: user.email, password, client: 'android' })
    .expect(200);
  return { authorization: `Bearer ${r.body.data.accessToken}`, 'x-tenant-id': base.tenantId };
}
async function membership(userId: string, role: string, chamberIds: string[] = []) {
  await api.runtime.prisma.tenantMembership.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      userId,
      role,
      permissions: { grants: [], denials: [] },
      clinicIds: [],
      chamberIds,
      status: 'ACTIVE',
      rolePermissionsVersion: PolicyEngine.version,
      createdAt: now,
      updatedAt: now,
    },
  });
}
async function staff(role: string, chambers: string[] = []) {
  const id = newId(),
    email = `${id}@example.invalid`;
  await api.runtime.prisma.user.create({
    data: {
      id,
      email,
      emailNormalized: email,
      passwordHash: await hasher.hash(password),
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await membership(id, role, chambers);
  return { id, headers: await login(id) };
}
async function account(userId = base.userId) {
  return api.runtime.prisma.patientAccount.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      userId,
      patientId: base.patientId,
      relationship: 'SELF',
      verificationMethod: 'STAFF_VERIFIED_IN_PERSON',
      verifiedAt: now,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
}
const url = () => `/api/v1/patients/${base.patientId}/timeline`;
const patientHeaders = () => ({ ...doctor, 'x-patient-context': base.patientId });
beforeEach(async () => {
  await truncateAll();
  base = await chamberWithCalledSerial(api.runtime.prisma, 'timeline-http');
  await api.runtime.prisma.user.update({
    where: { id: base.userId },
    data: { passwordHash: await hasher.hash(password) },
  });
  await membership(base.userId, 'doctor');
  doctor = await login(base.userId);
  encounterId = newId();
  rxId = newId();
  await api.runtime.prisma.encounter.create({
    data: {
      id: encounterId,
      tenantId: base.tenantId,
      patientId: base.patientId,
      doctorProfileId: base.doctorProfileId,
      chamberId: base.chamberId,
      serialId: base.serial.id,
      careMode: 'PHYSICAL',
      status: 'IN_PROGRESS',
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  const noteId = newId();
  await api.runtime.prisma.encounterNote.create({
    data: {
      id: noteId,
      tenantId: base.tenantId,
      encounterId,
      authorDoctorProfileId: base.doctorProfileId,
      status: 'DRAFT',
      chiefComplaint: 'SYNTHETIC secret draft',
      sectionSources: {},
      createdAt: now,
      updatedAt: now,
    },
  });
  await api.runtime.prisma.encounterNoteVersion.create({
    data: {
      id: newId(),
      tenantId: base.tenantId,
      encounterId,
      noteId,
      revision: 1,
      signedByDoctorProfileId: base.doctorProfileId,
      signedAt: now,
      chiefComplaint: 'SYNTHETIC private signed note',
      sectionSources: {},
      contentSha256: 'a'.repeat(64),
      rowHash: 'b'.repeat(64),
      createdAt: now,
    },
  });
  await api.runtime.prisma.prescription.create({
    data: {
      id: rxId,
      tenantId: base.tenantId,
      patientId: base.patientId,
      encounterId,
      doctorProfileId: base.doctorProfileId,
      revision: 1,
      clinicalStatus: 'APPROVED',
      approvedAt: now,
      approvedByDoctorProfileId: base.doctorProfileId,
      approvedSnapshotSha256: 'a'.repeat(64),
      createdAt: now,
      updatedAt: now,
    },
  });
  await withTransaction(api.runtime.prisma, (tx) =>
    new QueueEventWriter(new FixedClock(now)).append(tx, {
      tenantId: base.tenantId,
      chamberDayId: base.chamberDayId,
      serialId: base.serial.id,
      eventType: 'CALLED',
      actor: { userId: base.userId, actorType: 'USER' },
    }),
  );
  await new TimelineProjector(api.runtime.prisma, timelineSources(api.runtime.prisma)).backfill(
    base.tenantId,
  );
});
describe('authorized timeline HTTP', () => {
  it('returns resolved safe references for the assigned doctor and audits the read', async () => {
    const r = await request(server).get(url()).set(doctor).expect(200);
    expect(TimelinePage.safeParse(r.body.data).success).toBe(true);
    expect(r.body.data.items).toHaveLength(4);
    expect(r.body.data.stale).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/SYNTHETIC|rowHash|sourceEventId|patientId/);
    expect(
      r.body.data.items.find((r: { eventType: string }) => r.eventType === 'prescription_finalized').source
        .id,
    ).toBe(rxId);
    expect(
      await api.runtime.prisma.auditLog.findFirst({
        where: { action: 'TIMELINE_READ', resourceId: base.patientId },
      }),
    ).not.toBeNull();
  });
  it('shows patients only shared records and revalidates revoked account links', async () => {
    const link = await account();
    const r = await request(server).get(url()).set(patientHeaders()).expect(200);
    expect(r.body.data.items.map((r: { eventType: string }) => r.eventType)).toEqual([
      'prescription_finalized',
    ]);
    await api.runtime.prisma.patientAccount.update({ where: { id: link.id }, data: { status: 'REVOKED' } });
    await request(server).get(url()).set(patientHeaders()).expect(403);
    const other = await chamberWithCalledSerial(api.runtime.prisma, 'timeline-foreign');
    await account();
    await request(server)
      .get(`/api/v1/patients/${other.patientId}/timeline`)
      .set(patientHeaders())
      .expect(403);
  });
  it('requires guardian VIEW_RECORDS and checks revocation on every page', async () => {
    const guardian = await staff('doctor');
    const link = await api.runtime.prisma.patientGuardianship.create({
      data: {
        id: newId(),
        tenantId: base.tenantId,
        guardianUserId: guardian.id,
        dependentPatientId: base.patientId,
        relationship: 'PARENT',
        authorityScope: ['BOOK_APPOINTMENTS'],
        verificationMethod: 'STAFF_VERIFIED_IN_PERSON',
        status: 'ACTIVE',
        startsOn: new Date('2026-01-01'),
        createdAt: now,
        updatedAt: now,
      },
    });
    const headers = { ...guardian.headers, 'x-patient-context': base.patientId };
    await request(server).get(url()).set(headers).expect(403);
    await api.runtime.prisma.patientGuardianship.update({
      where: { id: link.id },
      data: { authorityScope: ['VIEW_RECORDS'] },
    });
    expect((await request(server).get(url()).set(headers).expect(200)).body.data.items).toHaveLength(1);
    await api.runtime.prisma.patientGuardianship.update({
      where: { id: link.id },
      data: { status: 'REVOKED' },
    });
    await request(server).get(url()).set(headers).expect(403);
  });
  it('denies unassigned doctors, applies nurse scope and gives reception only operational entries', async () => {
    const stranger = await staff('doctor');
    await request(server).get(url()).set(stranger.headers).expect(403);
    const reception = await staff('receptionist');
    const r = await request(server).get(url()).set(reception.headers).expect(200);
    expect(r.body.data.items.map((r: { visibility: string }) => r.visibility)).toEqual(['OPERATIONAL']);
    const nurse = await staff('nurse', [newId()]);
    expect((await request(server).get(url()).set(nurse.headers).expect(200)).body.data.items).toEqual([]);
    const scoped = await staff('nurse', [base.chamberId]);
    expect((await request(server).get(url()).set(scoped.headers).expect(200)).body.data.items).toHaveLength(
      4,
    );
    const billing = await staff('billing_manager');
    await request(server).get(url()).set(billing.headers).expect(403);
  });
  it('paginates equal timestamps without duplicates and excludes subsequent appends from the snapshot', async () => {
    const expected = (await request(server).get(url()).set(doctor).expect(200)).body.data.items.map(
      (r: { id: string }) => r.id,
    );
    const first = (await request(server).get(url()).query({ limit: 1 }).set(doctor).expect(200)).body.data;
    await api.runtime.prisma.encounter.update({
      where: { id: encounterId },
      data: { completedAt: new Date(), status: 'COMPLETED' },
    });
    await new TimelineProjector(api.runtime.prisma, timelineSources(api.runtime.prisma)).backfill(
      base.tenantId,
    );
    const seen = [first.items[0].id];
    let cursor = first.nextCursor;
    for (let i = 0; cursor && i < 10; i++) {
      const page = (await request(server).get(url()).query({ cursor, limit: 1 }).set(doctor).expect(200)).body
        .data;
      seen.push(...page.items.map((r: { id: string }) => r.id));
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(expected);
    expect(cursor).toBeNull();
  });
  it('rejects tampered, cross-audience and cross-user cursors, and validates limits', async () => {
    const page = (await request(server).get(url()).query({ limit: 1 }).set(doctor).expect(200)).body.data;
    await account();
    await request(server).get(url()).query({ cursor: page.nextCursor }).set(patientHeaders()).expect(400);
    const admin = await staff('tenant_owner');
    await request(server).get(url()).query({ cursor: page.nextCursor }).set(admin.headers).expect(400);
    await request(server)
      .get(url())
      .query({ cursor: (page.nextCursor[0] === 'A' ? 'B' : 'A') + page.nextCursor.slice(1) })
      .set(doctor)
      .expect(400);
    await request(server).get(url()).query({ limit: 101 }).set(doctor).expect(400);
    await request(server).get(url()).query({ limit: 0 }).set(doctor).expect(400);
  });
  it('hides all encounter descendants immediately after withdrawal, before marker projection', async () => {
    await account();
    await api.runtime.prisma.encounter.update({
      where: { id: encounterId },
      data: {
        status: 'ENTERED_IN_ERROR',
        enteredInErrorReason: 'SYNTHETIC withdrawal',
        updatedAt: new Date(),
      },
    });
    expect((await request(server).get(url()).set(patientHeaders()).expect(200)).body.data.items).toEqual([]);
    const r = await request(server).get(url()).set(doctor).expect(200);
    expect(r.body.data.items.map((r: { eventType: string }) => r.eventType)).toEqual(['serial']);
    await new TimelineProjector(api.runtime.prisma, timelineSources(api.runtime.prisma)).backfill(
      base.tenantId,
    );
    expect((await request(server).get(url()).set(patientHeaders()).expect(200)).body.data.items).toEqual([]);
    const removed = (await request(server).get(url()).set(doctor).expect(200)).body.data.items.find(
      (r: { eventType: string }) => r.eventType === 'REDACTED',
    );
    expect(removed.source).toBeNull();
  });
  it('enforces tenant boundaries and does not expose unresolved source rows', async () => {
    const other = await chamberWithCalledSerial(api.runtime.prisma, 'timeline-other');
    await request(server).get(`/api/v1/patients/${other.patientId}/timeline`).set(doctor).expect(404);
    await request(server)
      .get(url())
      .set({ ...doctor, 'x-tenant-id': other.tenantId })
      .expect(403);
    await withTransaction(api.runtime.prisma, (tx) =>
      new TimelineRepository().append(
        tx,
        base.actor.tenant,
        {
          patientId: base.patientId,
          eventType: 'doctor_note',
          occurredAt: now,
          sourceType: 'encounter_note_version',
          sourceId: newId(),
          sourceEventId: newId(),
          visibility: 'CLINICAL',
          structuredRefs: {},
          projectionVersion: 1,
        },
        now,
      ),
    );
    expect((await request(server).get(url()).set(doctor).expect(200)).body.data.items).toHaveLength(4);
  });
  it('reports source bootstrap and receipt gaps independently of the timestamp checkpoint', async () => {
    const reader = new TimelineReader(
      api.runtime.prisma,
      timelineSources(api.runtime.prisma),
      1,
      's'.repeat(32),
    );
    const access = {
      tenantId: base.tenantId,
      patientId: base.patientId,
      view: 'clinical' as const,
      binding: 'test',
      canRead: async () => true,
    };
    const prefix = `BackfillTimelineSources:${base.tenantId}:v1`;
    for (const [key, kind] of [
      [prefix, 'encounter'],
      [`${prefix}:document:start`, 'document'],
    ]) {
      await api.runtime.prisma.job.create({
        data: {
          id: newId(),
          tenantId: base.tenantId,
          queue: 'timeline',
          type: 'BackfillTimelineSources',
          payload: { v: 1, kind },
          status: 'SUCCEEDED',
          idempotencyKey: key,
          runAt: now,
          attempts: 1,
          maxAttempts: 3,
          correlationId: newId(),
          createdAt: now,
          updatedAt: now,
          finishedAt: now,
        },
      });
    }
    expect((await reader.list(access)).stale).toBe(false);
    await api.runtime.prisma.outboxEvent.create({
      data: {
        id: newId(),
        tenantId: base.tenantId,
        eventName: 'EncounterNoteDraftSaved',
        eventVersion: 1,
        aggregateType: 'encounter',
        aggregateId: encounterId,
        payload: {},
        occurredAt: now,
        correlationId: newId(),
        status: 'PUBLISHED',
        publishedAt: now,
      },
    });
    expect((await reader.list(access)).stale).toBe(true);
    await expect(reader.list(access, { cursor: 'invalid' })).rejects.toBeInstanceOf(AppError);
  });
});

describe('follow-up HTTP authorization and timeline projection', () => {
  const input = {
    dueStartDate: '2030-10-10',
    reason: 'SYNTHETIC Follow-up reason',
    instructions: 'SYNTHETIC Follow-up instructions',
  };
  it('creates once on replay, updates with row version, and keeps text out of the timeline', async () => {
    const key = newId(),
      path = () => `/api/v1/encounters/${encounterId}/follow-ups`;
    const completion = vi
      .spyOn(api.runtime.idempotency, 'complete')
      .mockRejectedValue(new Error('outside-transaction completion must not run'));
    const [first, second] = await (async () => {
      try {
        const first = await request(server)
          .post(path())
          .set(doctor)
          .set('Idempotency-Key', key)
          .send(input)
          .expect(201);
        const second = await request(server)
          .post(path())
          .set(doctor)
          .set('Idempotency-Key', key)
          .send(input)
          .expect(201);
        expect(completion).not.toHaveBeenCalled();
        return [first, second];
      } finally {
        completion.mockRestore();
      }
    })();
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await api.runtime.prisma.followUpPlan.count()).toBe(1);
    await request(server)
      .patch(`/api/v1/follow-ups/${first.body.data.id}`)
      .set(doctor)
      .send({ expectedRowVersion: 1, status: 'COMPLETED' })
      .expect(200);
    await request(server)
      .patch(`/api/v1/follow-ups/${first.body.data.id}`)
      .set(doctor)
      .send({ expectedRowVersion: 1, reason: 'stale' })
      .expect(409);
    await new TimelineProjector(api.runtime.prisma, timelineSources(api.runtime.prisma)).backfill(
      base.tenantId,
    );
    const r = await request(server).get(url()).set(doctor).expect(200);
    expect(r.body.data.items.some((i: { eventType: string }) => i.eventType === 'follow_up')).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(input.reason);
    expect(JSON.stringify(r.body)).not.toContain(input.instructions);
  });
  it('denies clinical creation by patients, reception and unassigned doctors', async () => {
    const path = `/api/v1/encounters/${encounterId}/follow-ups`;
    await account();
    await request(server)
      .post(path)
      .set(patientHeaders())
      .set('Idempotency-Key', newId())
      .send(input)
      .expect(403);
    for (const role of ['receptionist', 'doctor'] as const) {
      const other = await staff(role);
      await request(server)
        .post(path)
        .set(other.headers)
        .set('Idempotency-Key', newId())
        .send(input)
        .expect(403);
    }
  });
  it('allows scoped reads but prevents reception from reading clinical reason/instructions', async () => {
    await request(server)
      .post(`/api/v1/encounters/${encounterId}/follow-ups`)
      .set(doctor)
      .set('Idempotency-Key', newId())
      .send(input)
      .expect(201);
    const reception = await staff('receptionist');
    await request(server)
      .get(`/api/v1/encounters/${encounterId}/follow-ups`)
      .set(reception.headers)
      .expect(403);
    const nurse = await staff('nurse');
    const response = await request(server)
      .get(`/api/v1/encounters/${encounterId}/follow-ups`)
      .set(nurse.headers)
      .expect(200);
    expect(response.body.data[0].reason).toBe(input.reason);
  });
  it('books once for a verified SELF context and commits its replay inside the booking transaction', async () => {
    const date = new Date(api.runtime.clock.now().getTime() + 2 * 86_400_000 + 6 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    await api.runtime.prisma.doctorScheduleRule.create({
      data: {
        id: newId(),
        tenantId: base.tenantId,
        doctorProfileId: base.doctorProfileId,
        chamberId: base.chamberId,
        ruleType: 'WEEKLY',
        weekday: new Date(date).getUTCDay(),
        localStartTime: new Date('1970-01-01T18:00:00Z'),
        localEndTime: new Date('1970-01-01T20:00:00Z'),
        effectiveFrom: new Date(date),
        createdAt: api.runtime.clock.now(),
        updatedAt: api.runtime.clock.now(),
      },
    });
    const plan = (
      await request(server)
        .post(`/api/v1/encounters/${encounterId}/follow-ups`)
        .set(doctor)
        .set('Idempotency-Key', newId())
        .send({ ...input, dueStartDate: date })
        .expect(201)
    ).body.data;
    await account();
    const key = newId(),
      body = { chamberId: base.chamberId, localDate: date, careMode: 'PHYSICAL', expectedRowVersion: 1 };
    const completion = vi
      .spyOn(api.runtime.idempotency, 'complete')
      .mockRejectedValue(new Error('outside-transaction completion must not run'));
    try {
      const first = await request(server)
        .post(`/api/v1/follow-ups/${plan.id}/book`)
        .set(patientHeaders())
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
      const second = await request(server)
        .post(`/api/v1/follow-ups/${plan.id}/book`)
        .set(patientHeaders())
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(first.body.data.bookedOnBehalf).toBe('SELF');
      expect(completion).not.toHaveBeenCalled();
      expect(await api.runtime.prisma.appointment.count({ where: { followUpPlanId: plan.id } })).toBe(1);
      expect(await api.runtime.prisma.followUpPlan.findUnique({ where: { id: plan.id } })).toMatchObject({
        status: 'BOOKED',
        appointmentId: first.body.data.id,
        serialId: first.body.data.serial.id,
      });
    } finally {
      completion.mockRestore();
    }
  });
});

describe('communication HTTP', () => {
  it('projects communication metadata and inherits source encounter withdrawal masking', async () => {
    const planId = newId(),
      commId = newId();
    await api.runtime.prisma.followUpPlan.create({
      data: {
        id: planId,
        tenantId: base.tenantId,
        patientId: base.patientId,
        sourceEncounterId: encounterId,
        doctorProfileId: base.doctorProfileId,
        dueStartDate: new Date('2026-10-10'),
        reason: 'SYNTHETIC private followup',
        status: 'PLANNED',
        createdAt: now,
        updatedAt: now,
      },
    });
    await api.runtime.prisma.communication.create({
      data: {
        id: commId,
        tenantId: base.tenantId,
        patientId: base.patientId,
        channel: 'email',
        purpose: 'follow_up_reminder',
        templateKey: 'follow_up_reminder',
        templateVersion: 1,
        locale: 'en-BD',
        businessType: 'follow_up_plan',
        businessId: planId,
        status: 'SENT',
        idempotencyKey: newId(),
        createdAt: now,
        updatedAt: now,
      },
    });
    await new TimelineProjector(api.runtime.prisma, timelineSources(api.runtime.prisma)).backfill(
      base.tenantId,
    );
    const first = await request(server).get(url()).set(doctor).expect(200);
    expect(
      first.body.data.items.some(
        (row: { source: { type: string; id: string } | null }) =>
          row.source?.type === 'communication' && row.source.id === commId,
      ),
    ).toBe(true);
    expect(JSON.stringify(first.body)).not.toContain('SYNTHETIC private followup');
    await api.runtime.prisma.encounter.update({
      where: { id: encounterId },
      data: { status: 'ENTERED_IN_ERROR', enteredInErrorReason: 'SYNTHETIC withdrawn' },
    });
    const after = await request(server).get(url()).set(doctor).expect(200);
    expect(
      after.body.data.items.some((row: { source: { id: string } | null }) => row.source?.id === commId),
    ).toBe(false);
  });
  const commPath = () => `/api/v1/patients/${base.patientId}/communications`;
  const prefPath = () => `/api/v1/patients/${base.patientId}/communication-preferences`;
  it('reads bounded operational statuses with no destinations or clinical content', async () => {
    await api.runtime.prisma.communication.create({
      data: {
        id: newId(),
        tenantId: base.tenantId,
        patientId: base.patientId,
        channel: 'email',
        purpose: 'follow_up_reminder',
        templateKey: 'follow_up_reminder',
        templateVersion: 1,
        locale: 'en-BD',
        businessType: 'follow_up_plan',
        businessId: newId(),
        status: 'SENT',
        idempotencyKey: newId(),
        createdAt: now,
        updatedAt: now,
      },
    });
    await request(server).get(commPath()).expect(401);
    const r = await request(server).get(commPath()).set(doctor).expect(200);
    expect(CommunicationSummary.safeParse(r.body.data[0]).success).toBe(true);
    expect(r.body.data[0].status).toBe('SENT');
    expect(JSON.stringify(r.body)).not.toContain('SYNTHETIC');
    await account();
    await request(server).get(commPath()).set(patientHeaders()).expect(200);
    const other = await chamberWithCalledSerial(api.runtime.prisma, 'communication-http-other');
    await request(server)
      .get(`/api/v1/patients/${other.patientId}/communications`)
      .set(patientHeaders())
      .expect(403);
    await request(server).get(`/api/v1/patients/${other.patientId}/communications`).set(doctor).expect(404);
  });
  it('allows verified SELF preference changes, preserves PUT idempotence and never grants consent implicitly', async () => {
    await account();
    const body = { channel: 'email', preference: 'OPT_OUT', consentVersion: 1 };
    const first = await request(server).put(prefPath()).set(patientHeaders()).send(body).expect(200);
    const second = await request(server).put(prefPath()).set(patientHeaders()).send(body).expect(200);
    expect(CommunicationPreferenceView.safeParse(first.body.data).success).toBe(true);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await api.runtime.prisma.communicationPreference.count()).toBe(1);
    const prefs = await request(server).get(prefPath()).set(patientHeaders()).expect(200);
    expect(prefs.body.data[0].preference).toBe('OPT_OUT');
    await request(server)
      .put(prefPath())
      .set(patientHeaders())
      .send({ ...body, preference: 'OPT_IN' })
      .expect(200);
    expect(await api.runtime.prisma.patientConsent.count()).toBe(0);
    await request(server)
      .put(prefPath())
      .set(patientHeaders())
      .send({ ...body, channel: 'push' })
      .expect(400);
    const audit = await api.runtime.prisma.auditLog.findFirstOrThrow({
      where: { action: 'COMMUNICATION_PREFERENCE_CHANGED' },
    });
    expect(audit.actorType).toBe('PATIENT_CONTEXT');
    expect(audit.actorUserId).toBe(base.userId);
  });
  it('requires guardian consent scope and revalidates revoked links', async () => {
    const guardian = await staff('receptionist');
    const link = await api.runtime.prisma.patientGuardianship.create({
      data: {
        id: newId(),
        tenantId: base.tenantId,
        guardianUserId: guardian.id,
        dependentPatientId: base.patientId,
        relationship: 'PARENT',
        authorityScope: ['VIEW_RECORDS'],
        verificationMethod: 'STAFF_VERIFIED_IN_PERSON',
        status: 'ACTIVE',
        startsOn: new Date('2026-01-01'),
        createdAt: now,
        updatedAt: now,
      },
    });
    const headers = { ...guardian.headers, 'x-patient-context': base.patientId };
    const body = { channel: 'email', preference: 'OPT_OUT', consentVersion: 1 };
    await request(server).put(prefPath()).set(headers).send(body).expect(403);
    await api.runtime.prisma.patientGuardianship.update({
      where: { id: link.id },
      data: { authorityScope: ['VIEW_RECORDS', 'GIVE_CONSENT'] },
    });
    await request(server).put(prefPath()).set(headers).send(body).expect(200);
    await api.runtime.prisma.patientGuardianship.update({
      where: { id: link.id },
      data: { status: 'REVOKED' },
    });
    await request(server).get(prefPath()).set(headers).expect(403);
  });
  it('authenticates the original webhook bytes, deduplicates receipts and disables mocks in production', async () => {
    const path = '/api/v1/webhooks/communication/mock-email';
    const body = ' { "eventId": "http-event", "messageId": "mock-unknown", "status": "delivered" } ';
    const signature = createHmac('sha256', api.runtime.config.LOG_HASH_PEPPER).update(body).digest('hex');
    await request(server).post(path).set('content-type', 'application/json').send(body).expect(403);
    await request(server)
      .post(path)
      .set('content-type', 'application/json')
      .set('x-mock-signature', signature)
      .send(body.trim())
      .expect(403);
    for (let i = 0; i < 2; i++)
      await request(server)
        .post(path)
        .set('content-type', 'application/json')
        .set('x-mock-signature', signature)
        .send(body)
        .expect(200);
    expect(await api.runtime.prisma.providerWebhookEvent.count()).toBe(1);
    const previous = api.runtime.config.APP_ENV;
    try {
      api.runtime.config.APP_ENV = 'production';
      await request(server)
        .post(path)
        .set('content-type', 'application/json')
        .set('x-mock-signature', signature)
        .send(body)
        .expect(409);
    } finally {
      api.runtime.config.APP_ENV = previous;
    }
  });
});

describe('SMS account HTTP authorization', () => {
  const root = '/api/v1/tenant/sms-credentials';
  it('lets tenant owners create, validate, read and revoke write-only accounts', async () => {
    const owner = await staff('tenant_owner');
    const key = 'synthetic-sms-api-key-1234';
    const created = await request(server)
      .post(root)
      .set(owner.headers)
      .send({ apiKey: key, senderId: 'DEMO', balanceAlertBdt: '100' })
      .expect(200);
    const credential = created.body.data;
    expect(credential.status).toBe('PENDING_VALIDATION');
    expect(credential.secretLast4).toBe('1234');
    expect(JSON.stringify(created.body)).not.toContain(key);
    const validated = await request(server)
      .post(root + '/' + credential.id + '/validate')
      .set(owner.headers)
      .send({ rowVersion: credential.rowVersion })
      .expect(200);
    expect(validated.body.data.credential.status).toBe('ACTIVE');
    expect(validated.body.data.balance.parseStatus).toBe('PARSED');
    await request(server)
      .post(root + '/' + credential.id + '/validate')
      .set(owner.headers)
      .send({ rowVersion: credential.rowVersion })
      .expect(409);
    const list = await request(server).get(root).set(owner.headers).expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(
      /encryptedSecret|wrappedDataKey|secretFingerprint|synthetic-sms-api-key/,
    );
    await request(server)
      .get(root + '/' + credential.id + '/balance')
      .set(owner.headers)
      .expect(200);
    await request(server)
      .delete(root + '/' + credential.id)
      .set(owner.headers)
      .expect(200);
    await request(server)
      .delete(root + '/' + credential.id)
      .set(owner.headers)
      .expect(200);
  });
  it('denies ordinary staff, anonymous users and cross-tenant credentials', async () => {
    await request(server).get(root).set(doctor).expect(403);
    await request(server).get(root).expect(401);
    await request(server).get('/api/v1/platform/sms/balance').set(doctor).expect(400);
    await request(server)
      .get('/api/v1/platform/sms/balance')
      .set('authorization', doctor.authorization ?? '')
      .set('x-platform-context', 'operator')
      .expect(403);
    const owner = await staff('tenant_owner');
    await request(server)
      .post(root)
      .set(owner.headers)
      .send({ apiKey: 'short', senderId: 'DEMO' })
      .expect(400);
    await request(server)
      .get(root + '/' + newId() + '/balance')
      .set(owner.headers)
      .expect(404);
  });
});
