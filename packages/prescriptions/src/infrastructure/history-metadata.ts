import type { PrismaClient } from '@hmedic/database';

/** Only approved (including subsequently voided) records belong to history. */
export class PrescriptionHistoryMetadata {
  readonly kinds = ['prescription'] as const;
  constructor(private readonly prisma: PrismaClient) {}
  async read(tenantId: string, kind: string, id: string) {
    if (kind !== 'prescription') return [];
    const r = await this.prisma.prescription.findFirst({
      where: { tenantId, id },
      select: {
        id: true,
        patientId: true,
        encounterId: true,
        approvedAt: true,
        voidedAt: true,
      },
    });
    if (!r?.approvedAt) return [];
    return [
      {
        sourceType: kind,
        sourceId: r.id,
        aggregateId: r.id,
        patientId: r.patientId,
        encounterId: r.encounterId,
        eventName: 'PrescriptionApproved',
        occurredAt: r.approvedAt,
        visibility: 'PATIENT_SHARED' as const,
        redactedAt: r.voidedAt,
        redactionReason: 'VOIDED' as const,
      },
    ];
  }
  async ids(tenantId: string, kind: string, afterId: string | null, limit: number) {
    if (kind !== 'prescription') return [];
    return (
      await this.prisma.prescription.findMany({
        where: { tenantId, approvedAt: { not: null }, ...(afterId ? { id: { gt: afterId } } : {}) },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: limit,
      })
    ).map((r) => r.id);
  }
}
