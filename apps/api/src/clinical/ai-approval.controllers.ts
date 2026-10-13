import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext, TenantContext } from '@hmedic/kernel';
import { ApproveAiSuggestionRequest } from '@hmedic/contracts';
import { HTTP_RUNTIME, type HttpRuntime, Idempotent } from '@hmedic/http-kit';
import { CurrentActor, CurrentTenant, RequirePermission } from '@hmedic/identity-access/nest';
import { CLINICAL_SERVICES, type ClinicalServices } from '@hmedic/clinical/nest';
import { clinicalActor } from './actor';

class ApproveSuggestionDto extends createZodDto(ApproveAiSuggestionRequest) {}

/**
 * Approving an AI suggestion into the chart (AI-003).
 *
 * Deliberately a clinical controller rather than an AI one. The route writes a clinical record, so it
 * is wired to `ClinicalServices` and lives beside the note and diagnosis routes — which is also what
 * keeps the AI controller free of any path that can reach a clinical write.
 *
 * `ai.approve` is doctor-only in the authorization matrix, and the service additionally requires the
 * doctor to be assigned to the encounter. A nurse holding `ai.review` can read a draft and decide
 * nothing into a record.
 */
@Controller('ai/suggestions')
export class AiApprovalController {
  constructor(
    @Inject(CLINICAL_SERVICES) private readonly svc: ClinicalServices,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}

  @Post(':id/approve')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission('ai.approve')
  async approve(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveSuggestionDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.aiApprovals.approve(await clinicalActor(this.runtime, actor, tenant, req), id, {
      approvedTarget: dto.approvedTarget,
      expectedRowVersion: dto.expectedRowVersion,
      attestationVersion: dto.attestationVersion,
      ...(dto.noteSection ? { noteSection: dto.noteSection } : {}),
      ...(dto.diagnosis ? { diagnosis: dto.diagnosis } : {}),
    });
  }
}
