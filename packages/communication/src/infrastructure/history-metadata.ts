import type { PrismaClient } from '@hmedic/database';
interface BusinessHistorySource {
  read(
    tenantId: string,
    kind: string,
    id: string,
  ): Promise<Array<{ patientId: string; encounterId?: string }>>;
}
/** Metadata only. Contacts, rendered text, provider replies and clinical prose are never selected. */
export class CommunicationHistoryMetadata {
  readonly kinds = ['communication'] as const;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly business: BusinessHistorySource,
  ) {}
  async read(tenantId: string, kind: string, id: string) {
    if (kind !== 'communication') return [];
    const row = await this.prisma.communication.findFirst({
      where: { tenantId, id },
      select: { id: true, patientId: true, businessType: true, businessId: true, createdAt: true },
    });
    if (!row?.patientId) return [];
    const parent =
      row.businessType === 'follow_up_plan'
        ? (await this.business.read(tenantId, 'follow_up_plan', row.businessId))[0]
        : undefined;
    if (row.businessType === 'follow_up_plan' && (!parent || parent.patientId !== row.patientId)) return [];
    return [
      {
        sourceType: kind,
        sourceId: row.id,
        aggregateId: row.id,
        eventName: 'CommunicationCreated',
        patientId: row.patientId,
        occurredAt: row.createdAt,
        visibility: 'OPERATIONAL' as const,
        ...(parent?.encounterId ? { encounterId: parent.encounterId } : {}),
      },
    ];
  }
  async ids(tenantId: string, kind: string, afterId: string | null, limit: number) {
    if (kind !== 'communication') return [];
    return (
      await this.prisma.communication.findMany({
        where: { tenantId, ...(afterId ? { id: { gt: afterId } } : {}) },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: limit,
      })
    ).map((row) => row.id);
  }
}
