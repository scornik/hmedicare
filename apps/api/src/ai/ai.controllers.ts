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
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import {
  ChangeAiCredentialRequest,
  CreateAiCredentialRequest,
  RecordAiAcknowledgementRequest,
  TenantAiPolicyDecision,
} from '@hmedic/contracts';
import { Idempotent } from '@hmedic/http-kit';
import { CurrentActor, CurrentTenant, RequirePermission } from '@hmedic/identity-access/nest';
import {
  type AIAcknowledgementStore,
  type AICredentialStore,
  type TenantAIPolicyStore,
  acknowledgementTextSha256,
  currentAcknowledgementTexts,
} from '@hmedic/ai';

class DecidePolicyDto extends createZodDto(TenantAiPolicyDecision) {}
class RecordAcknowledgementDto extends createZodDto(RecordAiAcknowledgementRequest) {}
class CreateCredentialDto extends createZodDto(CreateAiCredentialRequest) {}
class ChangeCredentialDto extends createZodDto(ChangeAiCredentialRequest) {}

export const AI_SERVICES = Symbol('AI_SERVICES');

export interface AiServices {
  policy: TenantAIPolicyStore;
  acknowledgements: AIAcknowledgementStore;
  credentials: AICredentialStore;
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
