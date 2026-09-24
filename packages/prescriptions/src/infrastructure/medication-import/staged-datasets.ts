import path from 'node:path';

/**
 * Where a staged dataset lives on the server (ADR-020 §3).
 *
 * `pnpm meddata:stage` writes here and the `ImportMedicationDataset` job reads from here, so the layout
 * is computed in one place rather than agreed by convention between a CLI and a worker that never speak.
 *
 * The object-storage path from ADR-020 §3 arrives with `ObjectStoragePort` in Stage 8. Until then this is
 * the disk-adapter path, which is also what an operator reaches over SFTP.
 */
export const DEFAULT_DATASET_PREFIX = 'platform/medicine-datasets/';

/** A version name is a path segment, so it is restricted to something that cannot be one. */
export const DATASET_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class StagedDatasetError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StagedDatasetError';
  }
}

export interface StagedDatasetConfig {
  /** `STORAGE_DISK_ROOT`. */
  root: string | undefined;
  /** `MEDICATION_DATASET_STORAGE_PREFIX`. */
  prefix?: string | undefined;
}

/**
 * Resolves the directory for one dataset version, refusing anything that is not a plain version name.
 *
 * The check is not decoration. `datasetVersion` arrives in a request body from a platform operator, and
 * it becomes a filesystem path; a value containing `..` would let a caller point the importer at any
 * directory the worker can read. The pattern is an allow-list rather than an escape, because there is no
 * legitimate version name it excludes.
 */
export function stagedDatasetDir(datasetVersion: string, config: StagedDatasetConfig): string {
  if (!DATASET_VERSION_RE.test(datasetVersion)) {
    throw new StagedDatasetError(
      'MEDDATA_VERSION_INVALID',
      'a dataset version must be a plain name of letters, digits, dot, dash or underscore',
    );
  }
  if (!config.root) {
    throw new StagedDatasetError(
      'MEDDATA_STAGING_NOT_CONFIGURED',
      'STORAGE_DISK_ROOT is not set, so there is nowhere for a staged dataset to be',
    );
  }
  const prefix = config.prefix ?? DEFAULT_DATASET_PREFIX;
  return path.join(path.resolve(config.root), ...prefix.split('/').filter(Boolean), datasetVersion);
}
