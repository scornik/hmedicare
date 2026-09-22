import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import { type Database, dbErrorInfo } from '../../src';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

/**
 * CLIN-001, migration 0007. These invariants are why the clinical tables can be trusted, so they are
 * asserted against the engine rather than against the service that is supposed to respect them. A service
 * can be bypassed by a script, a repair job, or the next person's use case; a unique key cannot.
 *
 * Written through the typed client rather than raw SQL: the schema has 44 tables, and a hand-written
 * INSERT discovers its required columns one failure at a time while the compiler simply lists them.
 */
let db: Database;

beforeAll(async () => {
  db = openTestDatabase();
  await truncateAll();
});
afterAll(async () => {
  await db?.close();
});

/** The minimum a clinical row needs above it. */
async function scaffold() {
  const now = new Date();
  const tenantId = newId();
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
      name: 'DEMO schema',
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
      displayName: 'Dr. Schema',
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
      name: 'DEMO Clinic',
      nameNormalizedHash: 'b'.repeat(64),
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
      // TIME columns: the client wants a Date, and only the time part is stored.
      localStartTime: new Date('1970-01-01T09:00:00.000Z'),
      localEndTime: new Date('1970-01-01T17:00:00.000Z'),
      timezone: 'Asia/Dhaka',
      status: 'OPEN',
      queuePolicy: {},
      createdAt: now,
      updatedAt: now,
    },
  });
  await p.serial.create({
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
  return { tenantId, doctorProfileId, patientId, chamberId, serialId, now };
}

type Scaffold = Awaited<ReturnType<typeof scaffold>>;

function encounterData(s: Scaffold, overrides: Record<string, unknown> = {}) {
  return {
    id: newId(),
    tenantId: s.tenantId,
    patientId: s.patientId,
    doctorProfileId: s.doctorProfileId,
    chamberId: s.chamberId,
    serialId: s.serialId,
    careMode: 'PHYSICAL',
    status: 'IN_PROGRESS',
    startedAt: s.now,
    createdAt: s.now,
    updatedAt: s.now,
    ...overrides,
  };
}

/** The kind of database error, through the project's own mapper rather than a raw errno. */
async function kindOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return 'NONE';
  } catch (error) {
    return dbErrorInfo(error).kind;
  }
}

describe('0007 encounters: invariants the engine enforces', () => {
  it('permits only one live encounter per serial', async () => {
    const s = await scaffold();
    await db.prisma.encounter.create({ data: encounterData(s) });
    // The point of `uq_encounters_serial`: two doctors starting the same serial cannot both win, whatever
    // the service layer does or fails to do.
    expect(await kindOf(db.prisma.encounter.create({ data: encounterData(s) }))).toBe('UNIQUE_VIOLATION');
  });

  it('frees the serial again once an encounter is voided as entered in error', async () => {
    const s = await scaffold();
    const first = await db.prisma.encounter.create({ data: encounterData(s) });
    await db.prisma.encounter.update({
      where: { id: first.id },
      data: { status: 'ENTERED_IN_ERROR', enteredInErrorReason: 'DEMO wrong patient' },
    });
    // The generated key drops that row, so a mistake can be corrected rather than blocking the serial.
    expect(await kindOf(db.prisma.encounter.create({ data: encounterData(s) }))).toBe('NONE');
  });

  it('requires a reason before an encounter can be called entered in error', async () => {
    const s = await scaffold();
    const e = await db.prisma.encounter.create({ data: encounterData(s) });
    expect(
      await kindOf(db.prisma.encounter.update({ where: { id: e.id }, data: { status: 'ENTERED_IN_ERROR' } })),
    ).toBe('CHECK_VIOLATION');
  });

  it('refuses a status outside the documented set', async () => {
    const s = await scaffold();
    expect(await kindOf(db.prisma.encounter.create({ data: encounterData(s, { status: 'FINISHED' }) }))).toBe(
      'CHECK_VIOLATION',
    );
  });

  it('refuses a covering doctor recorded without the grant that allowed it', async () => {
    const s = await scaffold();
    // Half the pair is worse than neither: it claims someone covered without saying under what authority.
    expect(
      await kindOf(
        db.prisma.encounter.create({
          data: encounterData(s, { coveringDoctorProfileId: s.doctorProfileId }),
        }),
      ),
    ).toBe('CHECK_VIOLATION');
  });

  it('permits only one open draft per encounter', async () => {
    const s = await scaffold();
    const encounter = await db.prisma.encounter.create({ data: encounterData(s) });
    const draft = (status = 'DRAFT') => ({
      id: newId(),
      tenantId: s.tenantId,
      encounterId: encounter.id,
      authorDoctorProfileId: s.doctorProfileId,
      status,
      sectionSources: [],
      createdAt: s.now,
      updatedAt: s.now,
    });
    await db.prisma.encounterNote.create({ data: draft() });
    // Two tabs cannot each open their own draft and silently diverge.
    expect(await kindOf(db.prisma.encounterNote.create({ data: draft() }))).toBe('UNIQUE_VIOLATION');
    // A locked note is not an open draft, so it does not hold the key.
    expect(await kindOf(db.prisma.encounterNote.create({ data: draft('SIGNED_LOCKED') }))).toBe('NONE');
  });

  it('requires a reason on every revision after the first, and never reuses one', async () => {
    const s = await scaffold();
    const encounter = await db.prisma.encounter.create({ data: encounterData(s) });
    const note = await db.prisma.encounterNote.create({
      data: {
        id: newId(),
        tenantId: s.tenantId,
        encounterId: encounter.id,
        authorDoctorProfileId: s.doctorProfileId,
        status: 'DRAFT',
        sectionSources: [],
        createdAt: s.now,
        updatedAt: s.now,
      },
    });
    const version = (revision: number, correctionReason: string | null) =>
      db.prisma.encounterNoteVersion.create({
        data: {
          id: newId(),
          tenantId: s.tenantId,
          encounterId: encounter.id,
          noteId: note.id,
          revision,
          signedByDoctorProfileId: s.doctorProfileId,
          signedAt: s.now,
          sectionSources: [],
          correctionReason,
          contentSha256: 'c'.repeat(64),
          rowHash: 'd'.repeat(64),
          createdAt: s.now,
        },
      });
    expect(await kindOf(version(1, null))).toBe('NONE');
    // A correction that does not say why is not a correction, it is a rewrite.
    expect(await kindOf(version(2, null))).toBe('CHECK_VIOLATION');
    expect(await kindOf(version(2, 'DEMO corrected the examination'))).toBe('NONE');
    // And a revision number cannot be reused, so the history cannot fork.
    expect(await kindOf(version(2, 'DEMO again'))).toBe('UNIQUE_VIOLATION');
  });
});
