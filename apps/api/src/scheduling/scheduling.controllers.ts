import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext, TenantContext } from '@hmedic/kernel';
import {
  CreateChamberRequest,
  CreateClinicRequest,
  CreateScheduleRuleRequest,
  EndScheduleRuleRequest,
  UpdateChamberRequest,
  UpdateClinicRequest,
} from '@hmedic/contracts';
import { Idempotent } from '@hmedic/http-kit';
import {
  CurrentActor,
  CurrentTenant,
  OptionalTenant,
  PatientContextRoute,
  RequirePermission,
  RequireTenant,
} from '@hmedic/identity-access/nest';
import { SCHEDULING_SERVICES, type SchedulingServices } from '@hmedic/scheduling/nest';
import { TENANT_ORG_SERVICES, type TenantOrgServices } from '@hmedic/tenant-org/nest';
import type { ChamberView, ScheduleRuleView, SchedulingActor } from '@hmedic/scheduling';
import type { ClinicView } from '@hmedic/tenant-org';
import { z } from 'zod';

class CreateClinicDto extends createZodDto(CreateClinicRequest) {}
class UpdateClinicDto extends createZodDto(UpdateClinicRequest) {}
class CreateChamberDto extends createZodDto(CreateChamberRequest) {}
class UpdateChamberDto extends createZodDto(UpdateChamberRequest) {}
class CreateScheduleRuleDto extends createZodDto(CreateScheduleRuleRequest) {}
class EndScheduleRuleDto extends createZodDto(EndScheduleRuleRequest) {}
class ChamberListQueryDto extends createZodDto(
  z.object({
    clinicId: z.string().uuid().optional(),
    doctorProfileId: z.string().uuid().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }),
) {}

/** Scheduling actor from the request (mirrors `staffActor` in the patient controllers). */
export function schedulingActor(
  actor: ActorContext,
  tenant: TenantContext,
  req: FastifyRequest,
): SchedulingActor {
  return { userId: actor.userId, tenant, requestId: req.id, correlationId: req.id };
}

/** Clinics (API §3.3). */
@Controller('clinics')
export class ClinicController {
  constructor(@Inject(TENANT_ORG_SERVICES) private readonly svc: TenantOrgServices) {}

  @Get()
  @RequirePermission('appointment.read')
  list(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: FastifyRequest,
  ): Promise<ClinicView[]> {
    return this.svc.clinics.list(schedulingActor(actor, tenant, req));
  }

  @Post()
  @Idempotent()
  @RequirePermission('clinic.manage')
  create(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateClinicDto,
    @Req() req: FastifyRequest,
  ): Promise<ClinicView> {
    return this.svc.clinics.create(schedulingActor(actor, tenant, req), dto);
  }

  @Patch(':id')
  @Idempotent()
  @RequirePermission('clinic.manage')
  update(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateClinicDto,
    @Req() req: FastifyRequest,
  ): Promise<ClinicView> {
    return this.svc.clinics.update(schedulingActor(actor, tenant, req), id, dto);
  }
}

/** Chambers and their schedule rules (API §3.5, C-43). */
@Controller('chambers')
export class ChamberController {
  constructor(@Inject(SCHEDULING_SERVICES) private readonly svc: SchedulingServices) {}

  @Get()
  @RequirePermission('appointment.read')
  @PatientContextRoute({ mode: 'or-staff' })
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ChamberListQueryDto,
    @Req() req: FastifyRequest,
    @OptionalTenant() tenant?: TenantContext,
  ): Promise<ChamberView[]> {
    const ctx = req.hm?.patientContext;
    if (ctx) return this.svc.chambers.listPublic(ctx.tenantId, query);
    return this.svc.chambers.list(schedulingActor(actor, tenant!, req), query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('chamber.manage')
  create(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateChamberDto,
    @Req() req: FastifyRequest,
  ): Promise<ChamberView> {
    return this.svc.chambers.create(schedulingActor(actor, tenant, req), dto);
  }

  @Get(':id')
  @RequirePermission('appointment.read')
  @PatientContextRoute({ mode: 'or-staff' })
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
    @OptionalTenant() tenant?: TenantContext,
  ): Promise<ChamberView> {
    const ctx = req.hm?.patientContext;
    if (ctx) return this.svc.chambers.getPublic(ctx.tenantId, id);
    return this.svc.chambers.get(schedulingActor(actor, tenant!, req), id);
  }

  @Patch(':id')
  @Idempotent()
  @RequirePermission('chamber.manage')
  update(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateChamberDto,
    @Req() req: FastifyRequest,
  ): Promise<ChamberView> {
    return this.svc.chambers.update(schedulingActor(actor, tenant, req), id, dto);
  }

  @Get(':id/schedule-rules')
  @RequirePermission('appointment.read')
  listRules(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ): Promise<ScheduleRuleView[]> {
    return this.svc.schedules.list(schedulingActor(actor, tenant, req), id);
  }

  @Post(':id/schedule-rules')
  @Idempotent()
  @RequirePermission('schedule.manage')
  createRule(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateScheduleRuleDto,
    @Req() req: FastifyRequest,
  ): Promise<ScheduleRuleView> {
    return this.svc.schedules.create(schedulingActor(actor, tenant, req), id, dto);
  }
}

/** `POST /schedule-rules/{id}/end` (C-43): rules are ended, never deleted. */
@Controller('schedule-rules')
export class ScheduleRuleController {
  constructor(@Inject(SCHEDULING_SERVICES) private readonly svc: SchedulingServices) {}

  @Post(':id/end')
  @HttpCode(200)
  @Idempotent()
  @RequireTenant()
  @RequirePermission('schedule.manage')
  end(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EndScheduleRuleDto,
    @Req() req: FastifyRequest,
  ): Promise<ScheduleRuleView> {
    return this.svc.schedules.end(schedulingActor(actor, tenant, req), id, dto);
  }
}
