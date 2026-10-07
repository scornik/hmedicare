import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VerifyAppendOnlyChains } from '@hmedic/audit';
import { type Database, withTransaction } from '@hmedic/database';
import { newId } from '@hmedic/kernel';
import { chamberWithCalledSerial, tenantContext } from '../../../../tests/support/clinical';
import { openTestDatabase, rawConnection, truncateAll } from '../../../../tests/support/db';
import {
  TimelineRepository,
  timelineChainKey,
  timelineChainSource,
  type TimelineAppendInput,
} from '../../src/public';

let db: Database;
let base: Awaited<ReturnType<typeof chamberWithCalledSerial>>;
const repo = new TimelineRepository();
const now = new Date();
beforeAll(() => {
  db = openTestDatabase();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await truncateAll();
  base = await chamberWithCalledSerial(db.prisma, 'timeline-chain');
});
function input(over: Partial<TimelineAppendInput> = {}): TimelineAppendInput {
  return {
    patientId: base.patientId,
    eventType: 'doctor_note',
    occurredAt: now,
    sourceType: 'encounter_note',
    sourceId: newId(),
    sourceEventId: newId(),
    visibility: 'CLINICAL',
    structuredRefs: {},
    projectionVersion: 1,
    ...over,
  };
}
function append(event: TimelineAppendInput) {
  return withTransaction(db.prisma, (tx) => repo.append(tx, tenantContext(base.tenantId), event, now));
}
async function verify() {
  return new VerifyAppendOnlyChains(db.prisma, [timelineChainSource]).run({
    full: true,
    checkpointKey: timelineChainKey(base.tenantId, base.patientId),
  });
}

describe('append-only timeline repository', () => {
  it('has no update or delete surface', () => {
    expect(Object.getOwnPropertyNames(TimelineRepository.prototype).sort()).toEqual([
      'append',
      'constructor',
    ]);
  });
  it('serializes concurrent duplicate deliveries without gaps', async () => {
    const event = input();
    const rows = await Promise.all(Array.from({ length: 8 }, () => append(event)));
    expect(new Set(rows.map((row) => row.id)).size).toBe(1);
    expect(rows[0]?.seq).toBe(1);
    const next = await append(input());
    expect(next.seq).toBe(2);
    expect(next.prevRowHash).toBe(rows[0]?.rowHash);
    expect(await verify()).toMatchObject([{ ok: true, rows: 2 }]);
  });
  it('chains distinct events concurrently and across rebuild versions', async () => {
    await Promise.all(Array.from({ length: 5 }, () => append(input())));
    const row = await append(input({ projectionVersion: 2 }));
    expect(row.seq).toBe(6);
    expect(await verify()).toMatchObject([{ ok: true, rows: 6 }]);
  });
  it('rolls back chain allocation together with a failed source write', async () => {
    await expect(
      withTransaction(db.prisma, async (tx) => {
        await repo.append(tx, tenantContext(base.tenantId), input(), now);
        throw new Error('synthetic failure');
      }),
    ).rejects.toThrow('synthetic failure');
    expect((await append(input())).seq).toBe(1);
    expect(await verify()).toMatchObject([{ ok: true, rows: 1 }]);
  });
  it('refuses PHI in structured references', async () => {
    await expect(
      append(input({ structuredRefs: { patientName: 'SYNTHETIC Patient' } })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('appends a redaction and preserves its original, but rejects marker-on-marker', async () => {
    const original = await append(input());
    const marker = await append(
      input({
        eventType: 'REDACTED',
        redactsTimelineEventId: original.id,
        redactionReasonCode: 'ENTERED_IN_ERROR',
      }),
    );
    expect(await db.prisma.timelineEvent.findUnique({ where: { id: original.id } })).toEqual(original);
    await expect(
      append(
        input({
          eventType: 'REDACTED',
          redactsTimelineEventId: marker.id,
          redactionReasonCode: 'ENTERED_IN_ERROR',
        }),
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(await verify()).toMatchObject([{ ok: true, rows: 2 }]);
  });
  it('detects tampering that bypasses the repository', async () => {
    const row = await append(input());
    const conn = await rawConnection();
    try {
      await conn.query('UPDATE timeline_events SET visibility = ? WHERE id = ?', ['PATIENT_SHARED', row.id]);
    } finally {
      await conn.end();
    }
    expect(await verify()).toMatchObject([{ ok: false, break: { reason: 'HASH_MISMATCH' } }]);
  });
});
