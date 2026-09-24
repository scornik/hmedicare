import type { PrismaClient } from '@hmedic/database';
import type { JobRegistry, JobRunner } from '@hmedic/jobs';
import type { Logger } from '@hmedic/observability';
import { registerMedicationImportJobs } from '../infrastructure/medication-import/jobs';
import type { StagedDatasetConfig } from '../infrastructure/medication-import/staged-datasets';

export interface PrescriptionWorkerDeps {
  prisma: PrismaClient;
  /** `APP_ENV`. */
  environment: string;
  /** `MEDICATION_IMPORT_PRODUCTION_ALLOWED`. */
  productionAllowed: boolean;
  /** `MEDICATION_IMPORT_EXCLUDE_VETERINARY`, the default a request may override. */
  excludeVeterinary?: boolean;
  staging: StagedDatasetConfig;
  logger?: Logger;
}

/**
 * Background jobs of the prescriptions context (`worker-only-worker-modules`).
 *
 * `runner` is null in the API process: it registers the job *type* so it can validate a payload and
 * enqueue, but it must never execute an import. A worker passes its runner and gets the handler.
 */
export function registerPrescriptionJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  deps: PrescriptionWorkerDeps,
): void {
  registerMedicationImportJobs(registry, runner, deps);
}
