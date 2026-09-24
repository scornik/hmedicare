import { type Clock, newId, systemClock } from '@hmedic/kernel';
import { Prisma, type PrismaClient, bulkUpsert, deactivateMissing, withTransaction } from '@hmedic/database';
import { medicationSearchKey } from '@hmedic/localization';
import {
  type MedicationRecord,
  aliasIdentity,
  isVeterinary,
  mapMedication,
  sha256Hex,
  toMoney,
} from '../../domain/medication-mapping';
import { IMPORTED_FILES, type ImportedFile } from './accepted-schemas';
import { DatasetError, type DatasetReader } from './dataset-reader';

/**
 * The medication catalog importer (MEDDATA-002, ADR-020 §2, PRESCRIPTION-IMPLEMENTATION.md §5.3).
 *
 * Four properties shape it, and each one is a failure it is built to avoid:
 *
 * **Never deletes.** A medication absent from a newer dataset is deactivated, never removed, because it
 * may be named on an approved prescription from last year that has to stay readable and renderable
 * forever. The catalog stops offering a row; it does not forget it.
 *
 * **Idempotent per version.** Re-running the same version leaves rows byte-identical. An importer that
 * churned `updated_at` on every run would make "has this catalog changed?" unanswerable.
 *
 * **Resumable.** A checkpoint is written after each committed batch. Fifty thousand rows on a shared host
 * will be interrupted — by an idle-stop, a deploy, a lease expiry — and starting again from zero each
 * time is how an import never finishes at all.
 *
 * **Single-flight.** The database forbids two active imports with a generated key. The service checks as
 * well and says so clearly, because a caller deserves "an import is already running" rather than a
 * constraint violation from three layers down.
 */
export const IMPORT_BATCH_SIZE = 500;
/** Rejected records tolerated before the run is called a failure rather than a report. */
export const REJECT_THRESHOLD_RATIO = 0.02;

/**
 * What one dataset file contributed.
 *
 * `updated` and `unchanged` are present only for `medications.jsonl`. That is the one table carrying an
 * `updated_at` the writer can compare before and after, so it is the only file where the difference
 * between "rewritten with new values" and "already identical" is a thing this importer knows rather than
 * guesses. Reporting a made-up split for the other four would be worse than reporting none.
 *
 * `updated` means a stored column differs, which includes `dataset_version`. Importing a *new* version of
 * a dataset therefore reports every row it still mentions as updated, because every row now records a
 * different version as the last one to have named it. That is the honest reading and the one the
 * idempotence property needs: re-importing the *same* version changes no column, so `updated` is zero.
 */
// A `type` rather than an `interface` on purpose: only type aliases get an implicit index signature, and
// without one Prisma's `InputJsonValue` refuses this shape when the counts are written to the import row.
export type FileCounts = {
  /** Non-blank lines consumed. Lower than the file's length on a resumed run. */
  read: number;
  /** Rows whose key was not in the table before this batch. */
  inserted: number;
  /** Rows whose key was already present and was written again. */
  existing: number;
  updated?: number;
  unchanged?: number;
  /** Lines the schema refused. */
  rejected: number;
  /** Valid lines deliberately not written: veterinary products, unresolvable targets, unusable prices. */
  skipped: number;
};

export interface ImportCounts {
  read: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  excludedVeterinary: number;
  rejectedSchema: number;
  rejectedPricePrecision: number;
  rejectedUnresolvedTarget: number;
  /**
   * Per file, keyed by dataset filename. The counters above stay as they were — medication-shaped totals
   * plus every rejection from every file — because that is what the threshold check and the existing
   * reports read. This is the breakdown underneath them, so a run that imports fifty thousand medications
   * and silently drops most of the alias file can be told apart from one that does not.
   */
  files: Record<string, FileCounts>;
}

export interface ImportOptions {
  datasetVersion: string;
  /** `development` | `test` | `staging` | `production`. */
  environment: string;
  executionPath: 'CLI' | 'JOB';
  requestedBy: string;
  /** Stops after preflight with counts only. */
  dryRun?: boolean;
  /**
   * Re-runs the writes for a version already imported successfully. The default is a no-op report
   * (ADR-020 §2); this exists for verifying idempotence and for repairing a catalog by hand.
   */
  force?: boolean;
  excludeVeterinary?: boolean;
  /** Production only: set by `MEDICATION_IMPORT_PRODUCTION_ALLOWED`. */
  productionAllowed?: boolean;
  onProgress?: (info: { file: string; line: number; counts: ImportCounts }) => void;
  /**
   * Aborted when the caller can no longer guarantee it is the only importer running — in the job path,
   * when the lease heartbeat fails (`JobContext.signal`).
   *
   * Checked at batch boundaries rather than mid-transaction. A batch that has begun finishes and commits
   * its checkpoint; stopping between batches is what makes the abort safe, because the next run resumes
   * from a line that was genuinely written. An importer that tore out mid-batch would leave the
   * checkpoint describing work the transaction rolled back.
   */
  signal?: AbortSignal;
}

export interface ImportResult {
  importId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'REFUSED';
  /** True when this version was already imported and nothing was re-read. */
  alreadyImported?: boolean;
  refusalReason?: string;
  errorClass?: string;
  counts: ImportCounts;
  schemaSet?: string;
  resumedFrom?: { file: string; line: number } | null;
  seconds: number;
}

const REQUIRED_GATES = [
  'LEGAL_SOURCE_REVIEW',
  'CLINICAL_SAMPLE_REVIEW',
  'DGDA_CROSS_REFERENCE',
  'IMPORT_SAFEGUARDS_VERIFIED',
] as const;

const emptyFileCounts = (): FileCounts => ({
  read: 0,
  inserted: 0,
  existing: 0,
  rejected: 0,
  skipped: 0,
});

const emptyCounts = (): ImportCounts => ({
  read: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  deactivated: 0,
  excludedVeterinary: 0,
  rejectedSchema: 0,
  rejectedPricePrecision: 0,
  rejectedUnresolvedTarget: 0,
  // Seeded for every imported file so a file that contributed nothing shows zeros rather than
  // disappearing from the report — an absent key reads as "not attempted", which is a different fact.
  files: Object.fromEntries(IMPORTED_FILES.map((f) => [f, emptyFileCounts()])),
});

export class MedicationImporter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly reader: DatasetReader,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * The production gate (ADR-020 §2).
   *
   * Two conditions, both required: the deployment must opt in, and all four dataset-card gates must be
   * attested for this exact version. The refusal names the gates that are missing rather than saying
   * "not allowed", because an operator who has attested two of four should be told which two remain, not
   * left to guess at a policy.
   */
  private async checkEnvironmentGate(
    options: ImportOptions,
  ): Promise<{ allowed: true } | { allowed: false; reason: string; detail: string }> {
    if (options.environment !== 'production') return { allowed: true };
    if (!options.productionAllowed) {
      return {
        allowed: false,
        reason: 'MEDDATA_PRODUCTION_GATES_OPEN',
        detail: 'MEDICATION_IMPORT_PRODUCTION_ALLOWED is not true',
      };
    }
    const attested = await this.prisma.medicationDatasetGateAttestation.findMany({
      where: { datasetVersion: options.datasetVersion },
      select: { gateCode: true },
    });
    const have = new Set(attested.map((a) => a.gateCode));
    const missing = REQUIRED_GATES.filter((g) => !have.has(g));
    if (missing.length > 0) {
      return {
        allowed: false,
        reason: 'MEDDATA_PRODUCTION_GATES_OPEN',
        detail: `missing gate attestations: ${missing.join(', ')}`,
      };
    }
    return { allowed: true };
  }

  /** The import row this run continues, if a previous attempt on this version failed part-way. */
  private async findResumable(datasetVersion: string) {
    return this.prisma.medicationDatasetImport.findFirst({
      // A failed run that got far enough to write a checkpoint is the only thing worth resuming.
      where: { datasetVersion, status: 'FAILED', NOT: { checkpoint: { equals: Prisma.DbNull } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async run(options: ImportOptions): Promise<ImportResult> {
    const startedAt = this.clock.now();
    const counts = emptyCounts();
    const excludeVeterinary = options.excludeVeterinary ?? true;

    // Single-flight at the service level. The generated key would refuse the insert anyway, but a caller
    // deserves to be told an import is running rather than handed a constraint violation.
    const active = await this.prisma.medicationDatasetImport.findFirst({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true, datasetVersion: true },
    });
    if (active) {
      // The same code the HTTP layer raises for this condition. Two spellings for one fact is how a
      // caller ends up handling one of them and being surprised by the other, and this code travels: it
      // is stored as the import row's `error_class` and read back by whoever asks what went wrong.
      throw new DatasetError(
        'MEDDATA_IMPORT_IN_PROGRESS',
        `an import of ${active.datasetVersion} is already running (${active.id})`,
      );
    }

    // Re-running a version that already succeeded is a no-op report (ADR-020 §2), decided here rather
    // than by the unique key. Without this the importer reads fifty thousand rows, writes them all, and
    // only then discovers it was never allowed to record the result — ninety seconds of work to reach a
    // constraint violation that says nothing useful.
    const done = await this.prisma.medicationDatasetImport.findFirst({
      where: { datasetVersion: options.datasetVersion, status: 'SUCCEEDED' },
      select: { id: true, counts: true, finishedAt: true },
    });
    if (done && !options.force) {
      return {
        importId: done.id,
        status: 'SUCCEEDED',
        alreadyImported: true,
        counts: { ...counts, ...((done.counts as Partial<ImportCounts>) ?? {}) },
        seconds: 0,
      };
    }

    const gate = await this.checkEnvironmentGate(options);
    const preflight = await this.reader.preflight(options.datasetVersion);

    // A forced re-import starts from the beginning. Resuming is for continuing an interrupted run; a
    // force is someone asking for the whole version to be written again, and honouring a checkpoint
    // would silently turn that into no work at all.
    const resumable = options.force ? null : await this.findResumable(options.datasetVersion);
    const checkpoint = (resumable?.checkpoint ?? null) as { file: string; line: number } | null;

    const importId = newId();
    await this.prisma.medicationDatasetImport.create({
      data: {
        id: importId,
        datasetVersion: options.datasetVersion,
        datasetStatus: preflight.datasetStatus,
        environment: options.environment,
        executionPath: options.executionPath,
        status: gate.allowed ? 'RUNNING' : 'REFUSED',
        refusalReason: gate.allowed ? null : gate.reason,
        requestedBy: options.requestedBy,
        fileChecksums: preflight.fileChecksums,
        schemaHashes: preflight.schemaHashes,
        counts: { ...counts, lines: preflight.lineCounts },
        checkpoint: checkpoint ?? undefined,
        startedAt,
        finishedAt: gate.allowed ? null : startedAt,
        createdAt: startedAt,
      },
    });

    if (!gate.allowed) {
      return {
        importId,
        status: 'REFUSED',
        refusalReason: `${gate.reason}: ${gate.detail}`,
        counts,
        schemaSet: preflight.schemaSet.id,
        seconds: 0,
      };
    }

    if (options.dryRun) {
      // Nothing was read line by line, so the only honest `read` is the one preflight counted. The rest
      // of each file's counters stay at zero: a dry run has no idea what it would have inserted.
      for (const [name, lines] of Object.entries(preflight.lineCounts)) {
        this.fileCounts(counts, name as ImportedFile).read = lines;
      }
      await this.finish(importId, 'SUCCEEDED', counts, null);
      return {
        importId,
        status: 'SUCCEEDED',
        counts: { ...counts, read: preflight.lineCounts['medications.jsonl'] ?? 0 },
        schemaSet: preflight.schemaSet.id,
        seconds: 0,
      };
    }

    try {
      await this.importManufacturers(options, counts);
      await this.importGenerics(options, counts);
      await this.importMedications(options, counts, excludeVeterinary, importId, checkpoint);
      await this.deactivateAbsent(options, counts);
      await this.importAliases(options, counts);
      await this.importPrices(options, counts);

      // The threshold is per file, and counts only schema rejections.
      //
      // Both halves of that were wrong before the `meddata-mini` fixture made the scale small enough to
      // see. It compared every rejection from every file against the number of *medication* lines, so an
      // alias file could push a medication file over a limit it had nothing to do with. And it counted
      // deliberate skips — a veterinary product excluded by policy, an alias whose target that exclusion
      // removed, a price with more precision than the column holds — as if they were corruption. Those
      // are the importer working, and on a dataset with many veterinary products they can be most of the
      // alias file. They are reported per file as `skipped`; they do not fail a run.
      //
      // What the threshold is actually for is a file this importer cannot read: a schema drift, a
      // truncated download, a generator bug. That is `rejected`, against the lines of its own file.
      for (const [name, f] of Object.entries(counts.files)) {
        if (f.read === 0) continue;
        if (f.rejected / f.read > REJECT_THRESHOLD_RATIO) {
          throw new DatasetError(
            'MEDDATA_TOO_MANY_REJECTIONS',
            `${name}: ${f.rejected} of ${f.read} records failed schema validation, over the ` +
              `${(REJECT_THRESHOLD_RATIO * 100).toFixed(0)}% threshold`,
          );
        }
      }

      // One SUCCEEDED row per version is a database guarantee, so a forced re-run replaces the earlier
      // record rather than trying to sit beside it. The history of *failed* attempts is kept: those are
      // what someone reads when asking why a catalog looks the way it does.
      if (done?.id) {
        await this.prisma.medicationDatasetImport.update({
          where: { id: done.id },
          data: { status: 'FAILED', errorClass: 'SUPERSEDED_BY_FORCED_REIMPORT' },
        });
      }
      await this.finish(importId, 'SUCCEEDED', counts, null);
      return {
        importId,
        status: 'SUCCEEDED',
        counts,
        schemaSet: preflight.schemaSet.id,
        resumedFrom: checkpoint,
        seconds: Math.round((this.clock.now().getTime() - startedAt.getTime()) / 1000),
      };
    } catch (e) {
      const errorClass = e instanceof DatasetError ? e.code : 'IMPORT_ERROR';
      await this.finish(importId, 'FAILED', counts, this.lastCheckpoint, errorClass);
      throw e;
    }
  }

  private lastCheckpoint: { file: string; line: number } | null = null;

  private async finish(
    importId: string,
    status: 'SUCCEEDED' | 'FAILED',
    counts: ImportCounts,
    checkpoint: { file: string; line: number } | null,
    errorClass?: string,
  ): Promise<void> {
    await this.prisma.medicationDatasetImport.update({
      where: { id: importId },
      data: {
        status,
        counts: { ...counts },
        checkpoint: checkpoint ?? undefined,
        errorClass: errorClass ?? null,
        finishedAt: this.clock.now(),
      },
    });
  }

  /** The per-file counters, created on demand so a caller-supplied counts object need not pre-seed them. */
  private fileCounts(counts: ImportCounts, name: ImportedFile): FileCounts {
    const existing = counts.files[name];
    if (existing) return existing;
    const fresh = emptyFileCounts();
    counts.files[name] = fresh;
    return fresh;
  }

  // ---------------------------------------------------------------- manufacturers and generics

  private async importManufacturers(options: ImportOptions, counts: ImportCounts): Promise<void> {
    const now = this.clock.now();
    const file = this.fileCounts(counts, 'manufacturers.jsonl');
    let batch: Array<Record<string, unknown>> = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const rows = batch;
      batch = [];
      await withTransaction(
        this.prisma,
        async (tx) => {
          // Present-before, so the report can say what this file added rather than only how much of it
          // was read. Unlike `medications`, this table carries no `updated_at`, so a row that already
          // existed is counted as existing and nothing claims to know whether its values moved.
          const keys = rows.map((r) => String(r.manufacturer_key_sha256));
          const before = await tx.medicationManufacturer.count({
            where: { manufacturerKeySha256: { in: keys } },
          });
          file.inserted += rows.length - before;
          file.existing += before;
          return bulkUpsert(tx, {
            table: 'medication_manufacturers',
            columns: [
              'id',
              'manufacturer_key',
              'manufacturer_key_sha256',
              'name',
              'aliases',
              'dataset_record_id',
              'dataset_version',
              'active',
            ],
            updateColumns: ['manufacturer_key', 'name', 'aliases', 'dataset_version', 'active'],
            rows,
          });
        },
        { context: 'meddata:manufacturers' },
      );
    };

    for await (const item of this.reader.read('manufacturers.jsonl')) {
      file.read += 1;
      if (item.error) {
        counts.rejectedSchema += 1;
        file.rejected += 1;
        continue;
      }
      const r = item.record as { id: string; key: string; name: string; aliases?: unknown[] };
      batch.push({
        id: newId(),
        manufacturer_key: r.key,
        manufacturer_key_sha256: sha256Hex(r.key),
        name: r.name,
        aliases: JSON.stringify(r.aliases ?? []),
        dataset_record_id: r.id,
        dataset_version: options.datasetVersion,
        active: 1,
      });
      if (batch.length >= IMPORT_BATCH_SIZE) await flush();
    }
    await flush();
    void now;
  }

  private async importGenerics(options: ImportOptions, counts: ImportCounts): Promise<void> {
    const file = this.fileCounts(counts, 'generics.jsonl');
    let batch: Array<Record<string, unknown>> = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const rows = batch;
      batch = [];
      await withTransaction(
        this.prisma,
        async (tx) => {
          const keys = rows.map((r) => String(r.generic_key_sha256));
          const before = await tx.medicationGeneric.count({ where: { genericKeySha256: { in: keys } } });
          file.inserted += rows.length - before;
          file.existing += before;
          return bulkUpsert(tx, {
            table: 'medication_generics',
            columns: [
              'id',
              'generic_key',
              'generic_key_sha256',
              'name',
              'name_search_key',
              'aliases',
              'salt_forms',
              'dataset_record_id',
              'dataset_version',
              'active',
            ],
            updateColumns: [
              'generic_key',
              'name',
              'name_search_key',
              'aliases',
              'salt_forms',
              'dataset_version',
              'active',
            ],
            rows,
          });
        },
        { context: 'meddata:generics' },
      );
    };

    for await (const item of this.reader.read('generics.jsonl')) {
      file.read += 1;
      if (item.error) {
        counts.rejectedSchema += 1;
        file.rejected += 1;
        continue;
      }
      const r = item.record as {
        id: string;
        key: string;
        name: string;
        aliases?: unknown[];
        salt_forms?: unknown[];
      };
      batch.push({
        id: newId(),
        generic_key: r.key,
        generic_key_sha256: sha256Hex(r.key),
        name: r.name,
        name_search_key: medicationSearchKey(r.name),
        aliases: JSON.stringify(r.aliases ?? []),
        salt_forms: JSON.stringify(r.salt_forms ?? []),
        dataset_record_id: r.id,
        dataset_version: options.datasetVersion,
        active: 1,
      });
      if (batch.length >= IMPORT_BATCH_SIZE) await flush();
    }
    await flush();
  }

  // ---------------------------------------------------------------- medications

  private async importMedications(
    options: ImportOptions,
    counts: ImportCounts,
    excludeVeterinary: boolean,
    importId: string,
    checkpoint: { file: string; line: number } | null,
  ): Promise<void> {
    const now = this.clock.now();
    const file = this.fileCounts(counts, 'medications.jsonl');
    const resumeLine = checkpoint?.file === 'medications.jsonl' ? checkpoint.line : 0;

    // Manufacturer and generic ids, resolved once. Two lookups of a few hundred and a few thousand rows
    // beat fifty thousand individual joins by enough that it is not a close call.
    const manufacturers = new Map(
      (
        await this.prisma.medicationManufacturer.findMany({
          select: { id: true, manufacturerKeySha256: true },
        })
      ).map((m) => [m.manufacturerKeySha256, m.id]),
    );
    const generics = new Map(
      (await this.prisma.medicationGeneric.findMany({ select: { id: true, genericKeySha256: true } })).map(
        (g) => [g.genericKeySha256, g.id],
      ),
    );

    let batch: Array<{ row: Record<string, unknown>; generics: string[] }> = [];
    let lastLine = resumeLine;

    const flush = async (upToLine: number) => {
      if (batch.length === 0) return;
      const current = batch;
      batch = [];
      await withTransaction(
        this.prisma,
        async (tx) => {
          // Inserted, updated and unchanged, measured rather than inferred.
          //
          // The obvious route — MariaDB's affected-row count, 1 per insert and 2 per changed update —
          // does not survive this driver, which connects with CLIENT_FOUND_ROWS and so reports rows
          // *matched*. That reads as "half the catalog changed" on a re-import where nothing did.
          //
          // So the batch's existing timestamps are read before and after. `touchColumns` moves
          // `updated_at` only when a value genuinely differs, which makes it exactly the signal needed:
          // a row whose timestamp moved was updated, and one whose timestamp held still was already
          // identical. An import that cannot say which of the three happened is one nobody can review.
          const keys = current.map((c) => String(c.row.canonical_key_sha256));
          const priorRows = await tx.medication.findMany({
            where: { canonicalKeySha256: { in: keys } },
            select: { canonicalKeySha256: true, updatedAt: true },
          });
          const prior = new Map(priorRows.map((r) => [r.canonicalKeySha256, r.updatedAt.getTime()]));
          await bulkUpsert(tx, {
            table: 'medications',
            columns: [
              'id',
              'canonical_key',
              'canonical_key_sha256',
              'dataset_record_id',
              'dataset_version',
              'first_seen_version',
              'brand_name',
              'brand_search_key',
              'brand_name_bn',
              'brand_bn_search_key',
              'generic_display',
              'generic_set_key',
              'strength_text',
              'strength_parsed',
              'dosage_form',
              'dosage_form_raw',
              'route',
              'manufacturer_id',
              'manufacturer_display',
              'registration_number',
              'registration_alternatives',
              'dgda_match',
              'review_status',
              'monograph_source_url',
              'source_ids',
              'field_provenance',
              'active',
              'is_synthetic',
              'imported_at',
              'updated_at',
            ],
            // `first_seen_version` is deliberately absent: it records when this medication first appeared
            // and must survive every later import, or the catalog forgets how long it has known a drug.
            updateColumns: [
              'canonical_key',
              'dataset_version',
              'brand_name',
              'brand_search_key',
              'brand_name_bn',
              'brand_bn_search_key',
              'generic_display',
              'generic_set_key',
              'strength_text',
              'strength_parsed',
              'dosage_form',
              'dosage_form_raw',
              'route',
              'manufacturer_id',
              'manufacturer_display',
              'registration_number',
              'registration_alternatives',
              'dgda_match',
              'review_status',
              'monograph_source_url',
              'source_ids',
              'field_provenance',
              'active',
            ],
            touchColumns: ['updated_at'],
            rows: current.map((c) => c.row),
          });
          const afterRows = await tx.medication.findMany({
            where: { canonicalKeySha256: { in: keys } },
            select: { canonicalKeySha256: true, updatedAt: true },
          });
          let updated = 0;
          for (const row of afterRows) {
            const was = prior.get(row.canonicalKeySha256);
            if (was !== undefined && was !== row.updatedAt.getTime()) updated += 1;
          }
          const inserted = current.length - prior.size;
          counts.inserted += inserted;
          counts.updated += updated;
          counts.unchanged += prior.size - updated;
          file.inserted += inserted;
          file.existing += prior.size;
          file.updated = (file.updated ?? 0) + updated;
          file.unchanged = (file.unchanged ?? 0) + (prior.size - updated);

          // Links are replaced rather than merged: a product whose formulation changed between dataset
          // versions must not keep an ingredient it no longer contains.
          const ids = current.map((c) => String(c.row.canonical_key_sha256));
          const saved = await tx.medication.findMany({
            where: { canonicalKeySha256: { in: ids } },
            select: { id: true, canonicalKeySha256: true },
          });
          const idByKey = new Map(saved.map((s) => [s.canonicalKeySha256, s.id]));
          const medicationIds = [...idByKey.values()];
          if (medicationIds.length) {
            await tx.medicationGenericLink.deleteMany({
              where: { medicationId: { in: medicationIds } },
            });
            const links: Array<{ medicationId: string; genericId: string; position: number }> = [];
            for (const c of current) {
              const medicationId = idByKey.get(String(c.row.canonical_key_sha256));
              if (!medicationId) continue;
              c.generics.forEach((genericKey, index) => {
                const genericId = generics.get(genericKey);
                if (genericId) links.push({ medicationId, genericId, position: index });
              });
            }
            if (links.length) {
              await tx.medicationGenericLink.createMany({ data: links, skipDuplicates: true });
            }
          }

          // The checkpoint commits with the batch it describes. Written separately it could claim
          // progress the transaction then rolled back, and the resume would skip rows.
          await tx.medicationDatasetImport.update({
            where: { id: importId },
            data: { checkpoint: { file: 'medications.jsonl', line: upToLine } },
          });
        },
        { context: 'meddata:medications' },
      );
      this.lastCheckpoint = { file: 'medications.jsonl', line: upToLine };
      options.onProgress?.({ file: 'medications.jsonl', line: upToLine, counts });
      if (options.signal?.aborted) {
        // Thrown, not returned: this leaves the run FAILED with its checkpoint intact, which is exactly
        // what a resume needs. A run that reported success here would claim a catalog it did not finish.
        throw new DatasetError(
          'MEDDATA_IMPORT_ABORTED',
          `aborted after ${upToLine} medication lines; the checkpoint is committed and a later run resumes from it`,
        );
      }
    };

    for await (const item of this.reader.read('medications.jsonl', resumeLine)) {
      lastLine = item.line;
      counts.read += 1;
      file.read += 1;
      if (item.error) {
        counts.rejectedSchema += 1;
        file.rejected += 1;
        continue;
      }
      const record = item.record as MedicationRecord;
      if (excludeVeterinary && isVeterinary(record)) {
        counts.excludedVeterinary += 1;
        file.skipped += 1;
        continue;
      }
      const m = mapMedication(record);
      batch.push({
        generics: m.genericNames.map((n) => sha256Hex(medicationSearchKey(n))),
        row: {
          id: newId(),
          canonical_key: m.canonicalKey,
          canonical_key_sha256: m.canonicalKeySha256,
          dataset_record_id: m.datasetRecordId,
          dataset_version: options.datasetVersion,
          first_seen_version: options.datasetVersion,
          brand_name: m.brandName,
          brand_search_key: m.brandSearchKey,
          brand_name_bn: m.brandNameBn,
          brand_bn_search_key: m.brandBnSearchKey,
          generic_display: m.genericDisplay,
          generic_set_key: m.genericSetKey,
          strength_text: m.strengthText,
          strength_parsed: JSON.stringify(m.strengthParsed),
          dosage_form: m.dosageForm,
          dosage_form_raw: JSON.stringify(m.dosageFormRaw),
          route: m.route,
          manufacturer_id: m.manufacturerKey
            ? (manufacturers.get(sha256Hex(m.manufacturerKey)) ?? null)
            : null,
          manufacturer_display: m.manufacturerDisplay,
          registration_number: m.registrationNumber,
          registration_alternatives: m.registrationAlternatives
            ? JSON.stringify(m.registrationAlternatives)
            : null,
          dgda_match: m.dgdaMatch,
          review_status: m.reviewStatus,
          monograph_source_url: m.monographSourceUrl,
          source_ids: JSON.stringify(m.sourceIds),
          field_provenance: JSON.stringify(m.fieldProvenance),
          active: 1,
          is_synthetic: 0,
          imported_at: now,
          updated_at: now,
        },
      });
      if (batch.length >= IMPORT_BATCH_SIZE) await flush(item.line);
    }
    await flush(lastLine);
  }

  /** Rows this version did not mention. Batched, because one `UPDATE` over fifty thousand rows is a lock. */
  private async deactivateAbsent(options: ImportOptions, counts: ImportCounts): Promise<void> {
    for (;;) {
      const n = await withTransaction(
        this.prisma,
        (tx) =>
          deactivateMissing(tx, {
            table: 'medications',
            versionColumn: 'dataset_version',
            deactivatedColumn: 'deactivated_in_version',
            version: options.datasetVersion,
            limit: IMPORT_BATCH_SIZE,
          }),
        { context: 'meddata:deactivate' },
      );
      counts.deactivated += n;
      if (n < IMPORT_BATCH_SIZE) break;
    }
  }

  // ---------------------------------------------------------------- aliases and prices

  private async importAliases(options: ImportOptions, counts: ImportCounts): Promise<void> {
    const medications = new Map(
      (await this.prisma.medication.findMany({ select: { id: true, datasetRecordId: true } })).map((m) => [
        m.datasetRecordId,
        m.id,
      ]),
    );
    const generics = new Map(
      (await this.prisma.medicationGeneric.findMany({ select: { id: true, datasetRecordId: true } })).map(
        (g) => [g.datasetRecordId, g.id],
      ),
    );

    const file = this.fileCounts(counts, 'aliases.jsonl');
    let batch: Array<Record<string, unknown>> = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const rows = batch;
      batch = [];
      await withTransaction(
        this.prisma,
        async (tx) => {
          const keys = rows.map((r) => String(r.alias_identity_sha256));
          const before = await tx.medicationAlias.count({ where: { aliasIdentitySha256: { in: keys } } });
          file.inserted += rows.length - before;
          file.existing += before;
          return bulkUpsert(tx, {
            table: 'medication_aliases',
            columns: [
              'id',
              'target_type',
              'medication_id',
              'generic_id',
              'alias',
              'alias_search_key',
              'script',
              'kind',
              'alias_origin',
              'sources',
              'dataset_version',
              'active',
              'alias_identity_sha256',
            ],
            updateColumns: ['alias_search_key', 'sources', 'dataset_version', 'active'],
            rows,
          });
        },
        { context: 'meddata:aliases' },
      );
    };

    for await (const item of this.reader.read('aliases.jsonl')) {
      file.read += 1;
      if (item.error) {
        counts.rejectedSchema += 1;
        file.rejected += 1;
        continue;
      }
      const a = item.record as {
        alias: string;
        script: string;
        kind: string;
        alias_origin: string;
        target_type: string;
        target_id: string;
        sources?: string[];
      };
      const isMedication = a.target_type === 'medication';
      const targetId = isMedication ? medications.get(a.target_id) : generics.get(a.target_id);
      if (!targetId) {
        // A spelling pointing at a product this import excluded — a veterinary one, most often. Counted
        // rather than failed: the alias is meaningless without its target, and dropping it silently would
        // hide how much of the alias file the veterinary exclusion takes with it.
        counts.rejectedUnresolvedTarget += 1;
        file.skipped += 1;
        continue;
      }
      batch.push({
        id: newId(),
        target_type: isMedication ? 'MEDICATION' : 'GENERIC',
        medication_id: isMedication ? targetId : null,
        generic_id: isMedication ? null : targetId,
        alias: a.alias,
        alias_search_key: medicationSearchKey(a.alias),
        script: a.script,
        kind: a.kind,
        alias_origin: a.alias_origin,
        sources: JSON.stringify(a.sources ?? []),
        dataset_version: options.datasetVersion,
        active: 1,
        alias_identity_sha256: aliasIdentity({
          targetType: isMedication ? 'MEDICATION' : 'GENERIC',
          targetId,
          alias: a.alias,
          kind: a.kind,
        }),
      });
      if (batch.length >= IMPORT_BATCH_SIZE) await flush();
    }
    await flush();
  }

  private async importPrices(options: ImportOptions, counts: ImportCounts): Promise<void> {
    const file = this.fileCounts(counts, 'prices_observed.jsonl');
    const medications = new Map(
      (await this.prisma.medication.findMany({ select: { id: true, datasetRecordId: true } })).map((m) => [
        m.datasetRecordId,
        m.id,
      ]),
    );

    let batch: Array<{
      id: string;
      medicationId: string;
      datasetVersion: string;
      sourceId: string;
      sourceUrl: string;
      unitPrice: string | null;
      packPrice: string | null;
      priceLabel: string | null;
      isOfficialMrp: boolean;
      observedAt: Date;
    }> = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const rows = batch;
      batch = [];
      // `skipDuplicates` rather than an upsert: an observation is a fact about a moment, and the same
      // source at the same instant cannot have observed a different price.
      //
      // This is the one writer that can report insertions straight from the database: `createMany` with
      // `skipDuplicates` returns rows actually written, not rows matched.
      const written = await this.prisma.medicationPriceObservation.createMany({
        data: rows,
        skipDuplicates: true,
      });
      file.inserted += written.count;
      file.existing += rows.length - written.count;
    };

    for await (const item of this.reader.read('prices_observed.jsonl')) {
      file.read += 1;
      if (item.error) {
        counts.rejectedSchema += 1;
        file.rejected += 1;
        continue;
      }
      const p = item.record as {
        medication_id: string;
        source_id: string;
        source_url: string;
        unit_price_bdt?: number;
        pack_price_bdt?: number;
        price_label?: string;
        is_official_mrp?: boolean;
        observed_at: string;
      };
      const medicationId = medications.get(p.medication_id);
      if (!medicationId) {
        counts.rejectedUnresolvedTarget += 1;
        file.skipped += 1;
        continue;
      }
      const unit = p.unit_price_bdt === undefined ? null : toMoney(p.unit_price_bdt);
      const pack = p.pack_price_bdt === undefined ? null : toMoney(p.pack_price_bdt);
      if (
        (p.unit_price_bdt !== undefined && unit === null) ||
        (p.pack_price_bdt !== undefined && pack === null)
      ) {
        // Rounding would invent a price nobody published. Skipped and counted instead.
        counts.rejectedPricePrecision += 1;
        file.skipped += 1;
        continue;
      }
      if (unit === null && pack === null) {
        counts.rejectedPricePrecision += 1;
        file.skipped += 1;
        continue;
      }
      batch.push({
        id: newId(),
        medicationId,
        datasetVersion: options.datasetVersion,
        sourceId: p.source_id,
        sourceUrl: p.source_url,
        unitPrice: unit,
        packPrice: pack,
        priceLabel: p.price_label ?? null,
        isOfficialMrp: p.is_official_mrp ?? false,
        observedAt: new Date(p.observed_at),
      });
      if (batch.length >= IMPORT_BATCH_SIZE) await flush();
    }
    await flush();
  }
}
