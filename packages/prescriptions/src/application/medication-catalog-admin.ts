import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, withTransaction } from '@hmedic/database';
import type { AuditPort } from '@hmedic/audit';
import { ChainAppender } from '@hmedic/audit';
import type { JobPort } from '@hmedic/jobs';
import { IMPORT_MEDICATION_DATASET } from '../infrastructure/medication-import/jobs';
import {
  DATASET_VERSION_RE,
  type StagedDatasetConfig,
  type StagedDatasetError,
  stagedDatasetDir,
} from '../infrastructure/medication-import/staged-datasets';
import { DatasetReader } from '../infrastructure/medication-import/dataset-reader';

/**
 * The platform-operator surface for the medication catalog (MEDDATA-003, ADR-020 §2–§3).
 *
 * Three things an operator can do: ask for a staged dataset to be imported, record one of the four
 * dataset-card gate attestations, and read what an import did. Everything here runs behind
 * `@PlatformRoute('medication.import')`; nothing here is reachable by a tenant.
 *
 * The four gates exist because `medicine-dataset-20260917-4` is `UNVERIFIED` and its own dataset card
 * says so. This code makes recording an attestation possible and makes production refuse without all
 * four. It does not decide whether a gate is satisfied — a person does that, offline, and puts their
 * name and their evidence on it.
 */
export const REQUIRED_GATE_CODES = [
  'LEGAL_SOURCE_REVIEW',
  'CLINICAL_SAMPLE_REVIEW',
  'DGDA_CROSS_REFERENCE',
  'IMPORT_SAFEGUARDS_VERIFIED',
] as const;

export type GateCode = (typeof REQUIRED_GATE_CODES)[number];

/** The attestation chain is platform-wide: one sequence, not one per dataset. */
export const GATE_CHAIN_KEY = 'meddata:platform';

export interface GateAttestationRow {
  id: string;
  seq: bigint;
  datasetVersion: string;
  gateCode: string;
  evidenceRef: string;
  summary: string;
  recordedByUserId: string;
  recordedAt: Date;
}

/**
 * The exact value the row hash covers.
 *
 * It lives here, beside the writer, because `medicationGateChainSource` re-derives it when verifying the
 * chain and the two must agree byte for byte. A hash input defined twice is a chain that reports
 * tampering the first time anyone edits one of the copies.
 */
export function gateAttestationHashInput(r: GateAttestationRow) {
  return {
    id: r.id,
    seq: r.seq,
    datasetVersion: r.datasetVersion,
    gateCode: r.gateCode,
    evidenceRef: r.evidenceRef,
    summary: r.summary,
    recordedByUserId: r.recordedByUserId,
    recordedAt: r.recordedAt,
  };
}

export interface OperatorActor {
  userId: string;
  requestId?: string | null;
  correlationId?: string | null;
}

export interface RequestImportInput {
  actor: OperatorActor;
  datasetVersion: string;
  dryRun?: boolean;
  excludeVeterinary?: boolean;
}

export interface RequestImportResult {
  jobId: string;
  /** False when this exact request was already queued; the caller gets the original job. */
  created: boolean;
  datasetVersion: string;
}

export interface RecordAttestationInput {
  actor: OperatorActor;
  datasetVersion: string;
  gateCode: GateCode;
  evidenceRef: string;
  summary: string;
}

export interface ImportStatusView {
  importId: string;
  datasetVersion: string;
  datasetStatus: string;
  environment: string;
  executionPath: string;
  status: string;
  refusalReason: string | null;
  requestedBy: string;
  counts: unknown;
  checkpoint: unknown;
  errorClass: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface CatalogGateStatus {
  datasetVersion: string;
  /** Every required gate, with whether it is attested. Missing ones are named, not merely absent. */
  gates: Array<{
    gateCode: GateCode;
    attested: boolean;
    recordedAt: string | null;
    recordedByUserId: string | null;
  }>;
  allAttested: boolean;
}

export interface MedicationCatalogAdminDeps {
  prisma: PrismaClient;
  jobs: JobPort;
  audit: AuditPort<unknown>;
  /** `APP_ENV`. */
  environment: string;
  staging: StagedDatasetConfig;
  clock?: Clock;
}

export class MedicationCatalogAdminService {
  private readonly chain = new ChainAppender();
  private readonly clock: Clock;

  constructor(private readonly deps: MedicationCatalogAdminDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * Queues an import of an already-staged dataset.
   *
   * It verifies the dataset here, synchronously, before enqueuing anything. The operator is standing at
   * a screen; telling them "that version is not staged" or "its checksums do not match" now is worth
   * more than a job that fails in two minutes and leaves them refreshing a status endpoint to find out.
   *
   * The production gate is *not* checked here. It is checked by the importer, inside the run, so that a
   * refusal is recorded as a `medication_dataset_imports` row naming the missing gates rather than
   * evaporating as an HTTP error nobody can point at later.
   */
  async requestImport(input: RequestImportInput): Promise<RequestImportResult> {
    if (!DATASET_VERSION_RE.test(input.datasetVersion)) {
      throw new AppError('VALIDATION_FAILED', 'datasetVersion must be a plain version name');
    }

    let dir: string;
    try {
      dir = stagedDatasetDir(input.datasetVersion, this.deps.staging);
    } catch (e) {
      throw new AppError('VALIDATION_FAILED', (e as StagedDatasetError).message);
    }

    try {
      await new DatasetReader(dir).preflight(input.datasetVersion);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      throw new AppError(
        'VALIDATION_FAILED',
        `${input.datasetVersion} is not importable: ${err.code ?? 'DATASET_INVALID'}`,
        { details: { datasetVersion: input.datasetVersion, reason: err.code ?? 'DATASET_INVALID' } },
      );
    }

    // Already running? Say so plainly. The database enforces single-flight with a generated key, but a
    // caller deserves "an import is already running" rather than a constraint violation from three
    // layers down — and the answer is the same either way, so there is no race worth closing here.
    const active = await this.deps.prisma.medicationDatasetImport.findFirst({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true, datasetVersion: true },
    });
    if (active) {
      throw new AppError(
        'MEDDATA_IMPORT_IN_PROGRESS',
        `an import of ${active.datasetVersion} is already in progress`,
        { details: { importId: active.id, datasetVersion: active.datasetVersion } },
      );
    }

    const correlationId = input.actor.correlationId ?? newId();
    const enqueued = await this.deps.jobs.enqueue({
      type: IMPORT_MEDICATION_DATASET,
      payload: {
        v: 1,
        datasetVersion: input.datasetVersion,
        requestedBy: input.actor.userId,
        dryRun: input.dryRun ?? false,
        excludeVeterinary: input.excludeVeterinary ?? true,
      },
      // Platform work, not a tenant's.
      tenantId: null,
      // One queued job per version per mode. A double-clicked button returns the first job rather than
      // starting a second import of the same catalog.
      idempotencyKey: `meddata:${input.datasetVersion}:${input.dryRun ? 'dry' : 'write'}`,
      concurrencyKey: 'meddata:import',
      correlationId,
    });

    await withTransaction(
      this.deps.prisma,
      (tx) =>
        this.deps.audit.append(tx, {
          tenantId: null,
          actorUserId: input.actor.userId,
          actorType: 'OPERATOR',
          action: 'MEDICATION_IMPORT_REQUESTED',
          resourceType: 'medication_dataset',
          resourceId: input.datasetVersion,
          outcome: 'SUCCESS',
          requestId: input.actor.requestId ?? null,
          correlationId,
          metadata: {
            jobId: enqueued.jobId,
            created: enqueued.created,
            dryRun: input.dryRun ?? false,
            environment: this.deps.environment,
          },
        }),
      { context: 'meddata:request-import' },
    );

    return {
      jobId: enqueued.jobId,
      created: enqueued.created,
      datasetVersion: input.datasetVersion,
    };
  }

  /**
   * Records one gate attestation for one dataset version.
   *
   * Append-only and hash-chained. An attestation is the record of a person saying "I reviewed this and
   * here is my evidence", and the whole reason production trusts it is that it cannot be quietly edited
   * afterwards — so there is no update path and no delete path, here or anywhere else. A mistaken
   * attestation is corrected by the dataset version moving on, not by rewriting history.
   *
   * `evidenceRef` and `summary` are both required and neither may be empty. An attestation without its
   * basis is a checkbox, and a checkbox is exactly what the dataset card's gates exist to prevent.
   */
  async recordAttestation(input: RecordAttestationInput): Promise<{ id: string; seq: string }> {
    if (!DATASET_VERSION_RE.test(input.datasetVersion)) {
      throw new AppError('VALIDATION_FAILED', 'datasetVersion must be a plain version name');
    }
    if (!REQUIRED_GATE_CODES.includes(input.gateCode)) {
      throw new AppError('VALIDATION_FAILED', `unknown gate ${input.gateCode}`);
    }
    const evidenceRef = input.evidenceRef.trim();
    const summary = input.summary.trim();
    if (evidenceRef.length === 0 || summary.length === 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'an attestation needs an evidence reference and a summary of what was reviewed',
      );
    }

    const existing = await this.deps.prisma.medicationDatasetGateAttestation.findUnique({
      where: {
        datasetVersion_gateCode: {
          datasetVersion: input.datasetVersion,
          gateCode: input.gateCode,
        },
      },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(
        'MEDDATA_GATE_ALREADY_ATTESTED',
        `${input.gateCode} is already attested for ${input.datasetVersion}`,
        { details: { attestationId: existing.id } },
      );
    }

    const now = this.clock.now();
    const id = newId();
    const correlationId = input.actor.correlationId ?? newId();

    const { slot } = await withTransaction(
      this.deps.prisma,
      async (tx) => {
        const appended = await this.chain.append(
          tx,
          GATE_CHAIN_KEY,
          now,
          (s) =>
            gateAttestationHashInput({
              id,
              seq: s.seq,
              datasetVersion: input.datasetVersion,
              gateCode: input.gateCode,
              evidenceRef,
              summary,
              recordedByUserId: input.actor.userId,
              recordedAt: now,
            }),
          (s, rowHash) =>
            tx.medicationDatasetGateAttestation.create({
              data: {
                id,
                seq: s.seq,
                datasetVersion: input.datasetVersion,
                gateCode: input.gateCode,
                evidenceRef,
                summary,
                recordedByUserId: input.actor.userId,
                recordedAt: now,
                prevRowHash: s.prevRowHash,
                rowHash,
              },
            }),
        );
        await this.deps.audit.append(tx, {
          tenantId: null,
          actorUserId: input.actor.userId,
          actorType: 'OPERATOR',
          action: 'MEDICATION_GATE_ATTESTED',
          resourceType: 'medication_dataset_gate',
          resourceId: id,
          outcome: 'SUCCESS',
          requestId: input.actor.requestId ?? null,
          correlationId,
          // The evidence reference and the summary are in the attestation row, which is chained. Copying
          // them here would put the same claim in two places that can drift.
          metadata: { datasetVersion: input.datasetVersion, gateCode: input.gateCode },
        });
        return appended;
      },
      { context: 'meddata:attest' },
    );

    return { id, seq: slot.seq.toString() };
  }

  /** Which of the four gates a version has, and which it is still missing. */
  async gateStatus(datasetVersion: string): Promise<CatalogGateStatus> {
    const rows = await this.deps.prisma.medicationDatasetGateAttestation.findMany({
      where: { datasetVersion },
      select: { gateCode: true, recordedAt: true, recordedByUserId: true },
    });
    const byCode = new Map(rows.map((r) => [r.gateCode, r]));
    const gates = REQUIRED_GATE_CODES.map((gateCode) => {
      const row = byCode.get(gateCode);
      return {
        gateCode,
        attested: row !== undefined,
        recordedAt: row?.recordedAt.toISOString() ?? null,
        recordedByUserId: row?.recordedByUserId ?? null,
      };
    });
    return { datasetVersion, gates, allAttested: gates.every((g) => g.attested) };
  }

  /** The most recent imports, newest first. Reading one is how an operator finds out what happened. */
  async listImports(limit = 20): Promise<ImportStatusView[]> {
    const rows = await this.deps.prisma.medicationDatasetImport.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
    });
    return rows.map((r) => this.toView(r));
  }

  async getImport(importId: string): Promise<ImportStatusView> {
    const row = await this.deps.prisma.medicationDatasetImport.findUnique({ where: { id: importId } });
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', 'no such import');
    return this.toView(row);
  }

  private toView(r: {
    id: string;
    datasetVersion: string;
    datasetStatus: string;
    environment: string;
    executionPath: string;
    status: string;
    refusalReason: string | null;
    requestedBy: string;
    counts: unknown;
    checkpoint: unknown;
    errorClass: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
  }): ImportStatusView {
    return {
      importId: r.id,
      datasetVersion: r.datasetVersion,
      datasetStatus: r.datasetStatus,
      environment: r.environment,
      executionPath: r.executionPath,
      status: r.status,
      refusalReason: r.refusalReason,
      requestedBy: r.requestedBy,
      counts: r.counts,
      checkpoint: r.checkpoint,
      errorClass: r.errorClass,
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
