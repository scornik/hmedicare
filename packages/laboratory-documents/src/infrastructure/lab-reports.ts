import { Prisma, type PrismaClient, withTransaction } from '@hmedic/database';
import { AppError, newId } from '@hmedic/kernel';

export interface CreateLabReportInput {
  tenantId: string;
  documentId: string;
  actorUserId: string;
  labName?: string | null;
  reportDate?: Date | null;
}

export interface AddLabResultInput {
  tenantId: string;
  reportId: string;
  actorUserId: string;
  expectedRowVersion: number;
  analyteDisplay: string;
  valueNumeric?: string | null;
  valueText?: string | null;
  unit?: string | null;
  referenceRange?: string | null;
  abnormalFlag?: 'LOW' | 'HIGH' | 'CRITICAL' | 'NORMAL' | null;
}

/** Structured entries are clinician-authored derivatives. The AVAILABLE source file remains authoritative. */
export class LabReportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date,
  ) {}

  async create(input: CreateLabReportInput) {
    return withTransaction(
      this.prisma,
      async (tx) => {
        const document = await tx.document.findFirst({
          where: {
            id: input.documentId,
            tenantId: input.tenantId,
            category: 'LAB_REPORT',
            status: 'AVAILABLE',
            currentRevision: { not: null },
            redactedAt: null,
          },
          select: { patientId: true, encounterId: true },
        });
        if (!document || !document.encounterId) throw new AppError('DOCUMENT_NOT_AVAILABLE');
        const existing = await tx.labReport.findFirst({
          where: { tenantId: input.tenantId, documentId: input.documentId },
          select: { id: true },
        });
        if (existing) throw new AppError('INVALID_TRANSITION');
        const at = this.now();
        return tx.labReport.create({
          data: {
            id: newId(),
            tenantId: input.tenantId,
            patientId: document.patientId,
            encounterId: document.encounterId,
            documentId: input.documentId,
            labName: input.labName ?? null,
            reportDate: input.reportDate ?? null,
            reviewStatus: 'UNREVIEWED',
            createdAt: at,
            updatedAt: at,
            createdByUserId: input.actorUserId,
            updatedByUserId: input.actorUserId,
          },
        });
      },
      { context: 'create-lab-report' },
    ).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppError('INVALID_TRANSITION');
      throw error;
    });
  }

  async addResult(input: AddLabResultInput) {
    return withTransaction(
      this.prisma,
      async (tx) => {
        const at = this.now();
        const claimed = await tx.labReport.updateMany({
          where: {
            id: input.reportId,
            tenantId: input.tenantId,
            reviewStatus: 'UNREVIEWED',
            rowVersion: input.expectedRowVersion,
          },
          data: { rowVersion: { increment: 1 }, updatedAt: at, updatedByUserId: input.actorUserId },
        });
        if (claimed.count !== 1) throw new AppError('STALE_VERSION');
        return tx.labResult.create({
          data: {
            id: newId(),
            tenantId: input.tenantId,
            labReportId: input.reportId,
            analyteDisplay: input.analyteDisplay,
            valueNumeric: input.valueNumeric ?? null,
            valueText: input.valueText ?? null,
            unit: input.unit ?? null,
            referenceRange: input.referenceRange ?? null,
            abnormalFlag: input.abnormalFlag ?? null,
            entrySource: 'MANUAL',
            reviewStatus: 'UNREVIEWED',
            createdAt: at,
            updatedAt: at,
            createdByUserId: input.actorUserId,
            updatedByUserId: input.actorUserId,
          },
        });
      },
      { context: 'add-lab-result' },
    );
  }

  async review(input: {
    tenantId: string;
    reportId: string;
    actorUserId: string;
    doctorProfileId: string;
    expectedRowVersion: number;
  }) {
    return withTransaction(
      this.prisma,
      async (tx) => {
        const report = await tx.labReport.findFirst({
          where: { id: input.reportId, tenantId: input.tenantId },
          select: { documentId: true },
        });
        if (!report) throw new AppError('RESOURCE_NOT_FOUND');
        const source = await tx.document.findFirst({
          where: { id: report.documentId, tenantId: input.tenantId, status: 'AVAILABLE', redactedAt: null },
          select: { id: true },
        });
        if (!source) throw new AppError('DOCUMENT_NOT_AVAILABLE');
        const at = this.now();
        const claimed = await tx.labReport.updateMany({
          where: {
            id: input.reportId,
            tenantId: input.tenantId,
            reviewStatus: 'UNREVIEWED',
            rowVersion: input.expectedRowVersion,
          },
          data: {
            reviewStatus: 'REVIEWED',
            reviewedByDoctorProfileId: input.doctorProfileId,
            reviewedAt: at,
            updatedAt: at,
            updatedByUserId: input.actorUserId,
            rowVersion: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new AppError('STALE_VERSION');
        await tx.labResult.updateMany({
          where: { tenantId: input.tenantId, labReportId: input.reportId, reviewStatus: 'UNREVIEWED' },
          data: {
            reviewStatus: 'REVIEWED',
            updatedAt: at,
            updatedByUserId: input.actorUserId,
            rowVersion: { increment: 1 },
          },
        });
        return tx.labReport.findFirstOrThrow({ where: { id: input.reportId, tenantId: input.tenantId } });
      },
      { context: 'review-lab-report' },
    );
  }
}
