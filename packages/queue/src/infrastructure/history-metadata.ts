import type { PrismaClient } from '@hmedic/database';

export const SERIAL_HISTORY_CODES: Readonly<Record<string, string>> = {
  SerialIssued: 'SERIAL_ISSUED',
  SerialConfirmed: 'CONFIRMED',
  SerialCheckedIn: 'CHECKED_IN',
  SerialRemoteReady: 'REMOTE_READY',
  SerialWaiting: 'WAITING',
  SerialCalled: 'CALLED',
  SerialSkipped: 'SKIPPED',
  SerialRecalled: 'RECALLED',
  SerialNoShow: 'NO_SHOW',
  SerialCancelled: 'CANCELLED',
  SerialRescheduled: 'RESCHEDULED',
  SerialCompleted: 'COMPLETED',
};
const SELECT = { id: true, serialId: true, occurredAt: true, eventType: true } as const;
export class QueueHistoryMetadata {
  readonly kinds = ['queue_event'] as const;
  constructor(private readonly prisma: PrismaClient) {}
  async read(tenantId: string, kind: string, id: string) {
    if (kind !== 'queue_event') return [];
    const first = await this.prisma.queueEvent.findFirst({ where: { tenantId, id }, select: SELECT });
    if (!first?.serialId) return [];
    const serial = await this.prisma.serial.findFirst({
      where: { tenantId, id: first.serialId },
      select: { patientId: true },
    });
    if (!serial) return [];
    // Walk-in issuance commits check-in/waiting ledger rows together but emits only SerialIssued.
    const rows =
      first.eventType === 'SERIAL_ISSUED'
        ? await this.prisma.queueEvent.findMany({
            where: {
              tenantId,
              serialId: first.serialId,
              occurredAt: first.occurredAt,
              eventType: { in: ['SERIAL_ISSUED', 'CHECKED_IN', 'WAITING'] },
            },
            select: SELECT,
            orderBy: { seq: 'asc' },
          })
        : [first];
    return rows.map((r) => ({
      sourceType: kind,
      sourceId: r.id,
      aggregateId: first.serialId!,
      eventName: 'QueueRecord',
      eventCode: r.eventType,
      patientId: serial.patientId,
      occurredAt: r.occurredAt,
      visibility: 'OPERATIONAL' as const,
    }));
  }
  async ids(tenantId: string, kind: string, afterId: string | null, limit: number) {
    if (kind !== 'queue_event') return [];
    return (
      await this.prisma.queueEvent.findMany({
        where: { tenantId, serialId: { not: null }, ...(afterId ? { id: { gt: afterId } } : {}) },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: limit,
      })
    ).map((r) => r.id);
  }
  async legacyQueueId(tenantId: string, serialId: string, eventName: string, occurredAt: Date) {
    const code = SERIAL_HISTORY_CODES[eventName];
    if (!code) return null;
    const rows = await this.prisma.queueEvent.findMany({
      where: { tenantId, serialId, eventType: code, occurredAt: { lte: occurredAt } },
      select: { id: true, occurredAt: true },
      orderBy: [{ occurredAt: 'desc' }, { seq: 'desc' }],
      take: 2,
    });
    // Do not guess between legacy transitions stamped at the same instant by a synthetic clock.
    if (rows.length > 1 && rows[0]!.occurredAt.getTime() === rows[1]!.occurredAt.getTime()) return null;
    return rows[0]?.id ?? null;
  }
}
