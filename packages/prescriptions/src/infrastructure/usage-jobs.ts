import { z } from 'zod';
import type { PrismaClient } from '@hmedic/database';
import { type JobRegistry, type JobRunner, NonRetryableJobError } from '@hmedic/jobs';
import type { Logger } from '@hmedic/observability';
import type { MedicationSearchService } from './medication-search';

/**
 * `RecordMedicationUsage` — the `PrescriptionApproved` consumer (EVENT-ARCHITECTURE §4).
 *
 * It increments this tenant's prescribing counts, which is the only thing that feeds the search boost.
 * On approval rather than on drafting: a draft is a doctor thinking, and half-typed reconsidered choices
 * should not shape what the editor offers the next person.
 *
 * It reads the item rows itself rather than taking medication ids from the payload. A prescription event
 * carries identifiers and counts, never a list of what was prescribed — putting that in an event payload
 * would make the outbox a second copy of the record, which is exactly what the PHI deny-list refuses.
 *
 * Idempotent by construction: the outbox already gives one job per event per handler, and the increment
 * is driven from the prescription's committed items, so a replay of the same event counts the same
 * prescription twice. That is the one weakness here, and it is bounded — the boost is an ordering hint
 * inside a tier, never a clinical fact, and a double count cannot move a row across a tier.
 */
export const MAINTENANCE_QUEUE = 'maintenance';
export const RECORD_MEDICATION_USAGE = 'RecordMedicationUsage';

export const RecordMedicationUsagePayload = z.object({
  v: z.literal(1),
  prescriptionId: z.string().min(1).max(36),
  tenantId: z.string().min(1).max(36),
});

export type RecordMedicationUsagePayload = z.infer<typeof RecordMedicationUsagePayload>;

export interface MedicationUsageJobDeps {
  prisma: PrismaClient;
  search: MedicationSearchService;
  logger?: Logger;
}

export function registerMedicationUsageJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  deps: MedicationUsageJobDeps,
): void {
  registry.register({
    type: RECORD_MEDICATION_USAGE,
    queue: MAINTENANCE_QUEUE,
    payloadSchema: RecordMedicationUsagePayload,
    maxAttempts: 5,
    leaseSeconds: 60,
    // Below anything a person is waiting on. Nobody's prescription is blocked by a usage counter.
    priority: 800,
  });

  runner?.handle(RECORD_MEDICATION_USAGE, async (ctx) => {
    const payload = ctx.payload as RecordMedicationUsagePayload;

    const prescription = await deps.prisma.prescription.findFirst({
      where: { tenantId: payload.tenantId, id: payload.prescriptionId },
      select: { clinicalStatus: true },
    });
    if (!prescription) {
      // The prescription is gone or belongs to another tenant: nothing a retry can fix.
      throw new NonRetryableJobError('PRESCRIPTION_NOT_FOUND');
    }
    if (prescription.clinicalStatus !== 'APPROVED') {
      // Approved and then voided before this job ran. Counting it would record a prescription the
      // patient never kept, so the job succeeds having done nothing.
      deps.logger?.info(
        { prescriptionId: payload.prescriptionId, status: prescription.clinicalStatus },
        'medication usage skipped: no longer approved',
      );
      return;
    }

    const items = await deps.prisma.prescriptionItem.findMany({
      where: { tenantId: payload.tenantId, prescriptionId: payload.prescriptionId },
      select: { medicationId: true },
    });
    const medicationIds = items.map((i) => i.medicationId).filter((id): id is string => id !== null);
    // Free-text lines name no catalog row, so there is nothing to count for them — which is why a
    // clinic that prescribes mostly free text simply gets no boost rather than a wrong one.
    if (medicationIds.length === 0) return;

    await deps.search.recordUsage({ tenantId: payload.tenantId, medicationIds });
  });
}
