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
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import {
  CreateMergeCaseRequest,
  CreatePatientRequest,
  DuplicateCheckRequest,
  GrantConsentRequest,
  ReviewMergeCaseRequest,
  UpdatePatientRequest,
  WithdrawConsentRequest,
} from '@hmedic/contracts';
import { Idempotent, RateLimit } from '@hmedic/http-kit';
import {
  CurrentActor,
  CurrentPatientContext,
  CurrentTenant,
  OptionalTenant,
  PatientContextRoute,
  RequirePermission,
} from '@hmedic/identity-access/nest';
import type { ResolvedPatientContext } from '@hmedic/identity-access';
import type { DuplicateCheckResult, PatientActor, PatientContextActor, SearchResult } from '@hmedic/patient';
import { PATIENT_SERVICES, type PatientServices } from '@hmedic/patient/nest';
import { z } from 'zod';

class CreatePatientDto extends createZodDto(CreatePatientRequest) {}
class UpdatePatientDto extends createZodDto(UpdatePatientRequest) {}
class DuplicateCheckDto extends createZodDto(DuplicateCheckRequest) {}
class CreateMergeCaseDto extends createZodDto(CreateMergeCaseRequest) {}
class ReviewMergeCaseDto extends createZodDto(ReviewMergeCaseRequest) {}
class GrantConsentDto extends createZodDto(GrantConsentRequest) {}
class WithdrawConsentDto extends createZodDto(WithdrawConsentRequest) {}
class SearchQueryDto extends createZodDto(
  z.object({
    query: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().min(6).max(24).optional(),
    mrn: z.string().trim().min(4).max(32).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
) {}
class MergeListQueryDto extends createZodDto(
  z.object({
    status: z.enum(['OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED']).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
) {}

export function staffActor(actor: ActorContext, tenant: TenantContext, req: FastifyRequest): PatientActor {
  return { userId: actor.userId, tenant, requestId: req.id, correlationId: req.id };
}

export function contextActor(ctx: ResolvedPatientContext, req: FastifyRequest): PatientContextActor {
  return { ...ctx, requestId: req.id, correlationId: req.id };
}

/** Patients (API §3.4): search/create/read/update, duplicate check, merge cases, consents. */
@Controller('patients')
export class PatientController {
  constructor(@Inject(PATIENT_SERVICES) private readonly svc: PatientServices) {}

  @Get()
  @RequirePermission('patient.read')
  @RateLimit({ rule: { scope: 'patient_search:ip', limit: 120, windowSeconds: 60 }, by: 'ip' })
  search(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: SearchQueryDto,
    @Req() req: FastifyRequest,
  ): Promise<SearchResult> {
    return this.svc.patients.search(staffActor(actor, tenant, req), q);
  }

  @Post()
  @RequirePermission('patient.write')
  @Idempotent()
  create(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreatePatientDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.patients.create(staffActor(actor, tenant, req), dto);
  }

  @Post('duplicate-check')
  @HttpCode(200)
  @RequirePermission('patient.write')
  duplicateCheck(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: DuplicateCheckDto,
    @Req() req: FastifyRequest,
  ): Promise<DuplicateCheckResult> {
    return this.svc.patients.duplicateCheck(staffActor(actor, tenant, req), dto);
  }

  @Get(':id')
  @RequirePermission('patient.read')
  @PatientContextRoute({ mode: 'or-staff', scope: 'VIEW_RECORDS' })
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ) {
    if (ctx) return this.svc.patients.getForContext(contextActor(ctx, req), id);
    if (!tenant) throw new AppError('TENANT_CONTEXT_REQUIRED');
    return this.svc.patients.get(staffActor(actor, tenant, req), id);
  }

  @Patch(':id')
  @RequirePermission('patient.write')
  @Idempotent('optional')
  update(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePatientDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.patients.update(staffActor(actor, tenant, req), id, dto);
  }

  @Post(':id/merge-cases')
  @RequirePermission('patient.merge')
  @Idempotent()
  openMerge(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateMergeCaseDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.merges.open(staffActor(actor, tenant, req), id, dto);
  }

  @Get(':id/consents')
  @RequirePermission('patient.read')
  @PatientContextRoute({ mode: 'or-staff', scope: 'VIEW_RECORDS' })
  consents(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ) {
    if (ctx) return this.svc.consents.list({ kind: 'context', actor: contextActor(ctx, req) }, id);
    if (!tenant) throw new AppError('TENANT_CONTEXT_REQUIRED');
    return this.svc.consents.list({ kind: 'staff', actor: staffActor(actor, tenant, req) }, id);
  }

  @Post(':id/consents')
  @RequirePermission('patient.write')
  @PatientContextRoute({ mode: 'or-staff', scope: 'GIVE_CONSENT' })
  @Idempotent()
  grantConsent(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GrantConsentDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ) {
    if (ctx) return this.svc.consents.grant({ kind: 'context', actor: contextActor(ctx, req) }, id, dto);
    if (!tenant) throw new AppError('TENANT_CONTEXT_REQUIRED');
    return this.svc.consents.grant({ kind: 'staff', actor: staffActor(actor, tenant, req) }, id, dto);
  }
}

@Controller('consents')
export class ConsentController {
  constructor(@Inject(PATIENT_SERVICES) private readonly svc: PatientServices) {}

  @Post(':id/withdraw')
  @HttpCode(200)
  @RequirePermission('patient.write')
  @PatientContextRoute({ mode: 'or-staff', scope: 'GIVE_CONSENT' })
  @Idempotent()
  withdraw(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: WithdrawConsentDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ) {
    if (ctx)
      return this.svc.consents.withdraw(
        { kind: 'context', actor: contextActor(ctx, req) },
        id,
        dto.expectedRowVersion,
      );
    if (!tenant) throw new AppError('TENANT_CONTEXT_REQUIRED');
    return this.svc.consents.withdraw(
      { kind: 'staff', actor: staffActor(actor, tenant, req) },
      id,
      dto.expectedRowVersion,
    );
  }
}

@Controller('merge-cases')
export class MergeCaseController {
  constructor(@Inject(PATIENT_SERVICES) private readonly svc: PatientServices) {}

  @Get()
  @RequirePermission('patient.merge')
  list(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: MergeListQueryDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.merges.list(staffActor(actor, tenant, req), q);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('patient.merge')
  @Idempotent()
  approve(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewMergeCaseDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.merges.approve(staffActor(actor, tenant, req), id, dto.expectedRowVersion);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('patient.merge')
  @Idempotent()
  reject(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewMergeCaseDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.merges.reject(staffActor(actor, tenant, req), id, dto);
  }
}
