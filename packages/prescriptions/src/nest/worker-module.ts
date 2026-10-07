import type { PrismaClient } from '@hmedic/database';
import type { ObjectStoragePort } from '@hmedic/laboratory-documents';
import type { JobRegistry, JobRunner } from '@hmedic/jobs';
import type { Logger } from '@hmedic/observability';
import { registerMedicationImportJobs } from '../infrastructure/medication-import/jobs';
import { MedicationSearchService } from '../infrastructure/medication-search';
import { registerMedicationUsageJobs } from '../infrastructure/usage-jobs';
import { registerPrescriptionRenderJobs } from '../infrastructure/render/render-jobs';
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
  /**
   * Object storage for rendered PDFs. Optional: a deployment with no storage root configured still
   * imports a catalog and prescribes, it just cannot render. Registering the job type without a store
   * would accept render requests and then fail every one of them.
   */
  storage?: ObjectStoragePort;
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
  // `RecordMedicationUsage`: the PrescriptionApproved consumer that feeds the search boost.
  registerMedicationUsageJobs(registry, runner, {
    prisma: deps.prisma,
    search: new MedicationSearchService(deps.prisma),
    logger: deps.logger,
  });
  // `RenderPrescriptionPdf`: only when a store exists, so an unconfigured deployment refuses the
  // request up front instead of queueing work that cannot finish.
  if (deps.storage) {
    registerPrescriptionRenderJobs(registry, runner, {
      prisma: deps.prisma,
      storage: deps.storage,
      logger: deps.logger,
    });
  }
}
