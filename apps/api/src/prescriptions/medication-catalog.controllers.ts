import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext, TenantContext } from '@hmedic/kernel';
import {
  RecordMedicationGateRequest,
  RequestMedicationImportRequest,
  SearchMedicationsQuery,
} from '@hmedic/contracts';
import { Idempotent } from '@hmedic/http-kit';
import { CurrentActor, CurrentTenant, PlatformRoute, RequirePermission } from '@hmedic/identity-access/nest';
import { PRESCRIPTION_SERVICES, type PrescriptionServices } from '@hmedic/prescriptions/nest';
import type {
  CatalogGateStatus,
  ImportStatusView,
  MedicationSearchResult,
  RequestImportResult,
} from '@hmedic/prescriptions';

class RequestMedicationImportDto extends createZodDto(RequestMedicationImportRequest) {}
class RecordMedicationGateDto extends createZodDto(RecordMedicationGateRequest) {}
class SearchMedicationsDto extends createZodDto(SearchMedicationsQuery) {}

/**
 * Medication catalog administration (API §3.8, ADR-020 §3), platform operators only.
 *
 * `medication.import` is a platform permission, not a tenant one: the catalog is shared by every clinic
 * on the installation, so importing it is not something any one tenant's owner gets to decide. The
 * global `AuthGuard` enforces the operator context, the password-plus-OTP session and the permission,
 * and writes a `PLATFORM_REQUEST` audit row for every call that reaches here.
 *
 * The routes queue work and read results; nothing in this controller imports anything itself. An import
 * is minutes of streaming and batched writes, and an HTTP request is the wrong thing to hold open for it.
 */
@Controller('admin/medications')
export class MedicationImportAdminController {
  constructor(@Inject(PRESCRIPTION_SERVICES) private readonly svc: PrescriptionServices) {}

  /**
   * Queues an import of an already-staged dataset.
   *
   * 202, not 201: the answer is "this will happen", and the caller reads
   * `GET /admin/medications/imports/{id}` to find out what did. Idempotent, because a retried request
   * over a flaky connection must not start a second import of the same catalog.
   */
  @Post('imports')
  @HttpCode(202)
  @PlatformRoute('medication.import')
  @Idempotent()
  requestImport(
    @CurrentActor() actor: ActorContext,
    @Body() dto: RequestMedicationImportDto,
    @Req() req: FastifyRequest,
  ): Promise<RequestImportResult> {
    return this.svc.catalogAdmin.requestImport({
      actor: { userId: actor.userId, requestId: req.id },
      datasetVersion: dto.datasetVersion,
      dryRun: dto.dryRun,
      excludeVeterinary: dto.excludeVeterinary,
    });
  }

  @Get('imports')
  @PlatformRoute('medication.import')
  async listImports(@Query('limit') limit?: string): Promise<{ items: ImportStatusView[] }> {
    const items = await this.svc.catalogAdmin.listImports(limit ? Number(limit) : undefined);
    return { items };
  }

  @Get('imports/:id')
  @PlatformRoute('medication.import')
  getImport(@Param('id') id: string): Promise<ImportStatusView> {
    return this.svc.catalogAdmin.getImport(id);
  }

  /**
   * Records one dataset-card gate attestation.
   *
   * Append-only and hash-chained. There is no route to amend or withdraw one, and that absence is the
   * feature: the only reason production can trust four attestations is that nobody can quietly adjust
   * them afterwards. A gate attested in error is answered by moving to a new dataset version, which
   * carries its own gates.
   */
  @Post('gates')
  @HttpCode(201)
  @PlatformRoute('medication.import')
  @Idempotent()
  recordGate(
    @CurrentActor() actor: ActorContext,
    @Body() dto: RecordMedicationGateDto,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; seq: string }> {
    return this.svc.catalogAdmin.recordAttestation({
      actor: { userId: actor.userId, requestId: req.id },
      datasetVersion: dto.datasetVersion,
      gateCode: dto.gateCode,
      evidenceRef: dto.evidenceRef,
      summary: dto.summary,
    });
  }

  @Get('gates/:datasetVersion')
  @PlatformRoute('medication.import')
  gateStatus(@Param('datasetVersion') datasetVersion: string): Promise<CatalogGateStatus> {
    return this.svc.catalogAdmin.gateStatus(datasetVersion);
  }
}

/**
 * The catalog lookup a prescriber uses (API §3.8, ADR-020 §4).
 *
 * Tenant-scoped, because the ordering within each tier uses that tenant's own prescribing history and
 * nobody else's. It reads a shared, read-only catalog: there is no write path here, and `prescription.write`
 * is the permission because searching the catalog is part of writing a prescription and nothing else.
 */
@Controller('medications')
export class MedicationSearchController {
  constructor(@Inject(PRESCRIPTION_SERVICES) private readonly svc: PrescriptionServices) {}

  @Get('search')
  @RequirePermission('prescription.write')
  async search(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: SearchMedicationsDto,
  ): Promise<{ items: MedicationSearchResult[] }> {
    const items = await this.svc.search.search({
      tenantId: tenant.tenantId,
      q: query.q,
      limit: query.limit,
    });
    return { items };
  }
}
