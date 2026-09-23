import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import {
  EnterEncounterInErrorRequest,
  InterruptEncounterRequest,
  RowVersionOnly,
  StartEncounterRequest,
} from '@hmedic/contracts';
import { Idempotent } from '@hmedic/http-kit';
import { CurrentActor, CurrentTenant, RequirePermission } from '@hmedic/identity-access/nest';
import { CLINICAL_SERVICES, type ClinicalServices } from '@hmedic/clinical/nest';
import type { ClinicalActor, EncounterView } from '@hmedic/clinical';
import type { PrismaClient } from '@hmedic/database';
import { HTTP_RUNTIME, type HttpRuntime } from '@hmedic/http-kit';

class StartEncounterDto extends createZodDto(StartEncounterRequest) {}
class RowVersionOnlyDto extends createZodDto(RowVersionOnly) {}
class InterruptEncounterDto extends createZodDto(InterruptEncounterRequest) {}
class EnterInErrorDto extends createZodDto(EnterEncounterInErrorRequest) {}

/**
 * Encounters (API §3.7, Stage 6 CLIN-002). These replace the ADR-021 interim transitions, which now
 * answer 410.
 *
 * Starting a consultation lives on the serial (`SerialEncounterController` below); everything after it
 * acts on the encounter.
 */
@Controller('encounters')
export class EncounterController {
  constructor(
    @Inject(CLINICAL_SERVICES) private readonly svc: ClinicalServices,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}

  private actor(actor: ActorContext, tenant: TenantContext, req: FastifyRequest): Promise<ClinicalActor> {
    return clinicalActor(this.runtime, actor, tenant, req);
  }

  @Get(':id')
  @RequirePermission('encounter.read')
  async get(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ): Promise<EncounterView> {
    const who = await this.actor(actor, tenant, req);
    // Reading a consultation is a clinical read: the permission says the role may, assignment says this
    // doctor may. Both, or neither.
    const assigned = await this.svc.encounters.assignmentFor(who, id);
    if (!assigned.assigned) throw new AppError('FORBIDDEN');
    return this.svc.encounters.get(who, id);
  }

  @Post(':id/interrupt')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('encounter.manage')
  async interrupt(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: InterruptEncounterDto,
    @Req() req: FastifyRequest,
  ): Promise<EncounterView> {
    return this.svc.encounters.interrupt(await this.actor(actor, tenant, req), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }

  @Post(':id/resume')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('encounter.manage')
  async resume(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RowVersionOnlyDto,
    @Req() req: FastifyRequest,
  ): Promise<EncounterView> {
    return this.svc.encounters.resume(await this.actor(actor, tenant, req), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('encounter.complete')
  async complete(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RowVersionOnlyDto,
    @Req() req: FastifyRequest,
  ): Promise<EncounterView> {
    return this.svc.encounters.complete(await this.actor(actor, tenant, req), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }

  @Post(':id/entered-in-error')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('encounter.manage')
  async enterInError(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EnterInErrorDto,
    @Req() req: FastifyRequest,
  ): Promise<EncounterView> {
    return this.svc.encounters.enterInError(await this.actor(actor, tenant, req), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }
}

/**
 * Starting a consultation hangs off the serial (API §3.7): the command acts on the serial, and the
 * `expectedRowVersion` that guards it is the serial's. Everything afterwards acts on the encounter.
 */
@Controller('serials')
export class SerialEncounterController {
  constructor(
    @Inject(CLINICAL_SERVICES) private readonly svc: ClinicalServices,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}

  @Post(':id/encounter')
  @Idempotent()
  @RequirePermission('encounter.start')
  async start(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) serialId: string,
    @Body() dto: StartEncounterDto,
    @Req() req: FastifyRequest,
  ): Promise<EncounterView> {
    return this.svc.encounters.start(
      await clinicalActor(this.runtime, actor, tenant, req),
      serialId,
      { expectedRowVersion: dto.expectedRowVersion },
      { idempotencyKey: idempotencyKey(req) },
    );
  }
}

/**
 * Every clinical command needs the acting user's doctor profile, because assignment is defined in terms
 * of the doctor, not the user (AUTHORIZATION-MATRIX §3). Staff without one are never assigned, so the
 * services refuse them: the permission alone is not enough.
 */
async function clinicalActor(
  runtime: HttpRuntime,
  actor: ActorContext,
  tenant: TenantContext,
  req: FastifyRequest,
): Promise<ClinicalActor> {
  const prisma = runtime.prisma as PrismaClient;
  const profile = await prisma.doctorProfile.findFirst({
    where: { tenantId: tenant.tenantId, userId: actor.userId, status: 'ACTIVE' },
    select: { id: true },
  });
  return {
    userId: actor.userId,
    tenant,
    doctorProfileId: profile?.id ?? null,
    requestId: req.id,
    correlationId: req.id,
  };
}

function idempotencyKey(req: FastifyRequest): string | null {
  const header = req.headers['idempotency-key'];
  return typeof header === 'string' && header.length > 0 ? header : null;
}
