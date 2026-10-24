import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import { HTTP_RUNTIME, Idempotent, type HttpRuntime } from '@hmedic/http-kit';
import { CurrentActor, CurrentTenant, RequirePermission } from '@hmedic/identity-access/nest';
import { CLINICAL_SERVICES, type ClinicalServices } from '@hmedic/clinical/nest';
import { LabReportService } from '@hmedic/laboratory-documents';
import { clinicalActor } from '../clinical/actor';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
  );
const createBody = z
  .object({
    documentId: z.string().uuid(),
    labName: z.string().trim().min(1).max(200).nullable().optional(),
    reportDate: day.nullable().optional(),
  })
  .strict();
const resultBody = z
  .object({
    expectedRowVersion: z.number().int().positive(),
    analyteDisplay: z.string().trim().min(1).max(200),
    valueNumeric: z
      .string()
      .regex(/^-?\d{1,12}(\.\d{1,6})?$/)
      .nullable()
      .optional(),
    valueText: z.string().trim().min(1).max(200).nullable().optional(),
    unit: z.string().trim().min(1).max(40).nullable().optional(),
    referenceRange: z.string().trim().min(1).max(120).nullable().optional(),
    abnormalFlag: z.enum(['LOW', 'HIGH', 'CRITICAL', 'NORMAL']).nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      (input.valueNumeric !== null && input.valueNumeric !== undefined) !==
      (input.valueText !== null && input.valueText !== undefined),
  );
const reviewBody = z
  .object({ expectedRowVersion: z.number().int().positive(), attestedSource: z.literal(true) })
  .strict();

function reportView(row: {
  id: string;
  documentId: string;
  patientId: string;
  encounterId: string | null;
  labName: string | null;
  reportDate: Date | null;
  reviewStatus: string;
  reviewedAt: Date | null;
  rowVersion: number;
}) {
  return {
    id: row.id,
    documentId: row.documentId,
    patientId: row.patientId,
    encounterId: row.encounterId,
    labName: row.labName,
    reportDate: row.reportDate?.toISOString().slice(0, 10) ?? null,
    reviewStatus: row.reviewStatus,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rowVersion: row.rowVersion,
  };
}

@Controller('lab-reports')
export class LabReportController {
  private readonly reports: LabReportService;
  constructor(
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
    @Inject(CLINICAL_SERVICES) private readonly clinical: ClinicalServices,
  ) {
    this.reports = new LabReportService(runtime.prisma, () => runtime.clock.now());
  }

  private async authorizeEncounter(
    actor: ActorContext,
    tenant: TenantContext,
    req: FastifyRequest,
    encounterId: string,
    patientId: string,
  ) {
    const context = await clinicalActor(this.runtime, actor, tenant, req);
    const access = await this.clinical.access.assignedOrScoped(context, encounterId);
    if (access.encounter.patientId !== patientId) throw new AppError('RESOURCE_NOT_FOUND');
    return context;
  }

  private async authorizeReport(
    actor: ActorContext,
    tenant: TenantContext,
    req: FastifyRequest,
    reportId: string,
  ) {
    const report = await this.runtime.prisma.labReport.findFirst({
      where: { tenantId: tenant.tenantId, id: reportId },
    });
    if (!report || !report.encounterId) throw new AppError('RESOURCE_NOT_FOUND');
    const document = await this.runtime.prisma.document.findFirst({
      where: {
        id: report.documentId,
        tenantId: tenant.tenantId,
        category: 'LAB_REPORT',
        status: 'AVAILABLE',
        redactedAt: null,
      },
      select: { patientId: true, encounterId: true },
    });
    if (!document || document.patientId !== report.patientId || document.encounterId !== report.encounterId)
      throw new AppError('RESOURCE_NOT_FOUND');
    const context = await this.authorizeEncounter(actor, tenant, req, report.encounterId, report.patientId);
    return { report, context };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('lab.write')
  @Idempotent()
  async create(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    const parsed = createBody.safeParse(body);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const document = await this.runtime.prisma.document.findFirst({
      where: {
        id: parsed.data.documentId,
        tenantId: tenant.tenantId,
        category: 'LAB_REPORT',
        status: 'AVAILABLE',
        currentRevision: { not: null },
        redactedAt: null,
      },
      select: { patientId: true, encounterId: true },
    });
    if (!document || !document.encounterId) throw new AppError('DOCUMENT_NOT_AVAILABLE');
    await this.authorizeEncounter(actor, tenant, req, document.encounterId, document.patientId);
    const row = await this.reports.create({
      tenantId: tenant.tenantId,
      actorUserId: actor.userId,
      documentId: parsed.data.documentId,
      labName: parsed.data.labName,
      reportDate: parsed.data.reportDate ? new Date(`${parsed.data.reportDate}T00:00:00.000Z`) : null,
    });
    return reportView(row);
  }

  @Get('by-encounter/:encounterId')
  @RequirePermission('document.read')
  async list(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
    @Param('encounterId') encounterId: string,
  ) {
    const context = await clinicalActor(this.runtime, actor, tenant, req);
    const access = await this.clinical.access.assignedOrScoped(context, encounterId);
    const rows = await this.runtime.prisma.labReport.findMany({
      where: { tenantId: tenant.tenantId, encounterId, patientId: access.encounter.patientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    const documents = await this.runtime.prisma.document.findMany({
      where: {
        tenantId: tenant.tenantId,
        id: { in: rows.map((row) => row.documentId) },
        category: 'LAB_REPORT',
        status: 'AVAILABLE',
        redactedAt: null,
        patientId: access.encounter.patientId,
        encounterId,
      },
      select: { id: true },
    });
    const readable = new Set(documents.map((row) => row.id));
    return { items: rows.filter((row) => readable.has(row.documentId)).map(reportView) };
  }

  @Get(':id')
  @RequirePermission('document.read')
  async get(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    const { report } = await this.authorizeReport(actor, tenant, req, id);
    const results = await this.runtime.prisma.labResult.findMany({
      where: { tenantId: tenant.tenantId, labReportId: id, reviewStatus: { not: 'ENTERED_IN_ERROR' } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      ...reportView(report),
      results: results.map((row) => ({
        id: row.id,
        analyteDisplay: row.analyteDisplay,
        valueNumeric: row.valueNumeric?.toString() ?? null,
        valueText: row.valueText,
        unit: row.unit,
        referenceRange: row.referenceRange,
        abnormalFlag: row.abnormalFlag,
        reviewStatus: row.reviewStatus,
      })),
    };
  }

  @Post(':id/results')
  @HttpCode(201)
  @RequirePermission('lab.write')
  @Idempotent()
  async addResult(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = resultBody.safeParse(body);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    await this.authorizeReport(actor, tenant, req, id);
    const row = await this.reports.addResult({
      ...parsed.data,
      tenantId: tenant.tenantId,
      reportId: id,
      actorUserId: actor.userId,
    });
    return { id: row.id, reportId: id, reviewStatus: row.reviewStatus };
  }

  @Post(':id/review')
  @HttpCode(200)
  @RequirePermission('lab.review')
  @Idempotent()
  async review(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = reviewBody.safeParse(body);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const { context } = await this.authorizeReport(actor, tenant, req, id);
    if (!context.doctorProfileId) throw new AppError('FORBIDDEN');
    const row = await this.reports.review({
      tenantId: tenant.tenantId,
      reportId: id,
      actorUserId: actor.userId,
      doctorProfileId: context.doctorProfileId,
      expectedRowVersion: parsed.data.expectedRowVersion,
    });
    return reportView(row);
  }
}
