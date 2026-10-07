import type { PrismaClient } from '@hmedic/database';

/** Generated prescription PDFs are linked from the approved prescription rather than duplicated here. */
export class DocumentHistoryMetadata {
  readonly kinds = ['document'] as const;
  constructor(private readonly prisma: PrismaClient) {}
  async read(tenantId: string, kind: string, id: string) {
    if (kind !== 'document') return [];
    const r = await this.prisma.document.findFirst({
      where: { tenantId, id },
      select: {
        id: true,
        patientId: true,
        encounterId: true,
        category: true,
        status: true,
        accessPolicy: true,
        currentRevision: true,
        redactedAt: true,
        createdAt: true,
      },
    });
    if (
      !r ||
      r.category === 'AI_RAW' ||
      r.category === 'PRESCRIPTION_PDF' ||
      (!r.redactedAt && (r.accessPolicy === 'AUDIT_ONLY' || r.status !== 'AVAILABLE'))
    )
      return [];
    const version = await this.prisma.documentVersion.findFirst({
      where: {
        tenantId,
        documentId: id,
        scanStatus: 'CLEAN',
        ...(r.redactedAt ? {} : { revision: r.currentRevision ?? 0 }),
      },
      orderBy: { revision: 'desc' },
      select: { scanStatus: true, scannedAt: true },
    });
    if (version?.scanStatus !== 'CLEAN') return [];
    return [
      {
        sourceType: kind,
        sourceId: r.id,
        aggregateId: r.id,
        patientId: r.patientId,
        ...(r.encounterId ? { encounterId: r.encounterId } : {}),
        eventName: 'DocumentScanCompleted',
        occurredAt: version.scannedAt ?? r.createdAt,
        visibility: r.accessPolicy === 'PATIENT_SHARED' ? ('PATIENT_SHARED' as const) : ('CLINICAL' as const),
        redactedAt: r.redactedAt,
        redactionReason: 'DOCUMENT_REDACTED' as const,
      },
    ];
  }
  async exists(tenantId: string, kind: string, id: string) {
    return (
      kind === 'document' &&
      !!(await this.prisma.document.findFirst({ where: { tenantId, id }, select: { id: true } }))
    );
  }
  async ids(tenantId: string, kind: string, afterId: string | null, limit: number) {
    if (kind !== 'document') return [];
    return (
      await this.prisma.document.findMany({
        where: { tenantId, ...(afterId ? { id: { gt: afterId } } : {}) },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: limit,
      })
    ).map((r) => r.id);
  }
}
