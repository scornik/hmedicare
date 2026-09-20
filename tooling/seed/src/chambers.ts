import { type Clock, type TenantContext, newId } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { addDays, dhakaDate, startOfDhakaDay } from '@hmedic/localization';
import { composeSchedulingAndQueue } from '@hmedic/queue';
import type { SchedulingActor } from '@hmedic/scheduling';

/**
 * Stage 5 chamber, schedule and booking dataset (SEED-DATA §2.1/§2.3, Stage 5 prompt §7): four chambers
 * across two clinics with weekly rules and one holiday exception, a walk-in-only and a booking-only
 * chamber, today's chamber day open with a booking mix, and a closed chamber day from yesterday.
 *
 * The queue-active mix (checked in, waiting, called, skipped, in consultation, completed) needs the CP5
 * commands and is seeded there; CP4 seeds the states its own use cases can reach.
 */
export interface ChamberSeedDeps {
  prisma: PrismaClient;
  audit: PrismaAuditPort;
  clock: Clock;
  tenantA: { tenantId: string; ownerCtx: { userId: string; tenant: TenantContext } };
  tenantB: { tenantId: string; ownerCtx: { userId: string; tenant: TenantContext } };
  /** user ids by seed key (dr.a1, dr.a2, dr.b1, …) */
  staffUserIds: Record<string, string>;
  report: { created: string[] };
}

const EVENING = { localStartTime: '17:00', localEndTime: '21:00' };
const MORNING = { localStartTime: '09:00', localEndTime: '12:00' };

export async function seedChambers(d: ChamberSeedDeps): Promise<void> {
  const { prisma, tenantA } = d;
  if ((await prisma.chamber.count({ where: { tenantId: tenantA.tenantId } })) > 0) return;
  const ctx = composeSchedulingAndQueue({ prisma, audit: d.audit, clock: d.clock });
  // A fresh request id per call, exactly as the API gives each request its own (queue events are keyed by it).
  const actorA = (): SchedulingActor => ({ ...tenantA.ownerCtx, requestId: newId(), correlationId: newId() });
  const actorB = (): SchedulingActor => ({
    ...d.tenantB.ownerCtx,
    requestId: newId(),
    correlationId: newId(),
  });
  const today = dhakaDate(d.clock.now());
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);

  const clinics = await prisma.clinic.findMany({
    where: { tenantId: tenantA.tenantId, status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  const dhanmondi = clinics[0]!;
  const uttara = clinics[1] ?? clinics[0]!;
  const doctorOf = async (tenantId: string, userId: string, label: string) => {
    const p = await prisma.doctorProfile.findFirst({ where: { tenantId, userId }, select: { id: true } });
    if (!p) throw new Error(`seed: doctor profile for ${label} missing`);
    return p.id;
  };
  const staffDoctor = (key: string) => {
    const userId = d.staffUserIds[key];
    if (!userId) throw new Error(`seed: staff ${key} missing`);
    return userId;
  };
  const drA1 = await doctorOf(tenantA.tenantId, staffDoctor('dr.a1'), 'dr.a1');
  const drA2 = await doctorOf(tenantA.tenantId, staffDoctor('dr.a2'), 'dr.a2');

  // 1. Four chambers: a general evening chamber, a slotted morning chamber, walk-in-only and booking-only.
  const general = await ctx.chambers.create(actorA(), {
    clinicId: dhanmondi.id,
    doctorProfileId: drA1,
    name: 'DEMO Dhanmondi Evening Chamber',
    supportsPhysical: true,
    supportsRemote: true,
    supportsHybrid: false,
    // Telemedicine defaults to PREPAID_REQUIRED, which is FEATURE_DISABLED while payments are absent
    // (audit C-45); the demo chambers that take remote patients use the informational OPTIONAL_ONLINE mode.
    telemedicinePaymentMode: 'OPTIONAL_ONLINE',
    defaultQueuePolicy: { capacity: 40, maxBookedSerials: 25, avgConsultationMinutes: 8 },
  });
  const slotted = await ctx.chambers.create(actorA(), {
    clinicId: dhanmondi.id,
    doctorProfileId: drA2,
    name: 'DEMO Dhanmondi Morning Chamber',
    supportsPhysical: true,
    supportsRemote: false,
    supportsHybrid: false,
    defaultQueuePolicy: { slotMinutes: 30, slotCapacity: 2, capacity: 12, waitingRequiresConfirmation: true },
  });
  const walkInOnly = await ctx.chambers.create(actorA(), {
    clinicId: uttara.id,
    doctorProfileId: drA1,
    name: 'DEMO Uttara Walk-in Chamber',
    supportsPhysical: true,
    supportsRemote: false,
    supportsHybrid: false,
    defaultQueuePolicy: { advanceBookingEnabled: false, maxWalkIns: 20 },
  });
  const bookingOnly = await ctx.chambers.create(actorA(), {
    clinicId: uttara.id,
    doctorProfileId: drA2,
    name: 'DEMO Uttara Booking-only Chamber',
    supportsPhysical: true,
    supportsRemote: true,
    supportsHybrid: false,
    telemedicinePaymentMode: 'OPTIONAL_ONLINE',
    defaultQueuePolicy: { walkInsEnabled: false, bookingWindowDays: 30 },
  });
  const soloChamber = await ctx.chambers.create(actorB(), {
    clinicId: (
      await prisma.clinic.findFirstOrThrow({ where: { tenantId: d.tenantB.tenantId }, select: { id: true } })
    ).id,
    // Tenant B is a SOLO practice: its owner is the doctor.
    doctorProfileId: await doctorOf(d.tenantB.tenantId, d.tenantB.ownerCtx.userId, 'dr.b1'),
    name: 'DEMO Solo Chamber',
    supportsPhysical: true,
    supportsRemote: false,
    supportsHybrid: false,
  });

  // 2. Weekly rules for every weekday, plus one holiday exception on the day after tomorrow.
  for (const [chamber, window] of [
    [general, EVENING],
    [walkInOnly, EVENING],
    [bookingOnly, EVENING],
    [soloChamber, EVENING],
    [slotted, MORNING],
  ] as const) {
    for (let weekday = 1; weekday <= 7; weekday++) {
      await ctx.schedules.create(chamber.id === soloChamber.id ? actorB() : actorA(), chamber.id, {
        ruleType: 'WEEKLY',
        weekday,
        ...window,
        effectiveFrom: addDays(today, -365),
      });
    }
  }
  const holiday = addDays(today, 2);
  await ctx.schedules.create(actorA(), general.id, {
    ruleType: 'EXCEPTION_CLOSED',
    exceptionDate: holiday,
    ...EVENING,
    effectiveFrom: addDays(today, -365),
  });
  // An extra Uttara session on the holiday, so both exception kinds exist.
  await ctx.schedules.create(actorA(), bookingOnly.id, {
    ruleType: 'EXCEPTION_OPEN',
    exceptionDate: holiday,
    ...MORNING,
    effectiveFrom: addDays(today, -365),
  });

  // 3. Chamber days: yesterday closed, today open (general, walk-in-only), tomorrow scheduled.
  const patients = await prisma.patient.findMany({
    where: { tenantId: tenantA.tenantId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    take: 20,
  });
  if (patients.length < 10) throw new Error('seed: chambers need the patient dataset first');
  let next = 0;
  const nextPatient = () => patients[next++ % patients.length]!.id;

  // Yesterday's day is seeded through a context whose clock sits at 18:00 local yesterday, so the real use
  // cases run (booking a past date is refused, as it should be) and the timestamps read realistically.
  const yesterdayClock = { now: () => new Date(startOfDhakaDay(yesterday).getTime() + 18 * 3_600_000) };
  const past = composeSchedulingAndQueue({ prisma, audit: d.audit, clock: yesterdayClock });
  const yesterdayDay = await past.days.materialize(actorA(), { chamberId: general.id, localDate: yesterday });
  const openedYesterday = await past.days.open(actorA(), yesterdayDay.day.id, {
    expectedRowVersion: yesterdayDay.day.rowVersion,
  });
  // Two bookings that were never served: the close settles them per the documented disposition.
  for (const n of [0, 1]) {
    void n;
    await past.appointments.create(
      { kind: 'staff', actor: actorA() },
      { chamberId: general.id, localDate: yesterday, patientId: nextPatient(), careMode: 'PHYSICAL' },
      { idempotencyKey: newId() },
    );
  }
  await past.days.close(actorA(), yesterdayDay.day.id, { expectedRowVersion: openedYesterday.rowVersion });

  const todayDay = await ctx.days.materialize(actorA(), { chamberId: general.id, localDate: today });
  const openedToday = await ctx.days.open(actorA(), todayDay.day.id, {
    expectedRowVersion: todayDay.day.rowVersion,
  });
  await ctx.days.recordDelay(actorA(), todayDay.day.id, {
    expectedQueueOrderVersion: openedToday.queueOrderVersion,
    delayMinutes: 15,
    reasonCode: 'DOCTOR_LATE',
  });
  const walkInDay = await ctx.days.materialize(actorA(), { chamberId: walkInOnly.id, localDate: today });
  await ctx.days.open(actorA(), walkInDay.day.id, { expectedRowVersion: walkInDay.day.rowVersion });

  // 4. Today's booking mix on the general chamber: booked, confirmed, cancelled, plus a remote booking.
  const booked = [];
  for (let i = 0; i < 6; i++) {
    booked.push(
      await ctx.appointments.create(
        { kind: 'staff', actor: actorA() },
        {
          chamberId: general.id,
          localDate: today,
          patientId: nextPatient(),
          careMode: i === 5 ? 'REMOTE' : 'PHYSICAL',
          reason: i === 0 ? 'DEMO follow-up visit' : null,
        },
        { idempotencyKey: newId() },
      ),
    );
  }
  for (const a of booked.slice(0, 2)) {
    const serial = await prisma.serial.findFirstOrThrow({ where: { appointmentId: a.id } });
    await ctx.serials.confirm({ kind: 'staff', actor: actorA() }, serial.id, {
      expectedRowVersion: serial.rowVersion,
    });
  }
  const cancelled = booked[4]!;
  await ctx.appointments.cancel({ kind: 'staff', actor: actorA() }, cancelled.id, {
    expectedRowVersion: cancelled.rowVersion,
    reason: 'PATIENT_REQUEST',
  });

  // 5. A reschedule chain onto tomorrow, and a booking-only chamber day for tomorrow.
  const tomorrowDay = await ctx.days.materialize(actorA(), { chamberId: general.id, localDate: tomorrow });
  const toMove = booked[3]!;
  const movingSerial = await prisma.serial.findFirstOrThrow({ where: { appointmentId: toMove.id } });
  await ctx.serials.reschedule(
    { kind: 'staff', actor: actorA() },
    movingSerial.id,
    {
      expectedRowVersion: movingSerial.rowVersion,
      targetChamberDayId: tomorrowDay.day.id,
      reason: 'DEMO patient asked for the next day',
    },
    { idempotencyKey: newId() },
  );
  await ctx.days.materialize(actorA(), { chamberId: bookingOnly.id, localDate: tomorrow });
  await ctx.appointments.create(
    { kind: 'staff', actor: actorA() },
    { chamberId: bookingOnly.id, localDate: tomorrow, patientId: nextPatient(), careMode: 'REMOTE' },
    { idempotencyKey: newId() },
  );

  d.report.created.push(
    'chambers (4 in tenant A incl. walk-in-only and booking-only, 1 in tenant B), weekly schedules + holiday',
  );
  d.report.created.push('chamber days (yesterday closed, today open with a booking mix, tomorrow scheduled)');
}

/** Seed assertions for the chamber dataset (SEED-DATA §4). */
export async function verifyChamberSeed(
  prisma: PrismaClient,
  tenantAId: string,
  today: string,
): Promise<string[]> {
  const problems: string[] = [];
  const chambers = await prisma.chamber.findMany({ where: { tenantId: tenantAId } });
  if (chambers.length !== 4) problems.push(`tenant A has ${chambers.length} chambers (expected 4)`);
  const policies = chambers.map((c) => c.defaultQueuePolicy as Record<string, unknown>);
  if (!policies.some((p) => p.advanceBookingEnabled === false)) problems.push('no walk-in-only chamber');
  if (!policies.some((p) => p.walkInsEnabled === false)) problems.push('no booking-only chamber');
  if (!policies.some((p) => p.slotMinutes !== null && p.slotMinutes !== undefined))
    problems.push('no slotted chamber');
  if (
    (await prisma.doctorScheduleRule.count({
      where: { tenantId: tenantAId, ruleType: 'EXCEPTION_CLOSED' },
    })) !== 1
  ) {
    problems.push('exactly one holiday exception expected');
  }
  const days = await prisma.chamberDay.findMany({ where: { tenantId: tenantAId } });
  const byStatus = (s: string) => days.filter((d) => d.status === s).length;
  if (byStatus('CLOSED') < 1) problems.push('no closed chamber day');
  if (byStatus('OPEN') < 2) problems.push('fewer than two open chamber days');
  if (byStatus('SCHEDULED') < 2) problems.push('fewer than two scheduled chamber days');
  if (!days.some((d) => d.localDate.toISOString().slice(0, 10) === today && d.expectedDelayMinutes !== null))
    problems.push("no recorded delay on today's chamber day");
  const statuses = new Set(
    (await prisma.serial.findMany({ where: { tenantId: tenantAId }, select: { status: true } })).map(
      (s) => s.status,
    ),
  );
  for (const s of ['BOOKED', 'CONFIRMED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED']) {
    if (!statuses.has(s)) problems.push(`no serial in status ${s}`);
  }
  const chain = await prisma.integrityChainCheckpoint.count({
    where: { chainKey: { startsWith: 'queue:chamber_day:' } },
  });
  if (chain < 3) problems.push('queue event chains missing');
  return problems;
}
