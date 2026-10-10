import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import { PrismaAuditPort } from '@hmedic/audit';
import { composeSchedulingAndQueue } from '@hmedic/queue';
import { composeClinical, type ClinicalActor } from '@hmedic/clinical';
import { FollowUpService, dueInstant } from '../../src/public';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { chamberWithCalledSerial, tenantContext } from '../../../../tests/support/clinical';
const db = openTestDatabase({ poolMax: 12 });
const clock = { now: () => new Date('2026-10-08T18:30:00Z') };
const audit = new PrismaAuditPort(clock);
const scheduling = composeSchedulingAndQueue({ prisma: db.prisma, audit, clock });
const clinical = composeClinical({ prisma: db.prisma, audit, serials: scheduling.serials, clock });
const service = new FollowUpService(db.prisma, audit, clinical.access, scheduling.appointments, clock);
afterAll(() => db.close());
beforeEach(() => truncateAll());
async function fixture() {
  const f = await chamberWithCalledSerial(db.prisma, 'followup', clock.now());
  const actor: ClinicalActor = {
    userId: f.userId,
    doctorProfileId: f.doctorProfileId,
    tenant: tenantContext(f.tenantId),
  };
  const encounter = await clinical.encounters.start(actor, f.serial.id, {
    expectedRowVersion: f.serial.rowVersion,
  });
  await db.prisma.doctorScheduleRule.create({
    data: {
      id: newId(),
      tenantId: f.tenantId,
      doctorProfileId: f.doctorProfileId,
      chamberId: f.chamberId,
      weekday: 6,
      localStartTime: new Date('1970-01-01T18:00:00Z'),
      localEndTime: new Date('1970-01-01T20:00:00Z'),
      ruleType: 'WEEKLY',
      effectiveFrom: new Date('2026-01-01'),
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
  });
  return { ...f, actor, encounter };
}
const input = {
  dueStartDate: '2026-10-10',
  dueEndDate: '2026-10-11',
  reason: 'SYNTHETIC Review',
  instructions: 'SYNTHETIC Instructions',
};
const booking = (chamberId: string, expectedRowVersion = 1) => ({
  chamberId,
  expectedRowVersion,
  localDate: '2026-10-10',
  careMode: 'PHYSICAL' as const,
});
describe('follow-up plans and booking', () => {
  it('rearms a consumed reminder when a planned follow-up moves to a later date', async () => {
    const f = await fixture(),
      plan = await service.create(f.actor, f.encounter.id, input);
    await db.prisma.followUpTask.updateMany({ where: { followUpPlanId: plan.id }, data: { status: 'DONE' } });
    await service.update(f.actor, plan.id, {
      expectedRowVersion: 1,
      dueStartDate: '2026-10-11',
      dueEndDate: '2026-10-12',
    });
    const tasks = await db.prisma.followUpTask.findMany({
      where: { followUpPlanId: plan.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(tasks).toHaveLength(2);
    expect(tasks.some((t) => t.status === 'DONE')).toBe(true);
    expect(tasks.find((t) => t.status === 'OPEN')?.dueAt).toEqual(dueInstant('2026-10-11'));
  });
  it('creates a doctor-authored plan and Dhaka reminder without prose in events/audit', async () => {
    const f = await fixture(),
      p = await service.create(f.actor, f.encounter.id, input);
    expect(p.status).toBe('PLANNED');
    expect(p.doctorProfileId).toBe(f.doctorProfileId);
    const task = await db.prisma.followUpTask.findFirstOrThrow({ where: { followUpPlanId: p.id } });
    expect(task.dueAt).toEqual(new Date('2026-10-09T18:00:00Z'));
    expect(dueInstant('2026-10-10')).toEqual(task.dueAt);
    const event = await db.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: p.id } });
    expect(JSON.stringify(event.payload)).not.toContain('SYNTHETIC');
    expect(
      JSON.stringify(
        await db.prisma.auditLog.findMany({ where: { resourceId: p.id }, select: { metadata: true } }),
      ),
    ).not.toContain('SYNTHETIC');
  });
  it('rejects impossible dates, inverted windows, whitespace reasons and dates before Dhaka today', async () => {
    const f = await fixture();
    for (const extra of [
      { dueStartDate: '2026-02-30' },
      { dueEndDate: '2026-10-09' },
      { reason: '  ' },
      { dueStartDate: '2026-10-08' },
    ])
      await expect(service.create(f.actor, f.encounter.id, { ...input, ...extra })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    expect(await db.prisma.followUpPlan.count()).toBe(0);
  });
  it('uses assignment for clinical writes and tenant isolation for IDs', async () => {
    const f = await fixture();
    await expect(
      service.create({ ...f.actor, doctorProfileId: null }, f.encounter.id, input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.create({ ...f.actor, doctorProfileId: newId() }, f.encounter.id, input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const foreign = await chamberWithCalledSerial(db.prisma, 'foreign');
    await expect(
      service.create({ ...f.actor, tenant: tenantContext(foreign.tenantId) }, f.encounter.id, input),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
  it('updates reminder dates with optimistic concurrency and closes tasks on cancellation', async () => {
    const f = await fixture(),
      p = await service.create(f.actor, f.encounter.id, input);
    const next = await service.update(f.actor, p.id, {
      expectedRowVersion: 1,
      dueStartDate: '2026-10-11',
      dueEndDate: null,
    });
    expect(next.rowVersion).toBe(2);
    await expect(
      service.update(f.actor, p.id, { expectedRowVersion: 1, reason: 'stale' }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(
      (await db.prisma.followUpTask.findFirstOrThrow({ where: { followUpPlanId: p.id } })).dueAt,
    ).toEqual(dueInstant('2026-10-11'));
    await service.update(f.actor, p.id, { expectedRowVersion: 2, status: 'CANCELLED' });
    expect((await db.prisma.followUpTask.findFirstOrThrow({ where: { followUpPlanId: p.id } })).status).toBe(
      'CANCELLED',
    );
    await expect(
      service.update(f.actor, p.id, { expectedRowVersion: 3, status: 'COMPLETED' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
  it('creates an appointment and serial linked to the plan in one transaction', async () => {
    const f = await fixture(),
      p = await service.create(f.actor, f.encounter.id, input);
    const result = await service.book({ kind: 'staff', actor: f.actor }, p.id, booking(f.chamberId));
    expect(result.source).toBe('FOLLOW_UP');
    expect(result.serial).not.toBeNull();
    const row = await db.prisma.followUpPlan.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({
      status: 'BOOKED',
      appointmentId: result.id,
      serialId: result.serial!.id,
      rowVersion: 2,
    });
    expect((await db.prisma.appointment.findUniqueOrThrow({ where: { id: result.id } })).followUpPlanId).toBe(
      p.id,
    );
  });
  it('serializes concurrent duplicate bookings and rolls back the losing request', async () => {
    const f = await fixture(),
      p = await service.create(f.actor, f.encounter.id, input);
    const results = await Promise.allSettled(
      [1, 2].map(() => service.book({ kind: 'staff', actor: f.actor }, p.id, booking(f.chamberId))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.prisma.appointment.count({ where: { followUpPlanId: p.id } })).toBe(1);
    expect(await db.prisma.serial.count({ where: { source: 'FOLLOW_UP' } })).toBe(1);
  });
  it('rolls back appointment, serial, plan, counter and audit when finalization fails', async () => {
    const f = await fixture(),
      p = await service.create(f.actor, f.encounter.id, input);
    await expect(
      service.book({ kind: 'staff', actor: f.actor }, p.id, booking(f.chamberId), {
        onCommit: async () => {
          throw new Error('rollback');
        },
      }),
    ).rejects.toThrow('rollback');
    expect(await db.prisma.appointment.count()).toBe(0);
    expect((await db.prisma.followUpPlan.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('PLANNED');
    expect(await db.prisma.serial.count({ where: { source: 'FOLLOW_UP' } })).toBe(0);
  });
  it('refuses booking outside the due window and after encounter withdrawal', async () => {
    const f = await fixture(),
      p = await service.create(f.actor, f.encounter.id, input);
    await expect(
      service.book({ kind: 'staff', actor: f.actor }, p.id, {
        ...booking(f.chamberId),
        localDate: '2026-10-12',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await db.prisma.encounter.update({
      where: { id: f.encounter.id },
      data: { status: 'ENTERED_IN_ERROR', enteredInErrorReason: 'SYNTHETIC Wrong encounter' },
    });
    await expect(
      service.book({ kind: 'staff', actor: f.actor }, p.id, booking(f.chamberId)),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
  it('books for a resolved SELF context and refuses mismatched patients or guardians without booking scope', async () => {
    const f = await fixture(),
      p = await service.create(f.actor, f.encounter.id, input);
    const context = {
      tenantId: f.tenantId,
      userId: f.userId,
      patientId: f.patientId,
      actingAs: 'SELF' as const,
      guardianshipId: null,
      authorityScope: new Set<string>(),
    };
    await expect(
      service.book(
        { kind: 'patient', context: { ...context, patientId: newId() } },
        p.id,
        booking(f.chamberId),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.book(
        { kind: 'patient', context: { ...context, actingAs: 'GUARDIAN' } },
        p.id,
        booking(f.chamberId),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const result = await service.book({ kind: 'patient', context }, p.id, booking(f.chamberId));
    expect(result.bookedOnBehalf).toBe('SELF');
    const auditRow = await db.prisma.auditLog.findFirstOrThrow({
      where: { resourceId: p.id, action: 'FOLLOW_UP_BOOKED' },
    });
    expect(auditRow).toMatchObject({
      actorType: 'PATIENT_CONTEXT',
      actingAs: 'SELF',
      onBehalfOfPatientId: f.patientId,
    });
  });
  it('enforces plan and task CHECKs plus tenant FKs in the database', async () => {
    const f = await fixture(),
      p = await service.create(f.actor, f.encounter.id, input);
    for (const data of [
      { status: 'INVALID' },
      { status: 'BOOKED' },
      { dueEndDate: new Date('2026-10-09') },
      { rowVersion: 0 },
    ])
      await expect(db.prisma.followUpPlan.update({ where: { id: p.id }, data })).rejects.toThrow();
    const task = await db.prisma.followUpTask.findFirstOrThrow({ where: { followUpPlanId: p.id } });
    await expect(
      db.prisma.followUpTask.update({ where: { id: task.id }, data: { taskType: 'SMS' } }),
    ).rejects.toThrow();
    const foreign = await chamberWithCalledSerial(db.prisma, 'other');
    await expect(
      db.prisma.followUpTask.update({ where: { id: task.id }, data: { tenantId: foreign.tenantId } }),
    ).rejects.toThrow();
  });
});
