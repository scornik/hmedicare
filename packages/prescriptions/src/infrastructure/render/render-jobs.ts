import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type PrismaClient, withTransaction } from '@hmedic/database';
import { type Clock, newId, systemClock } from '@hmedic/kernel';
import { type JobRegistry, type JobRunner, NonRetryableJobError } from '@hmedic/jobs';
import { type ObjectStoragePort, buildStorageKey } from '@hmedic/laboratory-documents';
import type { Logger } from '@hmedic/observability';
import { approvedSnapshotSha256 } from '../../domain/prescription';
import {
  RX_TEMPLATE_VERSION,
  type RenderInput,
  type RenderItem,
  renderPrescriptionPdf,
} from './prescription-pdf';

/**
 * `RenderPrescriptionPdf` (RX-005, PRESCRIPTION-IMPLEMENTATION.md §3).
 *
 * Rendering never changes `clinical_status`. A PDF is a copy of a decision, not the decision, and the
 * two are kept apart deliberately: a failed render leaves an approved prescription approved, and a
 * successful one cannot make a draft final.
 *
 * The job verifies the approved snapshot hash before it renders anything. The hash was computed at
 * approval over the header and items; recomputing it here and comparing is what makes "this PDF is what
 * was approved" a checkable claim rather than an assumption. A mismatch means the row was changed
 * underneath the approval — by a repair script, a bad migration, a bug — and no retry can fix that, so
 * the job dead-letters rather than printing a document that disagrees with its own signature.
 *
 * Idempotent per prescription: a second run finds the stored document, re-renders deterministically,
 * and when the bytes match what is already stored it changes nothing. That matters because the outbox
 * can deliver one event twice, and two `documents` rows for one prescription would leave two PDFs with
 * equal claim to being the real one.
 */
export const DOCUMENTS_QUEUE = 'documents';
export const RENDER_PRESCRIPTION_PDF = 'RenderPrescriptionPdf';

export const RenderPrescriptionPdfPayload = z.object({
  v: z.literal(1),
  prescriptionId: z.string().min(1).max(36),
  tenantId: z.string().min(1).max(36),
});

export type RenderPrescriptionPdfPayload = z.infer<typeof RenderPrescriptionPdfPayload>;

export interface RenderJobDeps {
  prisma: PrismaClient;
  storage: ObjectStoragePort;
  clock?: Clock;
  logger?: Logger;
}

/** What the page shows beyond the items, read at render time because none of it is clinical content. */
interface Letterhead {
  clinicName: string;
  doctorName: string;
  doctorRegistration: string | null;
  patientName: string;
  patientCode: string;
}

export async function loadRenderInput(
  prisma: PrismaClient,
  tenantId: string,
  prescriptionId: string,
): Promise<{ input: RenderInput; patientId: string; encounterId: string } | null> {
  const rx = await prisma.prescription.findFirst({
    where: { tenantId, id: prescriptionId },
    select: {
      id: true,
      patientId: true,
      encounterId: true,
      doctorProfileId: true,
      revision: true,
      clinicalStatus: true,
      approvedAt: true,
      attestationVersion: true,
      approvedSnapshotSha256: true,
    },
  });
  if (!rx) return null;
  if (rx.clinicalStatus !== 'APPROVED' && rx.clinicalStatus !== 'VOID') {
    // Only a final revision renders. A draft PDF is a document that can be handed to a patient and then
    // changed, which is the one thing a prescription must never be.
    throw new NonRetryableJobError('PRESCRIPTION_NOT_APPROVED');
  }
  if (!rx.approvedAt || !rx.approvedSnapshotSha256) {
    throw new NonRetryableJobError('PRESCRIPTION_NOT_APPROVED');
  }

  const items = await prisma.prescriptionItem.findMany({
    where: { tenantId, prescriptionId },
    orderBy: { sequence: 'asc' },
  });

  // The hash is recomputed from the committed rows and compared with the one approval recorded. This is
  // the whole integrity story of the PDF, so it happens before a single byte is rendered.
  const recomputed = approvedSnapshotSha256(
    {
      patientId: rx.patientId,
      encounterId: rx.encounterId,
      doctorProfileId: rx.doctorProfileId,
      revision: rx.revision,
      // Non-null by `chk_prescriptions_approved_complete` plus the guard above; the cast says so once
      // rather than threading an impossible null through the hash.
      attestationVersion: rx.attestationVersion ?? 0,
    },
    items.map((i) => ({
      sequence: i.sequence,
      medicationId: i.medicationId,
      medicationDatasetVersion: i.medicationDatasetVersion,
      catalogSnapshot: i.catalogSnapshot as never,
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
  );
  if (recomputed !== rx.approvedSnapshotSha256) {
    // Nothing a retry can fix: the stored items no longer match what was approved.
    throw new NonRetryableJobError('RX_SNAPSHOT_MISMATCH');
  }

  const letterhead = await loadLetterhead(prisma, tenantId, rx.patientId, rx.doctorProfileId);
  const renderItems: RenderItem[] = items.map((i) => ({
    sequence: i.sequence,
    // The name as recorded at approval: the catalog snapshot, or the free text the doctor typed. Never
    // a fresh read of `medications`, which a later import may have changed.
    name: i.isFreeText
      ? (i.freeTextName ?? 'Unnamed item')
      : ((i.catalogSnapshot as { brandName?: string } | null)?.brandName ?? i.freeTextName ?? 'Unnamed item'),
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
  }));

  return {
    patientId: rx.patientId,
    encounterId: rx.encounterId,
    input: {
      prescriptionId: rx.id,
      revision: rx.revision,
      clinicalStatus: rx.clinicalStatus as 'APPROVED' | 'VOID',
      approvedAt: rx.approvedAt,
      approvedSnapshotSha256: rx.approvedSnapshotSha256,
      items: renderItems,
      ...letterhead,
    },
  };
}

async function loadLetterhead(
  prisma: PrismaClient,
  tenantId: string,
  patientId: string,
  doctorProfileId: string,
): Promise<Letterhead> {
  const [tenant, patient, doctor] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: tenantId }, select: { name: true } }),
    prisma.patient.findFirst({
      where: { tenantId, id: patientId },
      select: { legalName: true, medicalRecordNumber: true },
    }),
    prisma.doctorProfile.findFirst({
      where: { tenantId, id: doctorProfileId },
      select: { userId: true, registrationNumber: true },
    }),
  ]);
  const doctorUser = doctor
    ? await prisma.user.findFirst({ where: { id: doctor.userId }, select: { displayName: true } })
    : null;
  return {
    clinicName: tenant?.name ?? 'Clinic',
    doctorName: doctorUser?.displayName ?? 'Doctor',
    doctorRegistration: doctor?.registrationNumber ?? null,
    // The legal name, not the display name: a prescription is dispensed against identity documents.
    patientName: patient?.legalName ?? 'Patient',
    patientCode: patient?.medicalRecordNumber ?? '',
  };
}

export function registerPrescriptionRenderJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  deps: RenderJobDeps,
): void {
  const clock = deps.clock ?? systemClock;

  registry.register({
    type: RENDER_PRESCRIPTION_PDF,
    queue: DOCUMENTS_QUEUE,
    payloadSchema: RenderPrescriptionPdfPayload,
    maxAttempts: 3,
    // Rendering a page or two takes well under a second; the lease covers a slow disk and a cold font
    // cache, not a long job.
    leaseSeconds: 120,
    // Below a person waiting on a request, above the maintenance counters.
    priority: 850,
  });

  runner?.handle(RENDER_PRESCRIPTION_PDF, async (ctx) => {
    const payload = ctx.payload as RenderPrescriptionPdfPayload;
    const { tenantId, prescriptionId } = payload;

    const loaded = await loadRenderInput(deps.prisma, tenantId, prescriptionId);
    if (!loaded) throw new NonRetryableJobError('PRESCRIPTION_NOT_FOUND');

    const rendered = await renderPrescriptionPdf(loaded.input);
    const now = clock.now();

    const existing = await deps.prisma.prescription.findFirstOrThrow({
      where: { tenantId, id: prescriptionId },
      select: { renderedDocumentId: true, lastRenderSha256: true },
    });
    if (existing.renderedDocumentId && existing.lastRenderSha256 === rendered.sha256) {
      // A replayed event. The stored PDF is byte-identical to what this run produced, so there is
      // nothing to write and nothing to tidy up.
      deps.logger?.info({ prescriptionId }, 'prescription render skipped: already stored');
      return;
    }

    const documentId = existing.renderedDocumentId ?? newId();
    // A re-render is a new revision rather than a replacement, because a revision someone has already
    // downloaded has to keep pointing at the bytes they downloaded.
    const previous = existing.renderedDocumentId
      ? await deps.prisma.documentVersion.aggregate({
          where: { tenantId, documentId },
          _max: { revision: true },
        })
      : null;
    const revision = (previous?._max.revision ?? 0) + 1;
    const key = buildStorageKey({
      tenantId,
      category: 'PRESCRIPTION_PDF',
      documentId,
      revision,
    });

    // Bytes before rows. An object with no row is unreferenced garbage a cleanup can find; a row with no
    // object is a download that fails for a patient holding a prescription.
    const stored = await deps.storage.put(key, rendered.bytes, 'application/pdf');

    await withTransaction(
      deps.prisma,
      async (tx) => {
        await tx.document.upsert({
          where: { id: documentId },
          create: {
            id: documentId,
            tenantId,
            patientId: loaded.patientId,
            encounterId: loaded.encounterId,
            category: 'PRESCRIPTION_PDF',
            status: 'AVAILABLE',
            currentRevision: revision,
            title: `Prescription revision ${loaded.input.revision}`,
            // The clinical team by default. Giving a patient the PDF is a separate, consent-checked
            // delivery step, not a property of the file existing.
            accessPolicy: 'CLINICAL_TEAM',
            createdAt: now,
            updatedAt: now,
          },
          update: { currentRevision: revision, status: 'AVAILABLE', updatedAt: now },
        });
        await tx.documentVersion.create({
          data: {
            id: newId(),
            tenantId,
            documentId,
            revision,
            storageAdapter: deps.storage.adapter,
            storageKey: stored.key,
            contentType: 'application/pdf',
            sizeBytes: BigInt(stored.sizeBytes),
            sha256: stored.sha256,
            // Generated by this system, so there is nothing to scan (ADR-016 §2) — recorded as a
            // decision with the generator named, rather than left PENDING forever where it would be
            // indistinguishable from a scan that never ran.
            scanStatus: 'CLEAN',
            scanAdapter: `generated:${RX_TEMPLATE_VERSION}`,
            scannedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });
        await tx.prescription.update({
          where: { id: prescriptionId },
          data: {
            renderStatus: 'AVAILABLE',
            renderedDocumentId: documentId,
            renderTemplateVersion: rendered.templateVersion,
            lastRenderSha256: rendered.sha256,
            lastRenderedAt: now,
            updatedAt: now,
            rowVersion: { increment: 1 },
          },
        });
      },
      { context: 'RenderPrescriptionPdf' },
    );

    deps.logger?.info(
      { prescriptionId, documentId, revision, sizeBytes: stored.sizeBytes },
      'prescription rendered',
    );
  });
}

/**
 * Enqueues a render for an approved prescription.
 *
 * Separate from the job so the API can refuse a draft synchronously — a caller asking for a PDF of
 * something unapproved should be told at the request, not by a job that dead-letters out of sight.
 */
export async function enqueuePrescriptionRender(
  prisma: PrismaClient,
  input: { tenantId: string; prescriptionId: string; correlationId?: string },
  clock: Clock = systemClock,
): Promise<{ jobId: string; renderStatus: string }> {
  const rx = await prisma.prescription.findFirst({
    where: { tenantId: input.tenantId, id: input.prescriptionId },
    select: { clinicalStatus: true, renderStatus: true, renderedDocumentId: true },
  });
  if (!rx) throw new NonRetryableJobError('PRESCRIPTION_NOT_FOUND');
  if (rx.clinicalStatus !== 'APPROVED' && rx.clinicalStatus !== 'VOID') {
    throw new NonRetryableJobError('PRESCRIPTION_NOT_APPROVED');
  }

  const now = clock.now();
  const jobId = newId();
  await withTransaction(
    prisma,
    async (tx) => {
      await tx.job.create({
        data: {
          id: jobId,
          queue: DOCUMENTS_QUEUE,
          type: RENDER_PRESCRIPTION_PDF,
          payload: { v: 1, prescriptionId: input.prescriptionId, tenantId: input.tenantId },
          status: 'QUEUED',
          runAt: now,
          correlationId: input.correlationId ?? randomUUID(),
          createdAt: now,
          updatedAt: now,
        },
      });
      // QUEUED only while nothing is stored yet. A re-render of a prescription that already has a PDF
      // leaves the old one downloadable until the new one lands, because the alternative is a window
      // where a doctor asking for a fresh copy makes the existing copy unavailable.
      if (!rx.renderedDocumentId) {
        await tx.prescription.update({
          where: { id: input.prescriptionId },
          data: { renderStatus: 'QUEUED', updatedAt: now, rowVersion: { increment: 1 } },
        });
      }
    },
    { context: 'enqueuePrescriptionRender' },
  );
  return { jobId, renderStatus: rx.renderedDocumentId ? rx.renderStatus : 'QUEUED' };
}
