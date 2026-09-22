import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { MembershipId, TenantContext, TenantId } from '@hmedic/kernel';
import { newId, systemClock } from '@hmedic/kernel';
import { PrismaAuditPort } from '@hmedic/audit';
import { OutboxPort } from '@hmedic/jobs';
import { dbErrorInfo } from '@hmedic/database';
import { composeSchedulingAndQueue } from '@hmedic/queue';
import { QueueSerialLifecycle } from '@hmedic/queue';
import { AssignmentPolicy, type ClinicalActor, ClinicalOutbox, EncounterService } from '../../src/public';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

/**
 * CLIN-002. Mandatory tests 1–3 of the Stage 6 brief: the double start, the serial/encounter invariant
 * across every lifecycle action, and cancelling mid-consultation.
 *
 * The invariant under test is a conjunction — a serial is `IN_CONSULTATION` if and only if exactly one
 * live encounter references it — so every case checks both halves rather than whichever one the code
 * being exercised happens to write.
 */
const db = openTestDatabase({ poolMax: 12 });
const audit = new PrismaAuditPort(systemClock);
const ctx = composeSchedulingAndQueue({ prisma: db.prisma, audit, clock: systemClock });
const lifecycle = new QueueSerialLifecycle(ctx.serials);
const assignment = new AssignmentPolicy(db.prisma, () => systemClock.now());
const encounters = new EncounterService(
  db.prisma,
  audit,
  new ClinicalOutbox(new OutboxPort(systemClock), systemClock),
  lifecycle,
  assignment,
  systemClock,
);

afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

/**
 * A resolved tenant context. The clinical services care only about `tenantId`; the rest of the shape is
 * the HTTP layer's business and is filled in so the type is honest rather than cast away.
 */
function tenantContext(tenantId: TenantId): TenantContext {
  return {
    tenantId,
    membershipId: newId<MembershipId>(),
    role: 'doctor',
    effectivePermissions: new Set<string>(),
    clinicIds: [],
    chamberIds: [],
    rolePermissionsVersion: 2,
  };
}

/** A tenant with a doctor, a chamber, an open day and one CALLED serial: the state a consultation starts from. */
async function chamberWithCalledSerial(label: string) {
  const now = new Date();
  const tenantId = newId<TenantId>();
  const userId = newId();
  const doctorProfileId = newId();
  const patientId = newId();
  const clinicId = newId();
  const chamberId = newId();
  const chamberDayId = newId();
  const serialId = newId();
  const p = db.prisma;

  await p.tenant.create({
    data: {
      id: tenantId,
      name: `DEMO ${label}`,
      slug: `${label}-${tenantId.slice(-6)}`,
      status: 'ACTIVE',
      practiceType: 'GROUP',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.user.create({
    data: {
      id: userId,
      email: `${userId}@example.invalid`,
      emailNormalized: `${userId}@example.invalid`,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.doctorProfile.create({
    data: {
      id: doctorProfileId,
      tenantId,
      userId,
      displayName: `Dr. ${label}`,
      specialties: [],
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.patient.create({
    data: {
      id: patientId,
      tenantId,
      medicalRecordNumber: patientId.slice(-12),
      legalName: 'SYNTHETIC Patient',
      displayName: 'SYNTHETIC Patient',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.clinic.create({
    data: {
      id: clinicId,
      tenantId,
      name: `DEMO Clinic ${label}`,
      nameNormalizedHash: newId().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.chamber.create({
    data: {
      id: chamberId,
      tenantId,
      clinicId,
      doctorProfileId,
      name: `DEMO Chamber ${label}`,
      supportsPhysical: true,
      supportsRemote: false,
      supportsHybrid: false,
      defaultQueuePolicy: {},
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.chamberDay.create({
    data: {
      id: chamberDayId,
      tenantId,
      chamberId,
      doctorProfileId,
      localDate: now,
      localStartTime: new Date('1970-01-01T00:00:00.000Z'),
      localEndTime: new Date('1970-01-01T23:59:00.000Z'),
      timezone: 'Asia/Dhaka',
      status: 'OPEN',
      queuePolicy: {},
      createdAt: now,
      updatedAt: now,
    },
  });
  const serial = await p.serial.create({
    data: {
      id: serialId,
      tenantId,
      chamberDayId,
      patientId,
      serialNumber: 1,
      source: 'WALK_IN',
      careMode: 'PHYSICAL',
      status: 'CALLED',
      createdAt: now,
      updatedAt: now,
    },
  });
  const actor: ClinicalActor = {
    userId,
    tenant: tenantContext(tenantId),
    doctorProfileId,
    requestId: newId(),
    correlationId: newId(),
  };
  return { tenantId, userId, doctorProfileId, patientId, chamberId, chamberDayId, serial, actor };
}

/**
 * The serial/encounter invariant, stated as three properties that are each true at every commit.
 *
 * An interrupted encounter still *occupies* the serial: the doctor stepped out, the patient still holds
 * the room, and resuming must return to the same encounter. So "live" is IN_PROGRESS or INTERRUPTED, and
 * only the third property is about the doctor actually being in the room.
 */
async function assertInvariant(tenantId: string, serialId: string) {
  const serial = await db.prisma.serial.findFirstOrThrow({ where: { tenantId, id: serialId } });
  const live = await db.prisma.encounter.findMany({
    where: { tenantId, serialId, status: { in: ['IN_PROGRESS', 'INTERRUPTED'] } },
    select: { id: true, status: true },
  });
  const occupying = await db.prisma.encounter.count({
    where: { tenantId, serialId, status: { not: 'ENTERED_IN_ERROR' } },
  });

  // 1. At most one encounter occupies a serial — the database's own guarantee, re-checked here because
  //    this is the property everything else depends on.
  expect(occupying, `${occupying} encounters occupy serial ${serialId}`).toBeLessThanOrEqual(1);
  // 2. A serial in consultation has exactly one live encounter behind it.
  if (serial.status === 'IN_CONSULTATION') {
    expect(live, `serial IN_CONSULTATION with ${live.length} live encounter(s)`).toHaveLength(1);
  }
  // 3. A running encounter means the room is occupied. The converse of this is what would be wrong: a
  //    doctor recorded as consulting a patient whose serial was cancelled or completed underneath them.
  const running = live.filter((e) => e.status === 'IN_PROGRESS');
  if (running.length > 0) {
    expect(serial.status, `encounter IN_PROGRESS but serial is ${serial.status}`).toBe('IN_CONSULTATION');
  }
  return { serial, live };
}

describe('starting an encounter', () => {
  it('moves the serial and creates the draft in one transaction', async () => {
    const s = await chamberWithCalledSerial('start');
    const encounter = await encounters.start(s.actor, s.serial.id, {
      expectedRowVersion: s.serial.rowVersion,
    });

    expect(encounter).toMatchObject({
      status: 'IN_PROGRESS',
      serialId: s.serial.id,
      patientId: s.patientId,
      doctorProfileId: s.doctorProfileId,
      coveringDoctorProfileId: null,
    });
    const { serial } = await assertInvariant(s.tenantId, s.serial.id);
    expect(serial.status).toBe('IN_CONSULTATION');
    expect(serial.encounterId).toBe(encounter.id);

    // The draft exists from the start, so autosave never has to create one.
    const draft = await db.prisma.encounterNote.findFirst({
      where: { tenantId: s.tenantId, encounterId: encounter.id, status: 'DRAFT' },
    });
    expect(draft).toBeTruthy();
  });

  it('lets exactly one of two concurrent starts win (test 1)', async () => {
    const s = await chamberWithCalledSerial('race');
    // The same doctor double-clicking, which is the everyday version of this race.
    const results = await Promise.allSettled([
      encounters.start(s.actor, s.serial.id, { expectedRowVersion: s.serial.rowVersion }),
      encounters.start(s.actor, s.serial.id, { expectedRowVersion: s.serial.rowVersion }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);

    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    // Either the row version moved under it or the unique key refused it. Both are documented answers;
    // what must never happen is two encounters.
    const code = (failed.reason as { code?: string }).code ?? dbErrorInfo(failed.reason).kind;
    expect(['STALE_VERSION', 'INVALID_TRANSITION', 'UNIQUE_VIOLATION', 'CONFLICT']).toContain(code);

    await assertInvariant(s.tenantId, s.serial.id);
    expect(await db.prisma.encounter.count({ where: { tenantId: s.tenantId, serialId: s.serial.id } })).toBe(
      1,
    );
  });

  it('refuses a doctor who is not assigned to the patient', async () => {
    const s = await chamberWithCalledSerial('unassigned');
    const other = await chamberWithCalledSerial('other');
    // A doctor from a different chamber and a different patient: none of the five rules reaches here.
    const intruder: ClinicalActor = { ...other.actor, tenant: tenantContext(s.tenantId) };
    await expect(
      encounters.start(intruder, s.serial.id, { expectedRowVersion: s.serial.rowVersion }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const { serial } = await assertInvariant(s.tenantId, s.serial.id);
    expect(serial.status).toBe('CALLED');
  });

  it('refuses a serial that is not waiting to be seen', async () => {
    const s = await chamberWithCalledSerial('wrong-state');
    await db.prisma.serial.update({ where: { id: s.serial.id }, data: { status: 'WAITING' } });
    const current = await db.prisma.serial.findFirstOrThrow({ where: { id: s.serial.id } });
    await expect(
      encounters.start(s.actor, s.serial.id, { expectedRowVersion: current.rowVersion }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(await db.prisma.encounter.count({ where: { serialId: s.serial.id } })).toBe(0);
  });
});

describe('the lifecycle holds the invariant at every step (test 2)', () => {
  it('interrupt, resume and complete each leave both halves consistent', async () => {
    const s = await chamberWithCalledSerial('lifecycle');
    let e = await encounters.start(s.actor, s.serial.id, { expectedRowVersion: s.serial.rowVersion });
    await assertInvariant(s.tenantId, s.serial.id);

    e = await encounters.interrupt(s.actor, e.id, {
      expectedRowVersion: e.rowVersion,
      reason: 'CALLED_AWAY',
    });
    expect(e.status).toBe('INTERRUPTED');
    expect(e.interruptedAt).not.toBeNull();
    await assertInvariant(s.tenantId, s.serial.id);

    e = await encounters.resume(s.actor, e.id, { expectedRowVersion: e.rowVersion });
    expect(e.status).toBe('IN_PROGRESS');
    expect(e.resumedAt).not.toBeNull();
    await assertInvariant(s.tenantId, s.serial.id);

    e = await encounters.complete(s.actor, e.id, { expectedRowVersion: e.rowVersion });
    expect(e.status).toBe('COMPLETED');
    const { serial } = await assertInvariant(s.tenantId, s.serial.id);
    // The serial finishes with the encounter, in the same transaction.
    expect(serial.status).toBe('COMPLETED');
  });

  it('refuses an edge the matrix does not allow, rather than doing nothing', async () => {
    const s = await chamberWithCalledSerial('edges');
    const e = await encounters.start(s.actor, s.serial.id, { expectedRowVersion: s.serial.rowVersion });
    // Resuming something that was never interrupted is a bug in the caller, not a no-op.
    await expect(
      encounters.resume(s.actor, e.id, { expectedRowVersion: e.rowVersion }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('refuses a stale row version', async () => {
    const s = await chamberWithCalledSerial('stale');
    const e = await encounters.start(s.actor, s.serial.id, { expectedRowVersion: s.serial.rowVersion });
    await encounters.interrupt(s.actor, e.id, { expectedRowVersion: e.rowVersion, reason: 'STEPPED_OUT' });
    await expect(
      encounters.resume(s.actor, e.id, { expectedRowVersion: e.rowVersion }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });

  it('voids a completed encounter only with a reason, and frees the serial key', async () => {
    const s = await chamberWithCalledSerial('void');
    let e = await encounters.start(s.actor, s.serial.id, { expectedRowVersion: s.serial.rowVersion });
    e = await encounters.complete(s.actor, e.id, { expectedRowVersion: e.rowVersion });

    await expect(
      encounters.enterInError(s.actor, e.id, { expectedRowVersion: e.rowVersion, reason: '  ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const voided = await encounters.enterInError(s.actor, e.id, {
      expectedRowVersion: e.rowVersion,
      reason: 'DEMO recorded against the wrong patient',
    });
    expect(voided.status).toBe('ENTERED_IN_ERROR');
    // The row stays — it is part of the audit trail — but it no longer occupies the serial.
    expect(await db.prisma.encounter.count({ where: { id: e.id } })).toBe(1);
    await assertInvariant(s.tenantId, s.serial.id);
  });
});

describe('cancelling a serial mid-consultation (test 3)', () => {
  it('interrupts the encounter in the same transaction, leaving no orphan', async () => {
    const s = await chamberWithCalledSerial('cancel');
    const e = await encounters.start(s.actor, s.serial.id, { expectedRowVersion: s.serial.rowVersion });

    const current = await db.prisma.serial.findFirstOrThrow({ where: { id: s.serial.id } });
    await db.prisma.$transaction(async (tx) => {
      const interrupted = await encounters.interruptForSerial(tx, s.tenantId, s.serial.id, {
        reason: 'SERIAL_CANCELLED',
        actor: { userId: s.userId, actorType: 'USER' },
        correlationId: newId(),
      });
      expect(interrupted).toBe(e.id);
    });

    const after = await db.prisma.encounter.findFirstOrThrow({ where: { id: e.id } });
    expect(after.status).toBe('INTERRUPTED');
    expect(after.interruptionReason).toBe('SERIAL_CANCELLED');
    expect(current.status).toBe('IN_CONSULTATION');
    // No encounter is left looking as though the doctor is still in the room.
    const running = await db.prisma.encounter.count({
      where: { tenantId: s.tenantId, serialId: s.serial.id, status: 'IN_PROGRESS' },
    });
    expect(running).toBe(0);
  });

  it('does nothing for a serial that has no encounter', async () => {
    const s = await chamberWithCalledSerial('cancel-none');
    await db.prisma.$transaction(async (tx) => {
      const interrupted = await encounters.interruptForSerial(tx, s.tenantId, s.serial.id, {
        reason: 'SERIAL_CANCELLED',
        actor: { userId: s.userId, actorType: 'USER' },
        correlationId: newId(),
      });
      expect(interrupted).toBeNull();
    });
  });
});

describe('CancelSerial interrupts through the real queue path (test 3, wired)', () => {
  it('cancels the serial and interrupts the encounter in one transaction', async () => {
    // The port is attached the way the composition root attaches it.
    ctx.serials.attachEncounterInterruption(encounters);
    const s = await chamberWithCalledSerial('wired-cancel');
    const e = await encounters.start(s.actor, s.serial.id, { expectedRowVersion: s.serial.rowVersion });
    const current = await db.prisma.serial.findFirstOrThrow({ where: { id: s.serial.id } });

    await ctx.serials.cancel(
      { kind: 'staff', actor: { ...s.actor, tenant: tenantContext(s.tenantId) } },
      s.serial.id,
      { expectedRowVersion: current.rowVersion, reason: 'PATIENT_REQUEST' },
    );

    const serial = await db.prisma.serial.findFirstOrThrow({ where: { id: s.serial.id } });
    const encounter = await db.prisma.encounter.findFirstOrThrow({ where: { id: e.id } });
    expect(serial.status).toBe('CANCELLED');
    // Both halves, or neither. An encounter still marked IN_PROGRESS here would show a doctor consulting
    // a patient who has gone home.
    expect(encounter.status).toBe('INTERRUPTED');
    expect(encounter.interruptionReason).toBe('SERIAL_CANCELLED');
    await assertInvariant(s.tenantId, s.serial.id);
  });

  it('cancelling a serial with no encounter still works', async () => {
    ctx.serials.attachEncounterInterruption(encounters);
    const s = await chamberWithCalledSerial('wired-none');
    await ctx.serials.cancel(
      { kind: 'staff', actor: { ...s.actor, tenant: tenantContext(s.tenantId) } },
      s.serial.id,
      { expectedRowVersion: s.serial.rowVersion, reason: 'PATIENT_REQUEST' },
    );
    const serial = await db.prisma.serial.findFirstOrThrow({ where: { id: s.serial.id } });
    expect(serial.status).toBe('CANCELLED');
  });
});
