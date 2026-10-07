import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@hmedic/kernel';
import type { Database } from '@hmedic/database';
import { JobRegistry, JobRunner } from '@hmedic/jobs';
import { DiskObjectStorage } from '@hmedic/storage-adapters-disk';
import { chamberWithCalledSerial } from '../../../../tests/support/clinical';
import { openTestDatabase, truncateAll } from '../../../../tests/support/db';
import { ATTESTATION_VERSION, approvedSnapshotSha256 } from '../../src/domain/prescription';
import {
  DOCUMENTS_QUEUE,
  RENDER_PRESCRIPTION_PDF,
  enqueuePrescriptionRender,
  registerPrescriptionRenderJobs,
} from '../../src/infrastructure/render/render-jobs';

/**
 * `RenderPrescriptionPdf` end to end (RX-005).
 *
 * The interesting cases are the refusals. Rendering a draft, rendering a prescription whose items were
 * changed after approval, and rendering the same event twice are each a way for a patient to end up
 * holding a document that does not match the record — which is the failure this job exists to prevent,
 * not a convenience it provides.
 */
let db: Database;
let registry: JobRegistry;
let runner: JobRunner;
let storageRoot = '';
let storage: DiskObjectStorage;

let TENANT = '';
let scaffold: { patientId: string; doctorProfileId: string; encounterId: string };
const now = new Date('2026-10-05T09:30:00.000Z');
let revisionSeq = 0;

beforeAll(async () => {
  db = openTestDatabase();
});
afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await truncateAll();
  storageRoot = await mkdtemp(path.join(tmpdir(), 'hmedic-rx-render-'));
  storage = new DiskObjectStorage({ root: storageRoot });
  registry = new JobRegistry();
  runner = new JobRunner(db.prisma, registry, { app: 'test', strategy: 'skip_locked' });
  revisionSeq = 0;
  registerPrescriptionRenderJobs(registry, runner, { prisma: db.prisma, storage });

  const base = await chamberWithCalledSerial(db.prisma, 'render');
  TENANT = base.tenantId;
  const encounterId = newId();
  await db.prisma.encounter.create({
    data: {
      id: encounterId,
      tenantId: TENANT,
      patientId: base.patientId,
      doctorProfileId: base.doctorProfileId,
      chamberId: base.chamberId,
      serialId: base.serial.id,
      careMode: 'PHYSICAL',
      status: 'IN_PROGRESS',
      legacyInterim: false,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  scaffold = { patientId: base.patientId, doctorProfileId: base.doctorProfileId, encounterId };
});

afterEach(async () => {
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

const ITEM = {
  sequence: 1,
  medicationId: null,
  medicationDatasetVersion: null,
  catalogSnapshot: null,
  freeTextName: 'SYNTHETIC syrup',
  isFreeText: true,
  strength: null,
  dosageForm: null,
  route: null,
  dose: '10 ml',
  frequency: 'twice daily',
  duration: '5 days',
  quantity: null,
  timing: 'after food',
  instructions: null,
  instructionsBn: null,
  substitutionAllowed: true,
};

/** An approved prescription whose snapshot hash is the real one, as the service would have written it. */
async function prescription(clinicalStatus: 'DRAFT' | 'APPROVED' | 'VOID' = 'APPROVED') {
  const id = newId();
  const revision = ++revisionSeq;
  const final = clinicalStatus === 'APPROVED' || clinicalStatus === 'VOID';
  const hash = approvedSnapshotSha256(
    {
      patientId: scaffold.patientId,
      encounterId: scaffold.encounterId,
      doctorProfileId: scaffold.doctorProfileId,
      revision,
      attestationVersion: ATTESTATION_VERSION,
    },
    [ITEM],
  );
  await db.prisma.prescription.create({
    data: {
      id,
      tenantId: TENANT,
      patientId: scaffold.patientId,
      encounterId: scaffold.encounterId,
      doctorProfileId: scaffold.doctorProfileId,
      revision,
      clinicalStatus,
      renderStatus: 'NOT_REQUESTED',
      ...(final
        ? {
            approvedByDoctorProfileId: scaffold.doctorProfileId,
            approvedAt: now,
            attestationVersion: ATTESTATION_VERSION,
            approvedSnapshotSha256: hash,
          }
        : {}),
      ...(clinicalStatus === 'VOID' ? { voidReason: 'SUPERSEDED' } : {}),
      createdAt: now,
      updatedAt: now,
    } as never,
  });
  await db.prisma.prescriptionItem.create({
    data: { id: newId(), tenantId: TENANT, prescriptionId: id, ...ITEM } as never,
  });
  return id;
}

async function runRender(prescriptionId: string): Promise<string> {
  const { jobId } = await enqueuePrescriptionRender(db.prisma, {
    tenantId: TENANT,
    prescriptionId,
  });
  const claimed = await runner.claim(DOCUMENTS_QUEUE, 5);
  const target = claimed.find((j) => j.id === jobId);
  if (!target) throw new Error('the render job was not claimed');
  return runner.execute(target);
}

describe('RenderPrescriptionPdf', () => {
  it('renders an approved prescription into a stored, checksummed document', async () => {
    const id = await prescription('APPROVED');

    expect(await runRender(id)).toBe('SUCCEEDED');

    const rx = await db.prisma.prescription.findFirstOrThrow({ where: { tenantId: TENANT, id } });
    expect(rx.renderStatus).toBe('AVAILABLE');
    expect(rx.renderedDocumentId).not.toBeNull();
    expect(rx.lastRenderSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rx.renderTemplateVersion).toBe('rx-pdf-v1');
    // Rendering is not approval: the clinical status is untouched by it.
    expect(rx.clinicalStatus).toBe('APPROVED');

    const doc = await db.prisma.document.findFirstOrThrow({
      where: { tenantId: TENANT, id: rx.renderedDocumentId! },
    });
    expect(doc.category).toBe('PRESCRIPTION_PDF');
    expect(doc.status).toBe('AVAILABLE');
    expect(doc.currentRevision).toBe(1);
    expect(doc.accessPolicy).toBe('CLINICAL_TEAM');

    const version = await db.prisma.documentVersion.findFirstOrThrow({
      where: { tenantId: TENANT, documentId: doc.id, revision: 1 },
    });
    expect(version.contentType).toBe('application/pdf');
    expect(version.sha256).toBe(rx.lastRenderSha256);
    // Generated, so not scanned — recorded as a decision with the generator named, rather than left
    // PENDING where it would be indistinguishable from a scan that never ran.
    expect(version.scanStatus).toBe('CLEAN');
    expect(version.scanAdapter).toBe('generated:rx-pdf-v1');

    // The bytes are really there, and they are a PDF.
    const head = await storage.head(version.storageKey);
    expect(head.sha256).toBe(version.sha256);
    const { stream } = await storage.get(version.storageKey, { range: { start: 0, end: 4 } });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('%PDF-');
  }, 60_000);

  it('refuses to render a draft, before enqueueing anything', async () => {
    const id = await prescription('DRAFT');

    await expect(
      enqueuePrescriptionRender(db.prisma, { tenantId: TENANT, prescriptionId: id }),
    ).rejects.toThrow(/PRESCRIPTION_NOT_APPROVED/);

    // A draft PDF is a document that can be handed to a patient and then changed, so the refusal is at
    // the request rather than in a job that dead-letters out of sight.
    expect(await db.prisma.job.count({ where: { type: RENDER_PRESCRIPTION_PDF } })).toBe(0);
    const rx = await db.prisma.prescription.findFirstOrThrow({ where: { tenantId: TENANT, id } });
    expect(rx.renderStatus).toBe('NOT_REQUESTED');
  });

  it('renders a void revision, watermarked, for the audit trail', async () => {
    const id = await prescription('VOID');
    expect(await runRender(id)).toBe('SUCCEEDED');
    const rx = await db.prisma.prescription.findFirstOrThrow({ where: { tenantId: TENANT, id } });
    expect(rx.renderStatus).toBe('AVAILABLE');
  }, 60_000);

  it('writes one document when the same event is delivered twice', async () => {
    const id = await prescription('APPROVED');
    expect(await runRender(id)).toBe('SUCCEEDED');
    const first = await db.prisma.prescription.findFirstOrThrow({ where: { tenantId: TENANT, id } });

    expect(await runRender(id)).toBe('SUCCEEDED');

    // Two `documents` rows for one prescription would leave two PDFs with equal claim to being the
    // real one, so a replay that renders identical bytes must change nothing.
    expect(await db.prisma.document.count({ where: { tenantId: TENANT } })).toBe(1);
    expect(await db.prisma.documentVersion.count({ where: { tenantId: TENANT } })).toBe(1);
    const second = await db.prisma.prescription.findFirstOrThrow({ where: { tenantId: TENANT, id } });
    expect(second.renderedDocumentId).toBe(first.renderedDocumentId);
    expect(second.lastRenderSha256).toBe(first.lastRenderSha256);
  }, 90_000);

  it('dead-letters when the items no longer match the approved snapshot', async () => {
    const id = await prescription('APPROVED');
    // What a repair script, a bad migration or a bug looks like from here: the approval's signature no
    // longer describes the rows.
    await db.prisma.prescriptionItem.updateMany({
      where: { tenantId: TENANT, prescriptionId: id },
      data: { dose: '20 ml' },
    });

    expect(await runRender(id)).toBe('DEAD');

    // Nothing was written and nothing was stored: a PDF that disagrees with its own signature is worse
    // than no PDF.
    expect(await db.prisma.document.count({ where: { tenantId: TENANT } })).toBe(0);
    const rx = await db.prisma.prescription.findFirstOrThrow({ where: { tenantId: TENANT, id } });
    expect(rx.renderedDocumentId).toBeNull();
  }, 60_000);

  it('dead-letters when the prescription is gone', async () => {
    const registryJobId = newId();
    await db.prisma.job.create({
      data: {
        id: registryJobId,
        queue: DOCUMENTS_QUEUE,
        type: RENDER_PRESCRIPTION_PDF,
        payload: { v: 1, prescriptionId: newId(), tenantId: TENANT },
        status: 'QUEUED',
        runAt: new Date(),
        correlationId: newId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const claimed = await runner.claim(DOCUMENTS_QUEUE, 5);
    const target = claimed.find((j) => j.id === registryJobId);
    expect(await runner.execute(target!)).toBe('DEAD');
  });

  it('keeps the old PDF downloadable while a re-render is queued', async () => {
    const id = await prescription('APPROVED');
    expect(await runRender(id)).toBe('SUCCEEDED');
    const before = await db.prisma.prescription.findFirstOrThrow({ where: { tenantId: TENANT, id } });

    const { renderStatus } = await enqueuePrescriptionRender(db.prisma, {
      tenantId: TENANT,
      prescriptionId: id,
    });

    // Not QUEUED: a doctor asking for a fresh copy must not make the existing copy unavailable.
    expect(renderStatus).toBe('AVAILABLE');
    const after = await db.prisma.prescription.findFirstOrThrow({ where: { tenantId: TENANT, id } });
    expect(after.renderStatus).toBe('AVAILABLE');
    expect(after.renderedDocumentId).toBe(before.renderedDocumentId);
  }, 60_000);
});
