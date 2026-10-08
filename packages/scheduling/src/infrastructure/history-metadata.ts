import type { PrismaClient } from '@hmedic/database';

export class SchedulingHistoryMetadata {
  readonly kinds = ['appointment'] as const;
  constructor(private readonly prisma: PrismaClient) {}
  async read(tenantId: string, kind: string, id: string) {
    if (kind !== 'appointment') return [];
    const r = await this.prisma.appointment.findFirst({
      where: { tenantId, id },
      select: { id: true, patientId: true, createdAt: true, chamberId: true },
    });
    return r
      ? [
          {
            sourceType: kind,
            sourceId: r.id,
            aggregateId: r.id,
            patientId: r.patientId,
            chamberId: r.chamberId,
            eventName: 'AppointmentBooked',
            occurredAt: r.createdAt,
            visibility: 'OPERATIONAL' as const,
          },
        ]
      : [];
  }
  async ids(tenantId: string, kind: string, afterId: string | null, limit: number) {
    if (kind !== 'appointment') return [];
    return (
      await this.prisma.appointment.findMany({
        where: { tenantId, ...(afterId ? { id: { gt: afterId } } : {}) },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: limit,
      })
    ).map((r) => r.id);
  }
}
