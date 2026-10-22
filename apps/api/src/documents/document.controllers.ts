import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import { HTTP_RUNTIME, Idempotent, RawResponse, type HttpRuntime } from '@hmedic/http-kit';
import { CurrentActor, CurrentTenant, RequirePermission } from '@hmedic/identity-access/nest';
import { CLINICAL_SERVICES, type ClinicalServices } from '@hmedic/clinical/nest';
import { DOCUMENT_SERVICES, type DocumentServices } from '@hmedic/laboratory-documents/nest';
import { clinicalActor } from '../clinical/actor';

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

  /**
   * Resolves the document and proves this actor may read it.
   *
   * A document with no encounter cannot be authorized by this route at all. Rather than guess at a
   * weaker rule, it answers not-found: every document this stage produces carries its encounter, and a
   * category that does not will arrive with the route that knows how to authorize it.
   */
  private async authorize(
    actor: ActorContext,
    tenant: TenantContext,
    req: FastifyRequest,
    documentId: string,
  ) {
    const document = await this.documents.downloads.describe(tenant.tenantId, documentId);
    if (!document) throw new AppError('RESOURCE_NOT_FOUND');
    if (document.accessPolicy === 'AUDIT_ONLY') throw new AppError('RESOURCE_NOT_FOUND');
    if (!document.encounterId) throw new AppError('RESOURCE_NOT_FOUND');
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

  @Post(':id/download-token')
  @HttpCode(201)
  @RequirePermission('document.read')
  @Idempotent()
  async createDownloadToken(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') documentId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ token: string; expiresAt: string; revision: number }> {
    await this.authorize(actor, tenant, req, documentId);
    const issued = await this.documents.downloads.issueToken(tenant.tenantId, actor.userId, documentId);
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
  async download(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') documentId: string,
    @Query('token') token: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const document = await this.authorize(actor, tenant, req, documentId);
    const { stream } = await this.documents.downloads.open({
      tenantId: tenant.tenantId,
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
