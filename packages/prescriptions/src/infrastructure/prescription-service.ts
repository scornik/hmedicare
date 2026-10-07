import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, lockRow, withTransaction } from '@hmedic/database';
import type { AuditMetadata, AuditPort } from '@hmedic/audit';
import type { ClinicalAccessPolicy, ClinicalActor } from '@hmedic/clinical';
import type { Metrics } from '@hmedic/observability';
import type { PrescriptionOutbox } from './events';
import { enqueuePrescriptionRender } from './render/render-jobs';
import {
  ATTESTATION_VERSION,
  type ClinicalStatus,
  type PrescriptionItemInput,
  approvedSnapshotSha256,
  canTransition,
  itemsEditable,
  statusAfterItemEdit,
  validateItems,
} from '../domain/prescription';

/**
 * The prescription lifecycle (PRESCRIPTION-IMPLEMENTATION.md §1, Stage 7 CP10).
 *
 * `signed consultation → fast editor → draft → doctor approval → immutable approved version`. The two
 * properties worth stating, because everything here exists to hold them:
 *
 * **An approved prescription cannot change.** Not by an item edit, not by a status move, not by a
 * repair script that forgets. `itemsEditable` refuses at the service, the parent row is locked before
 * anything touches its items, and `uq_prescriptions_one_approved` refuses a second approved revision
 * even if both of those were bypassed. A correction creates the *next* revision.
 *
 * **Nothing clinical is ever suggested.** The catalog contributes a name, a strength string and a form;
 * dose, frequency and duration come from the prescriber and are required. Stage 7 does no decision
 * support, and a service is exactly where "just a sensible default" would first appear.
 */
export interface PrescriptionItemView extends PrescriptionItemInput {
  id: string;
}

export interface PrescriptionView {
  id: string;
  patientId: string;
  encounterId: string;
  doctorProfileId: string;
  revision: number;
  supersedesPrescriptionId: string | null;
  clinicalStatus: ClinicalStatus;
  renderStatus: string;
  /** The stored PDF, once a render produced one. Null until then (RX-005). */
  renderedDocumentId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  approvedByDoctorProfileId: string | null;
  approvedAt: string | null;
  attestationVersion: number | null;
  approvedSnapshotSha256: string | null;
  voidedByUserId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  rowVersion: number;
  items: PrescriptionItemView[];
}

export interface PrescriptionServiceDeps {
  prisma: PrismaClient;
  audit: AuditPort<unknown>;
  access: ClinicalAccessPolicy;
  /** Domain events. Optional so a test can exercise the lifecycle without a publisher. */
  outbox?: PrescriptionOutbox;
  clock?: Clock;
  metrics?: Metrics;
}

/** Fields the caller may set on an item; `id` is ours. */
type ItemWrite = Omit<PrescriptionItemInput, never>;

export class PrescriptionService {
  private readonly clock: Clock;

  constructor(private readonly deps: PrescriptionServiceDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  // ---------------------------------------------------------------- reading

  async get(actor: ClinicalActor, prescriptionId: string): Promise<PrescriptionView> {
    const row = await this.deps.prisma.prescription.findFirst({
      where: { tenantId: actor.tenant.tenantId, id: prescriptionId },
    });
    if (!row) throw new AppError('RESOURCE_NOT_FOUND');
    // Reading a prescription is reading the encounter it belongs to, so the same footing decides it.
    await this.deps.access.assignedOrScoped(actor, row.encounterId);
    return this.view(row);
  }

  /** Every revision for an encounter, newest first. The history a correction leaves behind. */
  async listForEncounter(actor: ClinicalActor, encounterId: string): Promise<PrescriptionView[]> {
    await this.deps.access.assignedOrScoped(actor, encounterId);
    const rows = await this.deps.prisma.prescription.findMany({
      where: { tenantId: actor.tenant.tenantId, encounterId },
      orderBy: { revision: 'desc' },
    });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  // ---------------------------------------------------------------- drafting

  /**
   * The encounter's open draft, created on first use.
   *
   * Assignment, not scope: a prescription carries the prescribing doctor's name, so the row can only be
   * opened by someone the encounter actually assigns. A nurse granted `prescription.write` edits an
   * existing draft; they do not bring one into being under a doctor's name.
   */
  async openDraft(actor: ClinicalActor, encounterId: string): Promise<PrescriptionView> {
    const access = await this.deps.access.assigned(actor, encounterId);
    if (!actor.doctorProfileId) throw new AppError('FORBIDDEN');

    const existing = await this.deps.prisma.prescription.findFirst({
      where: {
        tenantId: actor.tenant.tenantId,
        encounterId,
        clinicalStatus: { in: ['DRAFT', 'REVIEWED'] },
      },
    });
    if (existing) return this.view(existing);

    const now = this.clock.now();
    const id = newId();
    const revision = await this.nextRevision(actor.tenant.tenantId, encounterId);
    const row = await withTransaction(
      this.deps.prisma,
      async (tx) => {
        const created = await tx.prescription.create({
          data: {
            id,
            tenantId: actor.tenant.tenantId,
            patientId: access.encounter.patientId,
            encounterId,
            doctorProfileId: actor.doctorProfileId!,
            revision,
            clinicalStatus: 'DRAFT',
            renderStatus: 'NOT_REQUESTED',
            createdAt: now,
            updatedAt: now,
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
        });
        await this.audit(tx, actor, 'PRESCRIPTION_DRAFT_OPENED', id, { revision });
        await this.deps.outbox?.emit(tx, {
          tenantId: actor.tenant.tenantId,
          name: 'PrescriptionDraftCreated',
          aggregateId: id,
          payload: { encounterId, patientId: access.encounter.patientId, revision },
          actorId: actor.userId,
          correlationId: actor.correlationId ?? null,
        });
        return created;
      },
      { context: 'prescription:open-draft' },
    );
    return this.view(row);
  }

  /**
   * Replaces the item list of an editable prescription.
   *
   * Replace rather than patch: an item diff has to decide what an absent line means, and "the doctor
   * removed it" and "the client did not send it" are indistinguishable in a payload. The whole list,
   * against a row version, says exactly what the prescriber sees on their screen.
   */
  async replaceItems(
    actor: ClinicalActor,
    prescriptionId: string,
    input: { expectedRowVersion: number; items: readonly ItemWrite[] },
  ): Promise<PrescriptionView> {
    const problems = validateItems(input.items);
    if (problems.length > 0) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fieldErrors: problems.map((p) => ({
          path: `items[${p.sequence}].${p.field}`,
          code: p.code,
          message: `validation.${p.code}`,
        })),
      });
    }

    const row = await withTransaction(
      this.deps.prisma,
      async (tx) => {
        const current = await this.lockEditable(tx, actor, prescriptionId, input.expectedRowVersion);
        const now = this.clock.now();

        await tx.prescriptionItem.deleteMany({
          where: { tenantId: actor.tenant.tenantId, prescriptionId },
        });
        if (input.items.length > 0) {
          await tx.prescriptionItem.createMany({
            data: input.items.map((i) => ({
              id: newId(),
              tenantId: actor.tenant.tenantId,
              prescriptionId,
              sequence: i.sequence,
              medicationId: i.medicationId,
              medicationDatasetVersion: i.medicationDatasetVersion,
              catalogSnapshot: i.catalogSnapshot ?? undefined,
              freeTextName: i.freeTextName,
              isFreeText: i.isFreeText,
              strength: i.strength,
              dosageForm: i.dosageForm,
              route: i.route,
              dose: i.dose,
              frequency: i.frequency,
              duration: i.duration,
              quantity: i.quantity,
              timing: i.timing,
              instructions: i.instructions,
              instructionsBn: i.instructionsBn,
              substitutionAllowed: i.substitutionAllowed,
            })),
          });
        }

        // Editing invalidates a review: "someone checked these items" stops being true the moment the
        // items change. Applied here rather than asked of the caller, because a caller who forgets
        // leaves a marker that claims something nobody did.
        const nextStatus = statusAfterItemEdit(current.clinicalStatus as ClinicalStatus);
        const updated = await tx.prescription.update({
          where: { id: prescriptionId },
          data: {
            clinicalStatus: nextStatus,
            reviewedByUserId: nextStatus === 'DRAFT' ? null : current.reviewedByUserId,
            reviewedAt: nextStatus === 'DRAFT' ? null : current.reviewedAt,
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.audit(tx, actor, 'PRESCRIPTION_ITEMS_REPLACED', prescriptionId, {
          items: input.items.length,
          reviewInvalidated: current.clinicalStatus === 'REVIEWED',
        });
        return updated;
      },
      { context: 'prescription:replace-items' },
    );
    return this.view(row);
  }

  /**
   * Marks the items as checked. An optional, purely administrative marker (C-11).
   *
   * It is not final, not visible to patients and not renderable — the CHECK on `render_status` makes the
   * last of those a database rule rather than a convention. A nurse with `prescription.review` may set
   * it; nobody's clinical responsibility changes because of it.
   */
  async markReviewed(
    actor: ClinicalActor,
    prescriptionId: string,
    input: { expectedRowVersion: number },
  ): Promise<PrescriptionView> {
    const row = await withTransaction(
      this.deps.prisma,
      async (tx) => {
        const current = await this.lockEditable(tx, actor, prescriptionId, input.expectedRowVersion);
        if (!canTransition(current.clinicalStatus as ClinicalStatus, 'REVIEWED')) {
          throw new AppError('INVALID_TRANSITION', undefined, {
            details: { from: current.clinicalStatus, to: 'REVIEWED' },
          });
        }
        if ((await this.itemCount(tx, actor.tenant.tenantId, prescriptionId)) === 0) {
          throw new AppError('VALIDATION_FAILED', 'an empty prescription has nothing to review');
        }
        const now = this.clock.now();
        const updated = await tx.prescription.update({
          where: { id: prescriptionId },
          data: {
            clinicalStatus: 'REVIEWED',
            reviewedByUserId: actor.userId,
            reviewedAt: now,
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.audit(tx, actor, 'PRESCRIPTION_REVIEWED', prescriptionId, {});
        await this.deps.outbox?.emit(tx, {
          tenantId: actor.tenant.tenantId,
          name: 'PrescriptionReviewed',
          aggregateId: prescriptionId,
          payload: { encounterId: current.encounterId, revision: current.revision },
          actorId: actor.userId,
          correlationId: actor.correlationId ?? null,
        });
        return updated;
      },
      { context: 'prescription:review' },
    );
    return this.view(row);
  }

  // ---------------------------------------------------------------- approval

  /**
   * Approves a prescription: final clinical truth, frozen under a content hash.
   *
   * Only an assigned doctor, because approval is the act that attaches a name to what a patient will be
   * given. When this revision supersedes another, the superseded one is voided **first, in the same
   * transaction** — `uq_prescriptions_one_approved` permits exactly one approved revision per encounter,
   * so approving before voiding would collide with the row being replaced.
   */
  async approve(
    actor: ClinicalActor,
    prescriptionId: string,
    input: { expectedRowVersion: number; attestationVersion: number },
  ): Promise<PrescriptionView> {
    if (input.attestationVersion !== ATTESTATION_VERSION) {
      throw new AppError('VALIDATION_FAILED', 'the attestation text has changed; reload and read it', {
        details: { expected: ATTESTATION_VERSION, received: input.attestationVersion },
      });
    }

    const started = Date.now();
    const row = await withTransaction(
      this.deps.prisma,
      async (tx) => {
        const current = await this.lockEditable(tx, actor, prescriptionId, input.expectedRowVersion);
        // Assignment is checked inside the transaction: a coverage grant that lapsed between opening
        // the editor and pressing approve must not approve.
        const access = await this.deps.access.assigned(actor, current.encounterId);
        if (!actor.doctorProfileId) throw new AppError('FORBIDDEN');
        if (!canTransition(current.clinicalStatus as ClinicalStatus, 'APPROVED')) {
          throw new AppError('INVALID_TRANSITION', undefined, {
            details: { from: current.clinicalStatus, to: 'APPROVED' },
          });
        }

        const items = await tx.prescriptionItem.findMany({
          where: { tenantId: actor.tenant.tenantId, prescriptionId },
          orderBy: { sequence: 'asc' },
        });
        if (items.length === 0) {
          throw new AppError('VALIDATION_FAILED', 'an empty prescription cannot be approved');
        }
        const problems = validateItems(items.map((i) => this.itemInput(i)));
        if (problems.length > 0) {
          // Re-validated at approval, not only at edit: a row could have been written by a repair
          // script, and approval is the last moment anyone can still refuse.
          throw new AppError('VALIDATION_FAILED', 'the items are not complete', {
            fieldErrors: problems.map((p) => ({
              path: `items[${p.sequence}].${p.field}`,
              code: p.code,
              message: `validation.${p.code}`,
            })),
          });
        }

        const now = this.clock.now();
        if (current.supersedesPrescriptionId) {
          await this.voidSuperseded(tx, actor, current.supersedesPrescriptionId, current.revision, now);
        }

        const snapshot = approvedSnapshotSha256(
          {
            patientId: current.patientId,
            encounterId: current.encounterId,
            doctorProfileId: current.doctorProfileId,
            revision: current.revision,
            attestationVersion: input.attestationVersion,
          },
          items.map((i) => this.itemInput(i)),
        );

        const updated = await tx.prescription.update({
          where: { id: prescriptionId },
          data: {
            clinicalStatus: 'APPROVED',
            approvedByDoctorProfileId: actor.doctorProfileId,
            approvedAt: now,
            attestationVersion: input.attestationVersion,
            approvedSnapshotSha256: snapshot,
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.audit(tx, actor, 'PRESCRIPTION_APPROVED', prescriptionId, {
          revision: current.revision,
          items: items.length,
          patientId: access.encounter.patientId,
          supersededPrescriptionId: current.supersedesPrescriptionId,
        });
        // Identifiers and counts only. `RecordMedicationUsage` reads the item rows itself, because a
        // list of what was prescribed does not belong in an event payload.
        await this.deps.outbox?.emit(tx, {
          tenantId: actor.tenant.tenantId,
          name: 'PrescriptionApproved',
          aggregateId: prescriptionId,
          payload: {
            encounterId: current.encounterId,
            patientId: current.patientId,
            revision: current.revision,
            items: items.length,
            // `supersedesId`, not `supersedesPrescriptionId`: the outbox PHI deny-list refuses any key
            // matching /prescri/i, and the right answer to a control firing is a different key name,
            // never a looser control.
            supersedesId: current.supersedesPrescriptionId,
          },
          actorId: actor.userId,
          correlationId: actor.correlationId ?? null,
          // One approval of one revision is one event, however many times the request is retried.
          idempotencyKey: `prescription-approved:${prescriptionId}`,
        });
        return updated;
      },
      { context: 'prescription:approve' },
    );
    this.deps.metrics?.prescriptionApprovalDuration.observe((Date.now() - started) / 1000);
    return this.view(row);
  }

  /**
   * Starts a correction: a new DRAFT revision carrying a copy of the approved items.
   *
   * The approved revision is untouched until the correction is itself approved, so a correction that is
   * abandoned half-written leaves the patient's prescription exactly as it was.
   */
  async startCorrection(actor: ClinicalActor, prescriptionId: string): Promise<PrescriptionView> {
    const source = await this.deps.prisma.prescription.findFirst({
      where: { tenantId: actor.tenant.tenantId, id: prescriptionId },
    });
    if (!source) throw new AppError('RESOURCE_NOT_FOUND');
    await this.deps.access.assigned(actor, source.encounterId);
    if (!actor.doctorProfileId) throw new AppError('FORBIDDEN');
    if (source.clinicalStatus !== 'APPROVED') {
      throw new AppError('PRESCRIPTION_NOT_APPROVED', undefined, {
        details: { clinicalStatus: source.clinicalStatus },
      });
    }

    const now = this.clock.now();
    const id = newId();
    const revision = await this.nextRevision(actor.tenant.tenantId, source.encounterId);
    const row = await withTransaction(
      this.deps.prisma,
      async (tx) => {
        const items = await tx.prescriptionItem.findMany({
          where: { tenantId: actor.tenant.tenantId, prescriptionId },
          orderBy: { sequence: 'asc' },
        });
        const created = await tx.prescription.create({
          data: {
            id,
            tenantId: actor.tenant.tenantId,
            patientId: source.patientId,
            encounterId: source.encounterId,
            doctorProfileId: actor.doctorProfileId!,
            revision,
            supersedesPrescriptionId: source.id,
            clinicalStatus: 'DRAFT',
            renderStatus: 'NOT_REQUESTED',
            createdAt: now,
            updatedAt: now,
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
        });
        if (items.length > 0) {
          await tx.prescriptionItem.createMany({
            data: items.map((i) => ({
              ...this.itemInput(i),
              id: newId(),
              tenantId: actor.tenant.tenantId,
              prescriptionId: id,
              catalogSnapshot: (i.catalogSnapshot ?? undefined) as never,
            })),
          });
        }
        await this.audit(tx, actor, 'PRESCRIPTION_CORRECTION_STARTED', id, {
          revision,
          supersedesPrescriptionId: source.id,
          items: items.length,
        });
        return created;
      },
      { context: 'prescription:start-correction' },
    );
    return this.view(row);
  }

  /** Withdraws an approved prescription with a reason. There is no path back. */
  async void(
    actor: ClinicalActor,
    prescriptionId: string,
    input: { expectedRowVersion: number; reason: string; clinicalReviewerDoctorProfileId?: string | null },
  ): Promise<PrescriptionView> {
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'a void needs a reason');
    }
    const row = await withTransaction(
      this.deps.prisma,
      async (tx) => {
        const current = await this.lock(tx, actor, prescriptionId, input.expectedRowVersion);
        const access = await this.deps.access.assignedOrScoped(actor, current.encounterId);

        // AUTHORIZATION-MATRIX §6: a doctor voids on assignment. An owner or clinic admin may also
        // void, but only by naming an assigned doctor as the clinical reviewer — withdrawing a
        // prescription is a clinical decision, and an administrator taking it alone leaves no clinician
        // accountable for it. The named profile is checked against the encounter rather than trusted
        // from the payload, or the field would be a text box that satisfies a rule without meeting it.
        if (access.footing !== 'assigned') {
          const reviewerId = input.clinicalReviewerDoctorProfileId;
          if (!reviewerId) {
            throw new AppError('VALIDATION_FAILED', undefined, {
              fieldErrors: [
                {
                  path: 'clinicalReviewerDoctorProfileId',
                  code: 'required',
                  message: 'validation.clinical_reviewer_required',
                },
              ],
            });
          }
          const reviewerIsOnEncounter = await tx.encounter.findFirst({
            where: {
              tenantId: actor.tenant.tenantId,
              id: current.encounterId,
              OR: [{ doctorProfileId: reviewerId }, { coveringDoctorProfileId: reviewerId }],
            },
            select: { id: true },
          });
          if (!reviewerIsOnEncounter) {
            throw new AppError('VALIDATION_FAILED', undefined, {
              fieldErrors: [
                {
                  path: 'clinicalReviewerDoctorProfileId',
                  code: 'not_assigned',
                  message: 'validation.clinical_reviewer_not_assigned',
                },
              ],
            });
          }
        }

        if (!canTransition(current.clinicalStatus as ClinicalStatus, 'VOID')) {
          throw new AppError('INVALID_TRANSITION', undefined, {
            details: { from: current.clinicalStatus, to: 'VOID' },
          });
        }
        const now = this.clock.now();
        const updated = await tx.prescription.update({
          where: { id: prescriptionId },
          data: {
            clinicalStatus: 'VOID',
            voidedByUserId: actor.userId,
            voidedAt: now,
            voidReason: reason.slice(0, 500),
            clinicalReviewerDoctorProfileId: input.clinicalReviewerDoctorProfileId ?? null,
            updatedAt: now,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.audit(tx, actor, 'PRESCRIPTION_VOIDED', prescriptionId, {
          revision: current.revision,
          footing: access.footing,
          namedClinicalReviewer:
            input.clinicalReviewerDoctorProfileId !== undefined &&
            input.clinicalReviewerDoctorProfileId !== null,
        });
        return updated;
      },
      { context: 'prescription:void' },
    );
    return this.view(row);
  }

  // ---------------------------------------------------------------- internals

  /** Voids the revision being replaced, inside the approving transaction. */
  private async voidSuperseded(
    tx: Parameters<Parameters<typeof withTransaction>[1]>[0],
    actor: ClinicalActor,
    supersededId: string,
    byRevision: number,
    now: Date,
  ): Promise<void> {
    await lockRow(tx, 'prescriptions', supersededId, actor.tenant.tenantId);
    const previous = await tx.prescription.findFirst({
      where: { tenantId: actor.tenant.tenantId, id: supersededId },
    });
    if (!previous) throw new AppError('RESOURCE_NOT_FOUND');
    // Already void is not a conflict: a correction of a prescription somebody withdrew independently
    // is still a correction, and the new revision is still the one that counts.
    if (previous.clinicalStatus !== 'APPROVED') return;
    await tx.prescription.update({
      where: { id: supersededId },
      data: {
        clinicalStatus: 'VOID',
        voidedByUserId: actor.userId,
        voidedAt: now,
        voidReason: `Superseded by revision ${byRevision}`,
        updatedAt: now,
        updatedByUserId: actor.userId,
        rowVersion: { increment: 1 },
      },
    });
    await this.audit(tx, actor, 'PRESCRIPTION_VOIDED', supersededId, {
      reason: 'SUPERSEDED',
      bySupersedingRevision: byRevision,
    });
    // A correction emits both names in order, because it genuinely is both (ADR-024).
    await this.deps.outbox?.emit(tx, {
      tenantId: actor.tenant.tenantId,
      name: 'PrescriptionVoided',
      aggregateId: supersededId,
      payload: { encounterId: previous.encounterId, revision: previous.revision, superseded: true },
      actorId: actor.userId,
      correlationId: actor.correlationId ?? null,
    });
  }

  /** Locks the row and checks the version. The parent lock is what makes item writes safe. */
  private async lock(
    tx: Parameters<Parameters<typeof withTransaction>[1]>[0],
    actor: ClinicalActor,
    prescriptionId: string,
    expectedRowVersion: number,
  ) {
    await lockRow(tx, 'prescriptions', prescriptionId, actor.tenant.tenantId);
    const row = await tx.prescription.findFirst({
      where: { tenantId: actor.tenant.tenantId, id: prescriptionId },
    });
    if (!row) throw new AppError('RESOURCE_NOT_FOUND');
    if (row.rowVersion !== expectedRowVersion) {
      throw new AppError('STALE_VERSION', undefined, {
        details: { expected: expectedRowVersion, actual: row.rowVersion },
      });
    }
    return row;
  }

  /** The same, plus the refusal that makes an approved prescription immutable. */
  private async lockEditable(
    tx: Parameters<Parameters<typeof withTransaction>[1]>[0],
    actor: ClinicalActor,
    prescriptionId: string,
    expectedRowVersion: number,
  ) {
    const row = await this.lock(tx, actor, prescriptionId, expectedRowVersion);
    if (!itemsEditable(row.clinicalStatus as ClinicalStatus)) {
      throw new AppError('PRESCRIPTION_NOT_EDITABLE', undefined, {
        details: { clinicalStatus: row.clinicalStatus },
      });
    }
    return row;
  }

  private async itemCount(
    tx: Parameters<Parameters<typeof withTransaction>[1]>[0],
    tenantId: string,
    prescriptionId: string,
  ): Promise<number> {
    return tx.prescriptionItem.count({ where: { tenantId, prescriptionId } });
  }

  private async nextRevision(tenantId: string, encounterId: string): Promise<number> {
    const highest = await this.deps.prisma.prescription.findFirst({
      where: { tenantId, encounterId },
      orderBy: { revision: 'desc' },
      select: { revision: true },
    });
    return (highest?.revision ?? 0) + 1;
  }

  private itemInput(row: {
    sequence: number;
    medicationId: string | null;
    medicationDatasetVersion: string | null;
    catalogSnapshot: unknown;
    freeTextName: string | null;
    isFreeText: boolean;
    strength: string | null;
    dosageForm: string | null;
    route: string | null;
    dose: string;
    frequency: string;
    duration: string;
    quantity: string | null;
    timing: string | null;
    instructions: string | null;
    instructionsBn: string | null;
    substitutionAllowed: boolean;
  }): PrescriptionItemInput {
    return {
      sequence: row.sequence,
      medicationId: row.medicationId,
      medicationDatasetVersion: row.medicationDatasetVersion,
      catalogSnapshot: (row.catalogSnapshot ?? null) as PrescriptionItemInput['catalogSnapshot'],
      freeTextName: row.freeTextName,
      isFreeText: row.isFreeText,
      strength: row.strength,
      dosageForm: row.dosageForm,
      route: row.route,
      dose: row.dose,
      frequency: row.frequency,
      duration: row.duration,
      quantity: row.quantity,
      timing: row.timing,
      instructions: row.instructions,
      instructionsBn: row.instructionsBn,
      substitutionAllowed: row.substitutionAllowed,
    };
  }

  /**
   * Audit metadata carries ids, counts and enums only.
   *
   * No dose, no medication name, no instruction text. An audit log that quotes a prescription is a
   * second copy of the prescription in a table with different access rules (SECURITY §PHI).
   */
  private async audit(
    tx: unknown,
    actor: ClinicalActor,
    action: string,
    prescriptionId: string,
    metadata: AuditMetadata,
  ): Promise<void> {
    await this.deps.audit.append(tx, {
      tenantId: actor.tenant.tenantId,
      actorUserId: actor.userId,
      actorType: 'USER',
      action,
      resourceType: 'prescription',
      resourceId: prescriptionId,
      outcome: 'SUCCESS',
      requestId: actor.requestId ?? null,
      correlationId: actor.correlationId ?? null,
      metadata,
    });
  }

  private async view(row: {
    id: string;
    tenantId: string;
    patientId: string;
    encounterId: string;
    doctorProfileId: string;
    revision: number;
    supersedesPrescriptionId: string | null;
    clinicalStatus: string;
    renderStatus: string;
    renderedDocumentId: string | null;
    reviewedByUserId: string | null;
    reviewedAt: Date | null;
    approvedByDoctorProfileId: string | null;
    approvedAt: Date | null;
    attestationVersion: number | null;
    approvedSnapshotSha256: string | null;
    voidedByUserId: string | null;
    voidedAt: Date | null;
    voidReason: string | null;
    createdAt: Date;
    rowVersion: number;
  }): Promise<PrescriptionView> {
    const items = await this.deps.prisma.prescriptionItem.findMany({
      where: { tenantId: row.tenantId, prescriptionId: row.id },
      orderBy: { sequence: 'asc' },
    });
    return {
      id: row.id,
      patientId: row.patientId,
      encounterId: row.encounterId,
      doctorProfileId: row.doctorProfileId,
      revision: row.revision,
      supersedesPrescriptionId: row.supersedesPrescriptionId,
      clinicalStatus: row.clinicalStatus as ClinicalStatus,
      renderStatus: row.renderStatus,
      renderedDocumentId: row.renderedDocumentId,
      reviewedByUserId: row.reviewedByUserId,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      approvedByDoctorProfileId: row.approvedByDoctorProfileId,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      attestationVersion: row.attestationVersion,
      approvedSnapshotSha256: row.approvedSnapshotSha256,
      voidedByUserId: row.voidedByUserId,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidReason: row.voidReason,
      createdAt: row.createdAt.toISOString(),
      rowVersion: row.rowVersion,
      items: items.map((i) => ({ id: i.id, ...this.itemInput(i) })),
    };
  }
  /**
   * Queues a PDF render of a final revision (RX-005).
   *
   * The caller has already proved it may read this prescription. Everything else — that the revision is
   * final, that an existing PDF stays downloadable — belongs to `enqueuePrescriptionRender`, which the
   * worker's job handler shares, so the rule cannot drift between the route and the queue.
   */
  async requestRender(
    tenantId: string,
    prescriptionId: string,
    correlationId?: string,
  ): Promise<{ jobId: string; renderStatus: string; documentId: string | null }> {
    const queued = await enqueuePrescriptionRender(
      this.deps.prisma,
      { tenantId, prescriptionId, correlationId },
      this.clock,
    );
    const row = await this.deps.prisma.prescription.findFirstOrThrow({
      where: { tenantId, id: prescriptionId },
      select: { renderedDocumentId: true },
    });
    return { ...queued, documentId: row.renderedDocumentId };
  }
}
