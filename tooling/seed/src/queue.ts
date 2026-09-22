import { type Clock, type TenantContext, newId } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { dhakaDate } from '@hmedic/localization';
import { composeSchedulingAndQueue } from '@hmedic/queue';
import type { SchedulingActor } from '@hmedic/scheduling';

/**
 * Stage 5 CP5 queue-active dataset (SEED-DATA §2.3, prompt §7): the states only the queue commands can
 * reach. CP4 seeds what booking alone produces (BOOKED, CONFIRMED, CANCELLED, NO_SHOW, RESCHEDULED); this
 * adds walk-ins and carries serials through CHECKED_IN, WAITING, CALLED, SKIPPED, IN_CONSULTATION and
 * COMPLETED, so a demo queue board has every row type a receptionist actually sees.
 *
 * The day is left mid-consultation on purpose: one serial in IN_CONSULTATION, several still waiting. A
 * dataset where every serial is terminal shows nothing about the board.
 */
export interface QueueSeedDeps {
  prisma: PrismaClient;
  audit: PrismaAuditPort;
  clock: Clock;
  tenantA: { tenantId: string; ownerCtx: { userId: string; tenant: TenantContext } };
  /** user ids by seed key (dr.a1, dr.a2, …) */
  staffUserIds: Record<string, string>;
  report: { created: string[] };
}

export async function seedQueue(d: QueueSeedDeps): Promise<void> {
  const { prisma, tenantA } = d;
  const ctx = composeSchedulingAndQueue({ prisma, audit: d.audit, clock: d.clock });
  const today = dhakaDate(d.clock.now());
  // A fresh request id per call, exactly as the API gives each request its own.
  const staff = (): SchedulingActor => ({ ...tenantA.ownerCtx, requestId: newId(), correlationId: newId() });
  const asStaff = () => ({ kind: 'staff' as const, actor: staff() });

  // The general evening chamber's day for today, opened by the CP4 seed.
  const day = await prisma.chamberDay.findFirst({
    where: { tenantId: tenantA.tenantId, localDate: new Date(`${today}T00:00:00.000Z`), status: 'OPEN' },
    orderBy: { createdAt: 'asc' },
  });
  if (!day) throw new Error('seed: no open chamber day for today; run the chamber seed first');
  if ((await prisma.serial.count({ where: { chamberDayId: day.id, source: 'WALK_IN' } })) > 0) return;

  const chamber = await prisma.chamber.findFirstOrThrow({ where: { id: day.chamberId } });
  const doctorProfile = await prisma.doctorProfile.findFirstOrThrow({
    where: { id: chamber.doctorProfileId },
    select: { userId: true },
  });
  // StartConsultation and CompleteConsultation belong to the doctor of the chamber (ADR-021), not the owner.
  const doctor = (): SchedulingActor => ({
    userId: doctorProfile.userId,
    tenant: { ...tenantA.ownerCtx.tenant },
    requestId: newId(),
    correlationId: newId(),
  });
  const asDoctor = () => ({ kind: 'staff' as const, actor: doctor() });

  // Patients with no serial on this day, so the walk-ins do not trip the duplicate guard.
  const taken = new Set(
    (await prisma.serial.findMany({ where: { chamberDayId: day.id }, select: { patientId: true } })).map(
      (s) => s.patientId,
    ),
  );
  const pool = (
    await prisma.patient.findMany({
      where: { tenantId: tenantA.tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
  )
    .map((p) => p.id)
    .filter((id) => !taken.has(id));
  let cursor = 0;
  const nextPatient = () => {
    const id = pool[cursor++];
    if (!id) throw new Error('seed: not enough patients without a serial today for the walk-in mix');
    return id;
  };

  // 1. Three walk-ins. They arrive checked in, and become WAITING unless the policy asks for confirmation.
  const walkIns = [];
  for (let i = 0; i < 3; i++) {
    walkIns.push(
      await ctx.queue.issueWalkIn(
        staff(),
        day.id,
        { patientId: nextPatient(), careMode: 'PHYSICAL' },
        { idempotencyKey: newId() },
      ),
    );
  }

  // 2. One booked serial arrives at the desk. Only one: the CP4 dataset confirms two, and a demo database
  // should still show a CONFIRMED serial that has not turned up yet, which is the common state before a
  // chamber opens. Checking in both would erase that.
  const booked = await prisma.serial.findMany({
    where: { chamberDayId: day.id, status: { in: ['BOOKED', 'CONFIRMED'] }, careMode: 'PHYSICAL' },
    orderBy: { serialNumber: 'asc' },
    take: 2,
  });
  const arrived = [];
  for (const s of booked.slice(0, 1)) {
    arrived.push(
      await ctx.queue.checkIn(asStaff(), s.id, {
        expectedRowVersion: s.rowVersion,
        method: 'STAFF_DESK',
        idempotencyKey: newId(),
      }),
    );
  }

  // 3. One is called and then skipped (a patient who stepped out), keeping its history on the chain.
  const toSkip = walkIns[2]!;
  const called = await ctx.queue.call(asStaff(), toSkip.id, {
    expectedRowVersion: toSkip.rowVersion,
  });
  await ctx.queue.skip(asStaff(), called.id, {
    expectedRowVersion: called.rowVersion,
    reason: 'DEMO patient stepped out of the waiting room',
  });

  // 4. One is called, seen and completed; another is left mid-consultation.
  const finish = walkIns[0]!;
  const calledFinish = await ctx.queue.call(asStaff(), finish.id, {
    expectedRowVersion: finish.rowVersion,
  });
  const started = await ctx.queue.startConsultation(asDoctor(), calledFinish.id, {
    expectedRowVersion: calledFinish.rowVersion,
  });
  await ctx.queue.completeConsultation(asDoctor(), started.id, {
    expectedRowVersion: started.rowVersion,
  });

  const inChamber = arrived[0] ?? walkIns[1]!;
  const calledInChamber = await ctx.queue.call(asStaff(), inChamber.id, {
    expectedRowVersion: inChamber.rowVersion,
  });
  await ctx.queue.startConsultation(asDoctor(), calledInChamber.id, {
    expectedRowVersion: calledInChamber.rowVersion,
  });

  // 5. A serial parked in CHECKED_IN. On this day arrival goes straight to WAITING, so the state only
  // exists on a chamber whose policy sets `waitingRequiresConfirmation` — the slotted morning chamber does.
  // Without this the demo board never shows an arrival awaiting confirmation.
  const slotted = await prisma.chamber.findFirst({
    where: {
      tenantId: tenantA.tenantId,
      defaultQueuePolicy: { path: '$.waitingRequiresConfirmation', equals: true },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (slotted) {
    const materialized = await ctx.days.materialize(staff(), { chamberId: slotted.id, localDate: today });
    const openDay = await ctx.days.open(staff(), materialized.day.id, {
      expectedRowVersion: materialized.day.rowVersion,
    });
    await ctx.queue.issueWalkIn(
      staff(),
      openDay.id,
      { patientId: nextPatient(), careMode: 'PHYSICAL' },
      { idempotencyKey: newId() },
    );
  }

  d.report.created.push(
    "today's queue: walk-ins and a desk arrival; one completed, one in consultation, one skipped, one " +
      'awaiting confirmation on the slotted chamber, the rest waiting',
  );
}

/** Seed assertions for the queue-active dataset (SEED-DATA §4). */
export async function verifyQueueSeed(prisma: PrismaClient, tenantAId: string): Promise<string[]> {
  const problems: string[] = [];
  const serials = await prisma.serial.findMany({
    where: { tenantId: tenantAId },
    select: { status: true, source: true, queuePosition: true, chamberDayId: true },
  });
  const statuses = new Set(serials.map((s) => s.status));
  for (const s of ['CHECKED_IN', 'WAITING', 'SKIPPED', 'IN_CONSULTATION', 'COMPLETED']) {
    if (!statuses.has(s)) problems.push(`no serial in status ${s}`);
  }
  if (!serials.some((s) => s.source === 'WALK_IN')) problems.push('no walk-in serial');

  // Positions must be unique per day among the serials that hold one: two patients sharing position 3 is
  // the bug the queue engine exists to prevent, so the seed asserts it rather than assuming it.
  const byDay = new Map<string, number[]>();
  for (const s of serials) {
    if (s.queuePosition === null) continue;
    byDay.set(s.chamberDayId, [...(byDay.get(s.chamberDayId) ?? []), s.queuePosition]);
  }
  for (const [dayId, positions] of byDay) {
    if (new Set(positions).size !== positions.length)
      problems.push(`duplicate queue positions on chamber day ${dayId}`);
  }

  const events = await prisma.queueEvent.groupBy({ by: ['eventType'], _count: true });
  const seen = new Set(events.map((e) => e.eventType));
  for (const e of ['SERIAL_ISSUED', 'CHECKED_IN', 'CALLED', 'SKIPPED', 'CONSULTATION_STARTED', 'COMPLETED']) {
    if (!seen.has(e)) problems.push(`no ${e} queue event`);
  }
  return problems;
}
