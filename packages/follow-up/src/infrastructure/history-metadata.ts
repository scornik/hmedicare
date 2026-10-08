import type { PrismaClient } from '@hmedic/database';
/** Timeline facet; no reason or instructions are selected. */
export class FollowUpHistoryMetadata {
  readonly kinds = ['follow_up_plan'] as const;
  constructor(private readonly prisma: PrismaClient) {}
  async read(tenantId: string, kind: string, id: string) {
    if (kind !== 'follow_up_plan') return [];
    const p = await this.prisma.followUpPlan.findFirst({
      where: { tenantId, id },
      select: { id: true, patientId: true, sourceEncounterId: true, createdAt: true },
    });
    return p
      ? [
          {
            sourceType: kind,
            sourceId: p.id,
            aggregateId: p.id,
            patientId: p.patientId,
            encounterId: p.sourceEncounterId,
            eventName: 'FollowUpPlanCreated',
            occurredAt: p.createdAt,
            visibility: 'PATIENT_SHARED' as const,
          },
        ]
      : [];
  }
  async ids(tenantId: string, kind: string, afterId: string | null, limit: number) {
    if (kind !== 'follow_up_plan') return [];
    return (
      await this.prisma.followUpPlan.findMany({
        where: { tenantId, ...(afterId ? { id: { gt: afterId } } : {}) },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: limit,
      })
    ).map((p) => p.id);
  }
}
