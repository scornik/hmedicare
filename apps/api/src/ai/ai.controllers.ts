import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import {
  ChangeAiCredentialRequest,
  CreateAiCredentialRequest,
  CreateAiJobRequest,
  RecordAiAcknowledgementRequest,
  ReviewAiSuggestionRequest,
  TenantAiPolicyDecision,
} from '@hmedic/contracts';
import { Idempotent, RawResponse } from '@hmedic/http-kit';
import { CurrentActor, CurrentTenant, RequirePermission } from '@hmedic/identity-access/nest';
import {
  type AIAcknowledgementStore,
  type AICredentialStore,
  type AIDraftStore,
  type AIJobStore,
  type AIModelCatalogStore,
  type AIRawOutputReader,
  type AIUsageStore,
  type TenantAIPolicyStore,
  acknowledgementTextSha256,
  currentAcknowledgementTexts,
} from '@hmedic/ai';

class DecidePolicyDto extends createZodDto(TenantAiPolicyDecision) {}
class RecordAcknowledgementDto extends createZodDto(RecordAiAcknowledgementRequest) {}
class CreateCredentialDto extends createZodDto(CreateAiCredentialRequest) {}
class ChangeCredentialDto extends createZodDto(ChangeAiCredentialRequest) {}
class CreateJobDto extends createZodDto(CreateAiJobRequest) {}
class ReviewSuggestionDto extends createZodDto(ReviewAiSuggestionRequest) {}

export const AI_SERVICES = Symbol('AI_SERVICES');

export interface AiServices {
  policy: TenantAIPolicyStore;
  acknowledgements: AIAcknowledgementStore;
  credentials: AICredentialStore;
  models: AIModelCatalogStore;
  jobs: AIJobStore;
  drafts: AIDraftStore;
  usage: AIUsageStore;
  rawOutputs: AIRawOutputReader;
}

/**
 * AI policy, acknowledgements and credentials (AICRED-003, AIPOL-001/002, ADR-017).
 *
 * The routes are thin on purpose: each store re-resolves the live membership and permissions inside its
 * own transaction, so authorization is decided where the write happens rather than here. A guard that
 * passed and a transaction that then trusted it would leave a window in which a revoked role still
 * acted.
 *
 * `null` services mean this deployment has no AI encryption configured. Every route then answers
 * `FEATURE_DISABLED` rather than failing deeper, so a client can tell "not available here" from
 * "refused".
 */
@Controller()
export class AiController {
  constructor(@Inject(AI_SERVICES) private readonly services: AiServices | null) {}

  private svc(): AiServices {
    if (!this.services) throw new AppError('FEATURE_DISABLED');
    return this.services;
  }

  private actor(actor: ActorContext, tenant: TenantContext, req: FastifyRequest) {
    return { tenantId: tenant.tenantId, userId: actor.userId, requestId: req.id };
  }

  @Get('tenant/ai-policy')
  @RequirePermission('ai.policy.read')
  getPolicy(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
  ) {
    return this.svc().policy.get(this.actor(actor, tenant, req));
  }

  @Put('tenant/ai-policy')
  @HttpCode(200)
  @RequirePermission('ai.policy.manage')
  @Idempotent('optional')
  decidePolicy(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: DecidePolicyDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc().policy.decide(this.actor(actor, tenant, req), dto);
  }

  @Get('tenant/ai-policy/events')
  @RequirePermission('ai.policy.read')
  listPolicyEvents(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
    @Query('limit') limit?: string,
  ) {
    return this.svc()
      .policy.events(this.actor(actor, tenant, req), limit ? Number(limit) : undefined)
      .then((items) => ({ items }));
  }

  /**
   * Live models (ADAPT-002).
   *
   * Deprecated rows are omitted by the store, so a picker cannot offer a model the provider has
   * withdrawn — offering one would be offering a call that is going to be refused. The catalog is
   * global and carries no patient data, so `ai.use` is the right gate: a doctor choosing a model
   * needs to see the list.
   */
  @Get('ai/models')
  @RequirePermission('ai.use')
  listModels(@Query('providerCode') providerCode?: string) {
    return this.svc()
      .models.list(providerCode)
      .then((items) => ({
        items: items.map(({ deprecatedAt: _deprecatedAt, ...model }) => model),
      }));
  }

  /**
   * The texts in force, with their hashes.
   *
   * Readable by anyone who may hold a credential: a doctor has to be shown the words before agreeing,
   * and the hash lets a screen prove it displayed the same text the acknowledgement will record.
   */
  @Get('ai/acknowledgement-texts')
  @RequirePermission('ai.use')
  listAcknowledgementTexts() {
    this.svc();
    return {
      items: currentAcknowledgementTexts().map((text) => ({
        ...text,
        sha256: acknowledgementTextSha256(text.body),
      })),
    };
  }

  @Post('ai/acknowledgements')
  @HttpCode(201)
  @RequirePermission('ai.use')
  @Idempotent()
  recordAcknowledgement(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: RecordAcknowledgementDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc().acknowledgements.record(this.actor(actor, tenant, req), dto);
  }

  @Get('doctors/:id/ai/acknowledgements')
  @RequirePermission('ai.use')
  listAcknowledgements(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) doctorProfileId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc()
      .acknowledgements.list(this.actor(actor, tenant, req), doctorProfileId)
      .then((items) => ({ items }));
  }

  @Post('ai/acknowledgements/:id/withdraw')
  @HttpCode(200)
  @RequirePermission('ai.use')
  @Idempotent()
  withdrawAcknowledgement(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc().acknowledgements.withdraw(this.actor(actor, tenant, req), id);
  }

  @Get('doctors/:id/ai/credentials')
  @RequirePermission('ai.use')
  listCredentials(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) doctorProfileId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc()
      .credentials.list(this.actor(actor, tenant, req), doctorProfileId)
      .then((items) => ({ items }));
  }

  @Get('me/ai/credentials')
  @RequirePermission('ai.use')
  listOwnCredentials(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
  ) {
    return this.svc()
      .credentials.listMine(this.actor(actor, tenant, req))
      .then((items) => ({ items }));
  }

  @Post('doctors/:id/ai/credentials')
  @HttpCode(201)
  @RequirePermission('ai.use')
  @Idempotent()
  createCredential(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) doctorProfileId: string,
    @Body() dto: CreateCredentialDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc().credentials.create(this.actor(actor, tenant, req), doctorProfileId, dto);
  }

  /**
   * Under the doctor, not under the credential alone.
   *
   * The store authorizes against the doctor profile, so the path carries it rather than the controller
   * reading the credential first to find out who it belongs to — which would be a read decided before
   * anything had checked whether the caller may make it.
   */
  /**
   * Queues a draft job (AI-001).
   *
   * The response is the job, not the draft. The work runs in the worker, so a request never waits on
   * a vendor and a client that times out has not lost the job.
   */
  @Post('encounters/:id/ai/note-draft')
  @HttpCode(201)
  @RequirePermission('ai.use')
  @Idempotent()
  createNoteDraftJob(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) encounterId: string,
    @Body() dto: CreateJobDto,
    @Req() req: FastifyRequest,
  ) {
    return this.createJob(actor, tenant, encounterId, 'note-draft', dto, req);
  }

  @Get('encounters/:id/ai/jobs')
  @RequirePermission('ai.use')
  listEncounterJobs(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc()
      .jobs.listForEncounter(this.actor(actor, tenant, req), id)
      .then((items) => ({ items }));
  }

  @Post('encounters/:id/ai/history-summary')
  @HttpCode(201)
  @RequirePermission('ai.use')
  @Idempotent()
  createHistorySummaryJob(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) encounterId: string,
    @Body() dto: CreateJobDto,
    @Req() req: FastifyRequest,
  ) {
    return this.createJob(actor, tenant, encounterId, 'history-summary', dto, req);
  }

  /**
   * Transcription, which always refuses in MVP.
   *
   * The route exists so a client can tell "not built yet" from "not permitted". Transcription would
   * send raw audio, and identifiers cannot be reliably removed from it (ADR-017 §3), so this is a
   * feature gate rather than a stub waiting to be filled in quietly.
   */
  @Post('encounters/:id/ai/transcription')
  @HttpCode(409)
  @RequirePermission('ai.use')
  createTranscriptionJob() {
    this.svc();
    throw new AppError('FEATURE_DISABLED');
  }

  private createJob(
    actor: ActorContext,
    tenant: TenantContext,
    encounterId: string,
    purpose: 'note-draft' | 'history-summary',
    dto: CreateJobDto,
    req: FastifyRequest,
  ) {
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      // The decorator already requires it; this keeps the store's uniqueness guarantee honest rather
      // than inventing a key here that a retry would not repeat.
      throw new AppError('VALIDATION_FAILED');
    }
    return this.svc().jobs.create(this.actor(actor, tenant, req), {
      encounterId,
      purpose,
      ...(dto.credentialId ? { credentialId: dto.credentialId } : {}),
      ...(dto.modelId ? { modelId: dto.modelId } : {}),
      sourceSelection: dto.sourceSelection,
      ...(dto.templateVersion ? { templateVersion: dto.templateVersion } : {}),
      idempotencyKey,
    });
  }

  @Get('ai/jobs/:id')
  @RequirePermission('ai.use')
  getJob(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc().jobs.get(this.actor(actor, tenant, req), id);
  }

  @Post('ai/jobs/:id/cancel')
  @HttpCode(200)
  @RequirePermission('ai.use')
  @Idempotent('optional')
  cancelJob(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc().jobs.cancel(this.actor(actor, tenant, req), id);
  }

  /**
   * Draft review (AI-002).
   *
   * Reading and deciding, and nothing else: no route here writes a clinical record. The one that does
   * is the approval, which carries a doctor's attestation and lives with the clinical write it makes.
   */
  /**
   * Usage for a doctor's credentials (AICRED-005).
   *
   * Gated by `ai.use` at the route and by ownership inside the store: a doctor reads their own, and
   * anyone else needs `ai.usage.read`. Doing the second half in the store keeps it in the transaction
   * that resolves the live membership.
   */
  @Get('doctors/:doctorId/ai/usage')
  @RequirePermission('ai.use')
  getUsage(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('doctorId', new ParseUUIDPipe()) doctorProfileId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc()
      .usage.forDoctor(this.actor(actor, tenant, req), doctorProfileId)
      .then((items) => ({ items }));
  }

  @Get('ai/drafts/:id')
  @RequirePermission('ai.review')
  getDraft(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc().drafts.get(this.actor(actor, tenant, req), id);
  }

  @Post('ai/drafts/:id/open')
  @HttpCode(200)
  @RequirePermission('ai.review')
  @Idempotent('optional')
  openDraft(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc().drafts.open(this.actor(actor, tenant, req), id);
  }

  @Post('ai/drafts/:id/close')
  @HttpCode(200)
  @RequirePermission('ai.review')
  @Idempotent('optional')
  closeDraft(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc().drafts.close(this.actor(actor, tenant, req), id);
  }

  @Post('ai/suggestions/:id/review')
  @HttpCode(200)
  @RequirePermission('ai.review')
  @Idempotent('optional')
  reviewSuggestion(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewSuggestionDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc().drafts.review(this.actor(actor, tenant, req), id, {
      decision: dto.decision,
      ...(dto.editedCandidate !== undefined ? { editedCandidate: dto.editedCandidate } : {}),
      expectedRowVersion: dto.expectedRowVersion,
    });
  }

  /**
   * The bytes that were actually sent and received (`ai.audit.raw_read`).
   *
   * `@RawResponse()` because the body is the stored object, not an envelope describing it. Audited in
   * the store before anything is opened, and explicitly not a clinical record: the response is the
   * model's unvalidated output, and everything a doctor may act on is in the draft.
   */
  @Get('ai/raw-outputs/:jobId')
  @RawResponse()
  @RequirePermission('ai.audit.raw_read')
  async readRawOutput(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const object = await this.svc().rawOutputs.open(this.actor(actor, tenant, req), jobId);
    reply
      .header('Content-Type', 'application/json')
      // `attachment`, so a browser cannot render provider output inside this origin.
      .header('Content-Disposition', `attachment; filename="ai-raw-${jobId}.json"`)
      .header('Content-Length', String(object.sizeBytes))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .header(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox",
      );
    await reply.send(object.stream);
  }

  @Post('doctors/:doctorId/ai/credentials/:id/actions')
  @HttpCode(200)
  @RequirePermission('ai.use')
  @Idempotent()
  changeCredential(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('doctorId', new ParseUUIDPipe()) doctorProfileId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ChangeCredentialDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc().credentials.change(
      this.actor(actor, tenant, req),
      doctorProfileId,
      id,
      dto.expectedRowVersion,
      dto.action,
    );
  }
}
