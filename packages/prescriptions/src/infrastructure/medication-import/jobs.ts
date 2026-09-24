import { z } from 'zod';
import type { PrismaClient } from '@hmedic/database';
import { type JobRegistry, type JobRunner, NonRetryableJobError } from '@hmedic/jobs';
import type { Logger } from '@hmedic/observability';
import { DatasetReader } from './dataset-reader';
import { MedicationImporter } from './importer';
import { type StagedDatasetConfig, type StagedDatasetError, stagedDatasetDir } from './staged-datasets';

/**
 * The `ImportMedicationDataset` background job (MEDDATA-003, ADR-020 §3).
 *
 * A platform operator asks for an import over HTTP; the work happens here, because reading fifty
 * thousand JSONL lines and writing them in five hundred-row transactions is minutes of work and no HTTP
 * request should be holding a connection open for it.
 *
 * **Its own queue.** The runner takes a claim lease equal to the longest `leaseSeconds` of any type on a
 * queue, so putting a fifteen-minute job on a shared queue would make every SMS send hold a
 * fifteen-minute lease too, and a worker that died would leave them all unreclaimable for that long. The
 * catalog queue exists so this job's lease is only ever this job's problem.
 *
 * **Retries are productive.** A failed run leaves a checkpoint and the next attempt resumes from it, so
 * three attempts are three continuations rather than three restarts. The payload carries no dataset
 * content — a version name and who asked — so nothing in `jobs.payload` is worth reading.
 */
export const CATALOG_QUEUE = 'catalog';
export const IMPORT_MEDICATION_DATASET = 'ImportMedicationDataset';

/**
 * Fifteen minutes. The 50,214-row dataset imports in about ninety seconds on a developer machine; a
 * shared host under load is a different animal, and a lease that expires mid-import hands the job to a
 * second worker while the first is still writing. The heartbeat renews this every half-lease, so the
 * only thing the number has to survive is a single batch plus scheduler jitter — it is generous on
 * purpose, because the cost of it being too long is a delayed retry and the cost of it being too short
 * is two importers on one catalog.
 */
export const IMPORT_LEASE_SECONDS = 900;

export const ImportMedicationDatasetPayload = z.object({
  v: z.literal(1),
  datasetVersion: z.string().min(1).max(64),
  requestedBy: z.string().min(1).max(128),
  dryRun: z.boolean().optional(),
  excludeVeterinary: z.boolean().optional(),
});

export type ImportMedicationDatasetPayload = z.infer<typeof ImportMedicationDatasetPayload>;

export interface MedicationImportJobDeps {
  prisma: PrismaClient;
  /** `APP_ENV`. */
  environment: string;
  /** `MEDICATION_IMPORT_PRODUCTION_ALLOWED`. */
  productionAllowed: boolean;
  staging: StagedDatasetConfig;
  logger?: Logger;
}

/**
 * Registers the job type and, when a runner is present, its handler.
 *
 * The API process registers the type without a runner so it can enqueue and validate payloads; only the
 * worker gets the handler. That split is why `runner` is nullable here rather than two functions.
 */
export function registerMedicationImportJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  deps: MedicationImportJobDeps,
): void {
  registry.register({
    type: IMPORT_MEDICATION_DATASET,
    queue: CATALOG_QUEUE,
    payloadSchema: ImportMedicationDatasetPayload,
    // Three, not the default eight. Each attempt resumes, so three are three continuations; but a run
    // that has failed three times is failing for a reason a fourth will not fix, and the import row
    // holds the error class for whoever looks.
    maxAttempts: 3,
    leaseSeconds: IMPORT_LEASE_SECONDS,
    // Below everything a patient is waiting on. Nobody is standing at a desk while the catalog loads.
    priority: 900,
  });

  runner?.handle(IMPORT_MEDICATION_DATASET, async (ctx) => {
    const payload = ctx.payload as ImportMedicationDatasetPayload;
    let dir: string;
    try {
      dir = stagedDatasetDir(payload.datasetVersion, deps.staging);
    } catch (e) {
      // A dataset that is not staged, or a version name that is not a name, will not become staged by
      // waiting. Retrying would burn three attempts to reach the same conclusion more slowly.
      const err = e as StagedDatasetError;
      deps.logger?.error({ datasetVersion: payload.datasetVersion, code: err.code }, err.message);
      throw new NonRetryableJobError(err.code ?? 'MEDDATA_STAGING_NOT_CONFIGURED');
    }

    const importer = new MedicationImporter(deps.prisma, new DatasetReader(dir));
    const result = await importer.run({
      datasetVersion: payload.datasetVersion,
      environment: deps.environment,
      executionPath: 'JOB',
      requestedBy: payload.requestedBy,
      dryRun: payload.dryRun ?? false,
      excludeVeterinary: payload.excludeVeterinary ?? true,
      productionAllowed: deps.productionAllowed,
      // The runner aborts this when the lease heartbeat fails. The importer checks it between batches,
      // so losing the lease stops the run at a committed checkpoint instead of leaving a second worker
      // and this one writing the same rows.
      signal: ctx.signal,
    });

    deps.logger?.info(
      {
        importId: result.importId,
        datasetVersion: payload.datasetVersion,
        status: result.status,
        counts: result.counts,
        seconds: result.seconds,
      },
      'medication dataset import finished',
    );

    if (result.status === 'REFUSED') {
      // A refusal is a policy decision, not a fault. Retrying it would rewrite the same refusal row
      // twice more and end in a dead letter that reads like a bug.
      throw new NonRetryableJobError('MEDDATA_PRODUCTION_GATES_OPEN');
    }
  });
}
