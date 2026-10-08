import { FollowUpHistoryMetadata } from '@hmedic/follow-up';
import type { PrismaClient } from '@hmedic/database';
import { ClinicalHistoryMetadata } from '@hmedic/clinical';
import { PrescriptionHistoryMetadata } from '@hmedic/prescriptions';
import { QueueHistoryMetadata } from '@hmedic/queue';
import { SchedulingHistoryMetadata } from '@hmedic/scheduling';
import { DocumentHistoryMetadata } from '@hmedic/laboratory-documents';
import type { HistoryMetadataPort } from '../application/history-port';
export function timelineSources(prisma: PrismaClient): HistoryMetadataPort[] {
  return [
    new ClinicalHistoryMetadata(prisma),
    new PrescriptionHistoryMetadata(prisma),
    new QueueHistoryMetadata(prisma),
    new SchedulingHistoryMetadata(prisma),
    new FollowUpHistoryMetadata(prisma),
    new DocumentHistoryMetadata(prisma),
  ];
}
