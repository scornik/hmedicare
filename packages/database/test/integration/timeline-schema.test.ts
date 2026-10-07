import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import { type Database, type Prisma } from '@hmedic/database';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';

let db: Database;
let tenantId: string;
let patientId: string;
const now = new Date();
beforeAll(() => {
  db = openTestDatabase();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await truncateAll();
  const base = await chamberWithCalledSerial(db.prisma, 'timeline');
  tenantId = base.tenantId;
  patientId = base.patientId;
});

function entry(over: Partial<Prisma.TimelineEventUncheckedCreateInput> = {}) {
  return db.prisma.timelineEvent.create({
    data: {
      id: newId(),
      tenantId,
      patientId,
      seq: 1,
      eventType: 'doctor_note',
      occurredAt: now,
      sourceType: 'encounter_note',
      sourceId: newId(),
      summary: 'Note signed',
      visibility: 'CLINICAL',
      structuredRefs: {},
      projectionVersion: 1,
      sourceEventId: newId(),
      prevRowHash: null,
      rowHash: 'a'.repeat(64),
      ...over,
    },
  });
}

describe('timeline schema enforces projection boundaries', () => {
  it('keeps Bangla templates and JSON references intact', async () => {
    const row = await entry({ summary: 'নোট স্বাক্ষরিত', structuredRefs: { encounterId: newId() } });
    expect(row.summary).toBe('নোট স্বাক্ষরিত');
    expect(row.structuredRefs).toHaveProperty('encounterId');
  });
  it('rejects cross-tenant patient references', async () => {
    const other = await chamberWithCalledSerial(db.prisma, 'other');
    await expect(entry({ patientId: other.patientId })).rejects.toThrow();
  });
  it('deduplicates source events within a projection version', async () => {
    const first = await entry();
    await expect(entry({ seq: 2, sourceEventId: first.sourceEventId })).rejects.toThrow();
    await expect(
      entry({ seq: 2, sourceEventId: first.sourceEventId, projectionVersion: 2 }),
    ).resolves.toBeDefined();
  });
  it('rejects duplicate sequence numbers across projection versions', async () => {
    await entry();
    await expect(entry({ projectionVersion: 2 })).rejects.toThrow();
  });
  it.each([
    { eventType: 'UNKNOWN' },
    { visibility: 'PUBLIC' },
    { seq: 0 },
    { projectionVersion: 0 },
    { eventType: 'REDACTED' },
    { redactsTimelineEventId: newId(), redactionReasonCode: 'ENTERED_IN_ERROR' },
  ])('rejects invalid row %j', async (over) => {
    await expect(entry(over)).rejects.toThrow();
  });
  it('adds a marker without changing the original', async () => {
    const original = await entry();
    await entry({
      seq: 2,
      eventType: 'REDACTED',
      redactsTimelineEventId: original.id,
      redactionReasonCode: 'ENTERED_IN_ERROR',
    });
    expect(await db.prisma.timelineEvent.findUnique({ where: { id: original.id } })).toEqual(original);
  });
  it('rejects markers targeting a different patient', async () => {
    const original = await entry();
    const otherPatientId = newId();
    await db.prisma.patient.create({
      data: {
        id: otherPatientId,
        tenantId,
        medicalRecordNumber: otherPatientId,
        legalName: 'SYNTHETIC Other',
        displayName: 'SYNTHETIC Other',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });
    await expect(
      entry({
        patientId: otherPatientId,
        seq: 1,
        eventType: 'REDACTED',
        redactsTimelineEventId: original.id,
        redactionReasonCode: 'ENTERED_IN_ERROR',
      }),
    ).rejects.toThrow();
  });
  it('rejects a checkpoint with an invalid version or missing tenant', async () => {
    const data = {
      projectionName: 'timeline',
      tenantId,
      lastOutboxOccurredAt: now,
      lastEventId: newId(),
      projectionVersion: 1,
      updatedAt: now,
    };
    await expect(
      db.prisma.projectionCheckpoint.create({ data: { ...data, projectionVersion: 0 } }),
    ).rejects.toThrow();
    await expect(
      db.prisma.projectionCheckpoint.create({ data: { ...data, tenantId: newId() } }),
    ).rejects.toThrow();
    await db.prisma.projectionCheckpoint.create({ data });
    await expect(db.prisma.projectionCheckpoint.create({ data })).rejects.toThrow();
  });
});
