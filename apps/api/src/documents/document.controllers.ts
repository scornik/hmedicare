import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import { HTTP_RUNTIME, Idempotent, RawResponse, type HttpRuntime } from '@hmedic/http-kit';
import { CurrentActor, CurrentTenant, RequirePermission } from '@hmedic/identity-access/nest';
import { CurrentPatientContext, OptionalTenant, PatientContextRoute } from '@hmedic/identity-access/nest';
import type { ResolvedPatientContext } from '@hmedic/identity-access';
import { CLINICAL_SERVICES, type ClinicalServices } from '@hmedic/clinical/nest';
import { DOCUMENT_SERVICES, type DocumentServices } from '@hmedic/laboratory-documents/nest';
import {
  UploadSessionService,
  UploadStorageError,
  abortUploadRecord,
  finalizeUpload,
  type UploadPatientScope,
} from '@hmedic/laboratory-documents';
import { z } from 'zod';
import { clinicalActor } from '../clinical/actor';

const uploadRequest = z
  .object({
    patientId: z.string().uuid(),
    encounterId: z.string().uuid(),
    category: z.string(),
    contentType: z.string(),
    sizeBytes: z.number().int(),
    sha256: z.string(),
    fileName: z.string().optional(),
  })
  .strict();

function uploadError(error: unknown): never {
  if (error instanceof UploadStorageError) {
    const code = (
      {
        UPLOAD_INVALID: 'VALIDATION_FAILED',
        UPLOAD_NOT_FOUND: 'RESOURCE_NOT_FOUND',
        UPLOAD_EXPIRED: 'UPLOAD_EXPIRED',
        UPLOAD_CONFLICT: 'INVALID_TRANSITION',
        UPLOAD_PARTS_INVALID: 'VALIDATION_FAILED',
        UPLOAD_CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
        UPLOAD_IO_FAILED: 'PROVIDER_UNAVAILABLE',
      } as const
    )[error.code];
    throw new AppError(code);
  }
  throw error;
}

/**
 * Stored documents (API §3.8, FILE-STORAGE-IMPLEMENTATION.md §2.5).
 *
 * Authorization lives here rather than in the documents context, because "may this actor read this
 * file" is a clinical question — is the doctor assigned to the encounter, or scoped to its chamber —
 * and the documents context should not have to know how that is answered.
 *
 * It is checked twice on purpose: when the token is issued, and again when it is redeemed. A coverage
 * grant can lapse in the sixty seconds in between, and the second check is what stops a token outliving
 * the access it was based on.
 */
@Controller('documents')
export class DocumentController {
  constructor(
    @Inject(DOCUMENT_SERVICES) private readonly documents: DocumentServices,
    @Inject(CLINICAL_SERVICES) private readonly clinical: ClinicalServices,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}

  private async authorizeUploadScope(
    actor: ActorContext,
    tenant: TenantContext,
    req: FastifyRequest,
    scope: UploadPatientScope,
  ): Promise<void> {
    if (scope.tenantId !== tenant.tenantId || !scope.encounterId) throw new AppError('RESOURCE_NOT_FOUND');
    const context = await clinicalActor(this.runtime, actor, tenant, req);
    const access = await this.clinical.access.assignedOrScoped(context, scope.encounterId);
    if (access.encounter.patientId !== scope.patientId) throw new AppError('RESOURCE_NOT_FOUND');
  }

  private async authorizeUploadSession(
    actor: ActorContext,
    tenant: TenantContext,
    req: FastifyRequest,
    sessionId: string,
  ) {
    const session = await this.runtime.prisma.uploadSession.findFirst({
      where: { id: sessionId, tenantId: tenant.tenantId, ownerUserId: actor.userId },
    });
    if (!session) throw new AppError('RESOURCE_NOT_FOUND');
    const document = await this.runtime.prisma.document.findFirst({
      where: { id: session.documentId, tenantId: tenant.tenantId },
      select: { patientId: true, encounterId: true, category: true },
    });
    if (!document) throw new AppError('RESOURCE_NOT_FOUND');
    await this.authorizeUploadScope(actor, tenant, req, {
      tenantId: tenant.tenantId,
      patientId: document.patientId,
      encounterId: document.encounterId,
      category: document.category,
    });
  }

  @Get('upload-capability')
  @RequirePermission('document.write')
  uploadCapability() {
    return { enabled: this.runtime.config.UPLOAD_SCAN_WORKER_ENABLED };
  }

  @Post('upload-sessions')
  @HttpCode(201)
  @RequirePermission('document.write')
  @Idempotent()
  async createUpload(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    if (!this.runtime.config.UPLOAD_SCAN_WORKER_ENABLED) throw new AppError('FEATURE_DISABLED');
    const parsed = uploadRequest.safeParse(body);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const input = { ...parsed.data, tenantId: tenant.tenantId, ownerUserId: actor.userId };
    const service = new UploadSessionService(
      this.runtime.prisma,
      this.documents.uploadStorage,
      async (candidate) => {
        await this.authorizeUploadScope(actor, tenant, req, {
          tenantId: candidate.tenantId,
          patientId: candidate.patientId,
          encounterId: candidate.encounterId ?? null,
          category: candidate.category,
        });
        return 'CLINICAL_TEAM';
      },
      () => this.runtime.clock.now(),
    );
    try {
      const result = await service.create(input);
      return { ...result, expiresAt: result.expiresAt.toISOString() };
    } catch (error) {
      uploadError(error);
    }
  }

  @Put('upload-sessions/:sessionId/parts/:partNumber')
  @RequirePermission('document.write')
  async uploadPart(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
    @Param('sessionId') sessionId: string,
    @Param('partNumber') rawPartNumber: string,
    @Body() body: unknown,
  ) {
    const partNumber = Number(rawPartNumber);
    if (!Number.isSafeInteger(partNumber) || partNumber < 1 || !Buffer.isBuffer(body))
      throw new AppError('VALIDATION_FAILED');
    const checksum = req.headers['x-part-sha256'];
    if (typeof checksum !== 'string') throw new AppError('VALIDATION_FAILED');
    const service = new UploadSessionService(
      this.runtime.prisma,
      this.documents.uploadStorage,
      async () => 'CLINICAL_TEAM',
      () => this.runtime.clock.now(),
    );
    try {
      return await service.uploadPart(
        { tenantId: tenant.tenantId, sessionId, ownerUserId: actor.userId },
        partNumber,
        body,
        checksum,
        (scope) => this.authorizeUploadScope(actor, tenant, req, scope),
      );
    } catch (error) {
      uploadError(error);
    }
  }

  @Post('upload-sessions/:sessionId/finalize')
  @RequirePermission('document.write')
  @Idempotent()
  async finalizeUpload(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
    @Param('sessionId') sessionId: string,
  ) {
    const authorize = () => this.authorizeUploadSession(actor, tenant, req, sessionId);
    try {
      return await finalizeUpload(
        this.runtime.prisma,
        this.documents.uploadStorage,
        this.documents.uploadJobs,
        { tenantId: tenant.tenantId, sessionId, ownerUserId: actor.userId },
        authorize,
        this.runtime.clock.now(),
      );
    } catch (error) {
      uploadError(error);
    }
  }

  @Post('upload-sessions/:sessionId/abort')
  @RequirePermission('document.write')
  @Idempotent()
  async abortUpload(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
    @Param('sessionId') sessionId: string,
  ) {
    await this.authorizeUploadSession(actor, tenant, req, sessionId);
    try {
      await abortUploadRecord(
        this.runtime.prisma,
        this.documents.uploadStorage,
        { tenantId: tenant.tenantId, sessionId, ownerUserId: actor.userId },
        this.runtime.clock.now(),
      );
      return { sessionId, status: 'ABORTED' };
    } catch (error) {
      uploadError(error);
    }
  }

  /**
   * Resolves the document and proves this actor may read it.
   *
   * A document with no encounter cannot be authorized by this route at all. Rather than guess at a
   * weaker rule, it answers not-found: every document this stage produces carries its encounter, and a
   * category that does not will arrive with the route that knows how to authorize it.
   */
  private async authorize(
    actor: ActorContext,
    tenant: TenantContext | undefined,
    req: FastifyRequest,
    documentId: string,
    patientContext?: ResolvedPatientContext,
  ) {
    const tenantId = patientContext?.tenantId ?? tenant?.tenantId;
    if (!tenantId) throw new AppError('TENANT_CONTEXT_REQUIRED');
    if (patientContext) {
      const shared = await this.runtime.prisma.document.findFirst({
        where: {
          id: documentId,
          tenantId,
          patientId: patientContext.patientId,
          accessPolicy: 'PATIENT_SHARED',
          status: 'AVAILABLE',
          currentRevision: { not: null },
          redactedAt: null,
          encounterId: { not: null },
        },
        select: { category: true, encounterId: true },
      });
      if (!shared) throw new AppError('RESOURCE_NOT_FOUND');
      if (shared.category === 'LAB_REPORT') {
        const reviewed = await this.runtime.prisma.labReport.findFirst({
          where: {
            tenantId,
            patientId: patientContext.patientId,
            encounterId: shared.encounterId,
            documentId,
            reviewStatus: 'REVIEWED',
          },
          select: { id: true },
        });
        if (!reviewed) throw new AppError('RESOURCE_NOT_FOUND');
      }
    }
    const document = await this.documents.downloads.describe(tenantId, documentId);
    if (!document) throw new AppError('RESOURCE_NOT_FOUND');
    if (document.accessPolicy === 'AUDIT_ONLY') throw new AppError('RESOURCE_NOT_FOUND');
    if (!document.encounterId) throw new AppError('RESOURCE_NOT_FOUND');
    if (patientContext) {
      if (document.patientId !== patientContext.patientId || document.accessPolicy !== 'PATIENT_SHARED')
        throw new AppError('RESOURCE_NOT_FOUND');
      return document;
    }
    if (!tenant) throw new AppError('TENANT_CONTEXT_REQUIRED');
    const clinicalActorContext = await clinicalActor(this.runtime, actor, tenant, req);
    const access = await this.clinical.access.assignedOrScoped(clinicalActorContext, document.encounterId);
    // The two foreign keys prove that the patient and encounter exist in this tenant, but they do not
    // prove the document belongs to that encounter's patient. Do not serve a mismatched row.
    if (access.encounter.patientId !== document.patientId) throw new AppError('RESOURCE_NOT_FOUND');
    return document;
  }

  @Get('by-encounter/:encounterId')
  @RequirePermission('document.read')
  async listForEncounter(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('encounterId') encounterId: string,
    @Query('page') rawPage: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    const page = rawPage === undefined ? 1 : Number(rawPage);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new AppError('VALIDATION_FAILED');
    const clinicalActorContext = await clinicalActor(this.runtime, actor, tenant, req);
    const access = await this.clinical.access.assignedOrScoped(clinicalActorContext, encounterId);
    const rows = await this.runtime.prisma.document.findMany({
      where: {
        tenantId: tenant.tenantId,
        encounterId,
        patientId: access.encounter.patientId,
        status: 'AVAILABLE',
        currentRevision: { not: null },
        accessPolicy: { not: 'AUDIT_ONLY' },
        redactedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * 25,
      take: 26,
      select: { id: true, category: true, title: true, createdAt: true },
    });
    return {
      items: rows.slice(0, 25).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      page,
      hasMore: rows.length > 25,
    };
  }

  @Get(':id')
  @RequirePermission('document.read')
  async getMetadata(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') documentId: string,
    @Req() req: FastifyRequest,
  ) {
    const document = await this.runtime.prisma.document.findFirst({
      where: { id: documentId, tenantId: tenant.tenantId },
      select: {
        id: true,
        patientId: true,
        encounterId: true,
        category: true,
        title: true,
        status: true,
        currentRevision: true,
        accessPolicy: true,
        redactedAt: true,
      },
    });
    if (!document || document.redactedAt || document.accessPolicy === 'AUDIT_ONLY' || !document.encounterId)
      throw new AppError('RESOURCE_NOT_FOUND');
    const context = await clinicalActor(this.runtime, actor, tenant, req);
    const access = await this.clinical.access.assignedOrScoped(context, document.encounterId);
    if (access.encounter.patientId !== document.patientId) throw new AppError('RESOURCE_NOT_FOUND');
    return {
      id: document.id,
      category: document.category,
      title: document.title,
      status: document.status,
      currentRevision: document.currentRevision,
    };
  }

  @Post(':id/download-token')
  @HttpCode(201)
  @RequirePermission('document.read')
  @PatientContextRoute({ mode: 'or-staff', scope: 'VIEW_RECORDS' })
  @Idempotent()
  async createDownloadToken(
    @CurrentActor() actor: ActorContext,
    @OptionalTenant() tenant: TenantContext | undefined,
    @Param('id') documentId: string,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() patientContext?: ResolvedPatientContext,
  ): Promise<{ token: string; expiresAt: string; revision: number }> {
    await this.authorize(actor, tenant, req, documentId, patientContext);
    const issued = await this.documents.downloads.issueToken(
      patientContext?.tenantId ?? tenant!.tenantId,
      actor.userId,
      documentId,
    );
    return {
      token: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
      revision: issued.revision,
    };
  }

  /**
   * `@RawResponse()` because the body is the file, not an envelope: `{data, meta}` around a byte stream
   * would be a JSON document describing one.
   */
  @Get(':id/download')
  @RawResponse()
  @RequirePermission('document.read')
  @PatientContextRoute({ mode: 'or-staff', scope: 'VIEW_RECORDS' })
  async download(
    @CurrentActor() actor: ActorContext,
    @OptionalTenant() tenant: TenantContext | undefined,
    @Param('id') documentId: string,
    @Query('token') token: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentPatientContext() patientContext?: ResolvedPatientContext,
  ): Promise<void> {
    const document = await this.authorize(actor, tenant, req, documentId, patientContext);
    const { stream } = await this.documents.downloads.open({
      tenantId: patientContext?.tenantId ?? tenant!.tenantId,
      actorUserId: actor.userId,
      documentId,
      token: token ?? '',
    });

    // `attachment`, never `inline`: a clinical PDF rendered inside the application's own origin would
    // run with its privileges, and `sandbox` plus `nosniff` close the rest of that door.
    reply
      .header('Content-Type', document.contentType)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`)
      .header('Content-Length', String(document.sizeBytes))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      // The global policy plus `sandbox`: strictly stronger, never weaker. `sandbox` is what stops a
      // downloaded document from acting as a document in this origin, which `default-src 'none'` alone
      // does not cover.
      .header(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox",
      );
    // Sent through the reply rather than returned: Fastify pipes a stream, while returning one leaves
    // Nest to serialize it.
    await reply.send(stream);
  }
}
