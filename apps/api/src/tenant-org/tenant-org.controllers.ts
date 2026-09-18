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
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import {
  CreateMembershipRequest,
  GrantCoverageRequest,
  RevokeCoverageRequest,
  UpdateMembershipRequest,
} from '@hmedic/contracts';
import { Idempotent } from '@hmedic/http-kit';
import { CurrentActor, CurrentTenant, RequirePermission, RequireTenant } from '@hmedic/identity-access/nest';
import type { CoverageView, MembershipView } from '@hmedic/tenant-org';
import { TENANT_ORG_SERVICES, type TenantOrgServices } from '@hmedic/tenant-org/nest';

class CreateMembershipDto extends createZodDto(CreateMembershipRequest) {}
class UpdateMembershipDto extends createZodDto(UpdateMembershipRequest) {}
class GrantCoverageDto extends createZodDto(GrantCoverageRequest) {}
class RevokeCoverageDto extends createZodDto(RevokeCoverageRequest) {}

/** Memberships (API §3.3, `membership.manage`). */
@Controller('memberships')
export class MembershipController {
  constructor(@Inject(TENANT_ORG_SERVICES) private readonly svc: TenantOrgServices) {}

  @Get()
  @RequirePermission('membership.manage')
  list(@CurrentTenant() tenant: TenantContext): Promise<MembershipView[]> {
    return this.svc.memberships.list(tenant.tenantId);
  }

  @Post()
  @RequirePermission('membership.manage')
  @Idempotent()
  create(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateMembershipDto,
    @Req() req: FastifyRequest,
  ): Promise<MembershipView> {
    return this.svc.memberships.create({ userId: actor.userId, tenant, requestId: req.id }, dto);
  }

  @Patch(':id')
  @RequirePermission('membership.manage')
  @Idempotent('optional')
  update(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateMembershipDto,
    @Req() req: FastifyRequest,
  ): Promise<MembershipView> {
    return this.svc.memberships.update({ userId: actor.userId, tenant, requestId: req.id }, id, dto);
  }
}

/** Doctor coverages (API §3.3, `coverage.manage`; doctors see their own). */
@Controller('doctor-coverages')
export class CoverageController {
  constructor(@Inject(TENANT_ORG_SERVICES) private readonly svc: TenantOrgServices) {}

  @Get()
  @RequireTenant()
  list(@CurrentActor() actor: ActorContext, @CurrentTenant() tenant: TenantContext): Promise<CoverageView[]> {
    if (!tenant.effectivePermissions.has('coverage.manage') && tenant.role !== 'doctor') {
      throw new AppError('FORBIDDEN');
    }
    return this.svc.coverages.list({ userId: actor.userId, tenant });
  }

  @Post()
  @RequirePermission('coverage.manage')
  @Idempotent()
  grant(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: GrantCoverageDto,
    @Req() req: FastifyRequest,
  ): Promise<CoverageView> {
    return this.svc.coverages.grant(
      { userId: actor.userId, tenant, requestId: req.id },
      { ...dto, startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt) },
    );
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermission('coverage.manage')
  @Idempotent()
  revoke(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RevokeCoverageDto,
    @Req() req: FastifyRequest,
  ): Promise<CoverageView> {
    return this.svc.coverages.revoke(
      { userId: actor.userId, tenant, requestId: req.id },
      id,
      dto.expectedRowVersion,
    );
  }
}
