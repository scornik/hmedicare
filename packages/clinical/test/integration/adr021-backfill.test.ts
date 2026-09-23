import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import { openTestDatabase, rawConnection, truncateAll } from '../../../../tests/support/db';

/**
 * Mandatory test 12: the ADR-021 legacy migration is idempotent, correct on seeded Stage 5 data, and safe
 * to re-run.
 *
 * Stage 5 moved serials through IN_CONSULTATION and COMPLETED with nothing behind them. Stage 6 says
 * every such serial has an encounter, so the ones already in the database have to be given one or the
 * clinical model starts life with rows that contradict it.
 *
 * The migration has already run by the time this suite starts — it is part of the schema — so each case
 * plants Stage 5 shaped rows and runs the statements again, which is exactly what re-running it means.
 */
const db = openTestDatabase();
const MIGRATION = path.resolve(
  __dirname,
  '../../../database/prisma/migrations/202609230900_0007_adr021_backfill/migration.sql',
);

/** The migration's statements, as the deploy would run them. */
function statements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}

async function runBackfill(): Promise<void> {
  const conn = await rawConnection();
  try {
    for (const s of statements()) await conn.query(s);
  } finally {
    await conn.end();
  }
}

afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

/** A Stage 5 chamber day with serials in the states the interim transitions could leave behind. */
async function stageFiveDay() {
  const now = new Date();
  const earlier = new Date(now.getTime() - 60 * 60_000);
  const tenantId = newId();
  const userId = newId();
  const doctorProfileId = newId();
  const clinicId = newId();
  const chamberId = newId();
  const chamberDayId = newId();
  const p = db.prisma;

  await p.tenant.create({
    data: {
      id: tenantId,
      name: 'DEMO legacy',
      slug: tenantId,
      status: 'ACTIVE',
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
      displayName: 'Dr. Legacy',
      specialties: [],
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.clinic.create({
    data: {
      id: clinicId,
      tenantId,
      name: 'DEMO Clinic',
      nameNormalizedHash: 'a'.repeat(64),
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
      name: 'DEMO Chamber',
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
      localStartTime: new Date('1970-01-01T09:00:00.000Z'),
      localEndTime: new Date('1970-01-01T17:00:00.000Z'),
      timezone: 'Asia/Dhaka',
      status: 'OPEN',
      queuePolicy: {},
      createdAt: now,
      updatedAt: now,
    },
  });

  let n = 0;
  const serial = async (status: string, extra: Record<string, unknown> = {}) => {
    const patientId = newId();
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
    return p.serial.create({
      data: {
        id: newId(),
        tenantId,
        chamberDayId,
        patientId,
        serialNumber: ++n,
        source: 'WALK_IN',
        careMode: 'PHYSICAL',
        status,
        createdAt: earlier,
        updatedAt: now,
        ...extra,
      },
    });
  };

  return {
    tenantId,
    doctorProfileId,
    chamberId,
    now,
    earlier,
    // The two states ADR-021 could leave behind, plus states that must be left alone.
    inConsultation: await serial('IN_CONSULTATION', { consultationStartedAt: earlier }),
    completed: await serial('COMPLETED', { consultationStartedAt: earlier, completedAt: now }),
    completedNoTimes: await serial('COMPLETED'),
    waiting: await serial('WAITING'),
    cancelled: await serial('CANCELLED'),
  };
}

describe('ADR-021 legacy backfill (test 12)', () => {
  it('gives every interim serial an encounter, and leaves the others alone', async () => {
    const s = await stageFiveDay();
    await runBackfill();

    const encounters = await db.prisma.encounter.findMany({ where: { tenantId: s.tenantId } });
    expect(encounters).toHaveLength(3);
    expect(encounters.every((e) => e.legacyInterim)).toBe(true);
    // No note: a consultation recorded only as a queue transition has no clinical content, and an empty
    // draft would suggest a doctor opened a record they never did.
    expect(await db.prisma.encounterNote.count({ where: { tenantId: s.tenantId } })).toBe(0);

    const byStatus = Object.fromEntries(encounters.map((e) => [e.serialId, e]));
    expect(byStatus[s.inConsultation.id]?.status).toBe('IN_PROGRESS');
    expect(byStatus[s.completed.id]?.status).toBe('COMPLETED');
    expect(byStatus[s.completed.id]?.completedAt).not.toBeNull();
    expect(byStatus[s.inConsultation.id]?.completedAt).toBeNull();

    // The doctor and chamber come from the day the serial belonged to.
    for (const e of encounters) {
      expect(e.doctorProfileId).toBe(s.doctorProfileId);
      expect(e.chamberId).toBe(s.chamberId);
      expect(e.startedAt.getTime()).toBeLessThanOrEqual((e.completedAt ?? e.startedAt).getTime());
    }

    // Serials that never reached a consultation are untouched.
    for (const untouched of [s.waiting, s.cancelled]) {
      const row = await db.prisma.serial.findFirstOrThrow({ where: { id: untouched.id } });
      expect(row.encounterId).toBeNull();
    }
  });

  it('points each serial at its new encounter', async () => {
    const s = await stageFiveDay();
    await runBackfill();
    const row = await db.prisma.serial.findFirstOrThrow({ where: { id: s.inConsultation.id } });
    expect(row.encounterId).toBe(s.inConsultation.id);
  });

  it('is idempotent: running it again changes nothing', async () => {
    const s = await stageFiveDay();
    await runBackfill();
    const first = await db.prisma.encounter.findMany({
      where: { tenantId: s.tenantId },
      orderBy: { id: 'asc' },
    });

    await runBackfill();
    await runBackfill();

    const after = await db.prisma.encounter.findMany({
      where: { tenantId: s.tenantId },
      orderBy: { id: 'asc' },
    });
    expect(after).toHaveLength(first.length);
    // Not merely the same count: the same rows, with their row versions untouched. A backfill that
    // rewrote rows on every deploy would churn the audit trail for no reason.
    expect(after).toEqual(first);
  });

  it('leaves a serial that already has a real encounter completely alone', async () => {
    const s = await stageFiveDay();
    // A Stage 6 encounter, written properly, on a serial in the same state.
    const real = await db.prisma.encounter.create({
      data: {
        id: newId(),
        tenantId: s.tenantId,
        patientId: s.inConsultation.patientId,
        doctorProfileId: s.doctorProfileId,
        chamberId: s.chamberId,
        serialId: s.inConsultation.id,
        careMode: 'PHYSICAL',
        status: 'IN_PROGRESS',
        startedAt: s.now,
        createdAt: s.now,
        updatedAt: s.now,
      },
    });
    await db.prisma.serial.update({
      where: { id: s.inConsultation.id },
      data: { encounterId: real.id },
    });

    await runBackfill();

    const onSerial = await db.prisma.encounter.findMany({
      where: { tenantId: s.tenantId, serialId: s.inConsultation.id },
    });
    expect(onSerial).toHaveLength(1);
    expect(onSerial[0]?.id).toBe(real.id);
    expect(onSerial[0]?.legacyInterim).toBe(false);
  });

  it('never violates the one-encounter-per-serial key', async () => {
    const s = await stageFiveDay();
    await runBackfill();
    await runBackfill();
    const rows = await db.prisma.encounter.groupBy({
      by: ['serialId'],
      where: { tenantId: s.tenantId, status: { not: 'ENTERED_IN_ERROR' } },
      _count: true,
    });
    for (const r of rows) expect(r._count, `serial ${r.serialId}`).toBe(1);
  });
});
