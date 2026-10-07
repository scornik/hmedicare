import type { PrismaClient } from '@hmedic/database';

/** ClinicalHistoryReadPort metadata facet. No mutable draft or clinical-text field is selected. */
export class ClinicalHistoryMetadata {
  readonly kinds = ['encounter', 'encounter_note_version', 'diagnosis', 'symptom_observation'] as const;
  constructor(private readonly prisma: PrismaClient) {}
  async read(tenantId: string, kind: string, id: string) {
    if (kind === 'encounter') {
      const r = await this.prisma.encounter.findFirst({
        where: { tenantId, id },
        select: {
          id: true,
          patientId: true,
          startedAt: true,
          completedAt: true,
          status: true,
          updatedAt: true,
        },
      });
      if (!r) return [];
      const base = {
        sourceType: kind,
        sourceId: r.id,
        aggregateId: r.id,
        patientId: r.patientId,
        encounterId: r.id,
        visibility: 'CLINICAL' as const,
      };
      return [
        {
          ...base,
          eventName: 'EncounterStarted',
          occurredAt: r.startedAt,
          redactedAt: r.status === 'ENTERED_IN_ERROR' ? r.updatedAt : null,
          redactionReason: 'ENTERED_IN_ERROR' as const,
        },
        ...(r.completedAt ? [{ ...base, eventName: 'EncounterCompleted', occurredAt: r.completedAt }] : []),
      ];
    }
    if (kind === 'encounter_note_version') {
      const r = await this.prisma.encounterNoteVersion.findFirst({
        where: { tenantId, id },
        select: {
          id: true,
          encounterId: true,
          noteId: true,
          signedAt: true,
          revision: true,
        },
      });
      if (!r) return [];
      const encounter = await this.prisma.encounter.findFirst({
        where: { tenantId, id: r.encounterId },
        select: { patientId: true },
      });
      if (!encounter) return [];
      return [
        {
          sourceType: kind,
          sourceId: r.id,
          aggregateId: r.noteId,
          patientId: encounter.patientId,
          encounterId: r.encounterId,
          eventName: r.revision === 1 ? 'EncounterNoteSigned' : 'EncounterNoteAmended',
          occurredAt: r.signedAt,
          visibility: 'CLINICAL' as const,
        },
      ];
    }
    if (kind === 'diagnosis') {
      const r = await this.prisma.diagnosis.findFirst({
        where: { tenantId, id },
        select: {
          id: true,
          patientId: true,
          encounterId: true,
          createdAt: true,
          voidedAt: true,
        },
      });
      return r
        ? [
            {
              sourceType: kind,
              sourceId: r.id,
              aggregateId: r.id,
              patientId: r.patientId,
              encounterId: r.encounterId,
              eventName: 'DiagnosisRecorded',
              occurredAt: r.createdAt,
              visibility: 'CLINICAL' as const,
              redactedAt: r.voidedAt,
              redactionReason: 'VOIDED' as const,
            },
          ]
        : [];
    }
    if (kind === 'symptom_observation') {
      const r = await this.prisma.symptomObservation.findFirst({
        where: { tenantId, id },
        select: {
          id: true,
          patientId: true,
          encounterId: true,
          createdAt: true,
        },
      });
      return r
        ? [
            {
              sourceType: kind,
              sourceId: r.id,
              aggregateId: r.id,
              patientId: r.patientId,
              encounterId: r.encounterId,
              eventName: 'SymptomRecorded',
              occurredAt: r.createdAt,
              visibility: 'CLINICAL' as const,
            },
          ]
        : [];
    }
    return [];
  }
  async ids(tenantId: string, kind: string, afterId: string | null, limit: number) {
    const args = {
      where: { tenantId, ...(afterId ? { id: { gt: afterId } } : {}) },
      select: { id: true },
      orderBy: { id: 'asc' as const },
      take: limit,
    };
    const rows =
      kind === 'encounter'
        ? await this.prisma.encounter.findMany(args)
        : kind === 'encounter_note_version'
          ? await this.prisma.encounterNoteVersion.findMany(args)
          : kind === 'diagnosis'
            ? await this.prisma.diagnosis.findMany(args)
            : kind === 'symptom_observation'
              ? await this.prisma.symptomObservation.findMany(args)
              : [];
    return rows.map((r) => r.id);
  }
}
