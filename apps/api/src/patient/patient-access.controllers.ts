import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import {
  ActivateGuardianshipRequest,
  AddCareTeamMemberRequest,
  EndGuardianshipRequest,
  LinkRequest,
  RequestGuardianshipRequest,
  RowVersionRequest,
  VerifyPatientAccountRequest,
} from '@hmedic/contracts';
import { HTTP_RUNTIME, type HttpRuntime, Idempotent, RateLimit } from '@hmedic/http-kit';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
  RequireTenant,
  TenantMembershipOptional,
} from '@hmedic/identity-access/nest';
import { PATIENT_SERVICES, type PatientServices } from '@hmedic/patient/nest';
import { z } from 'zod';
import { staffActor } from './patient.controllers';

class LinkRequestDto extends createZodDto(LinkRequest) {}
class VerifyAccountDto extends createZodDto(VerifyPatientAccountRequest) {}
class RowVersionDto extends createZodDto(RowVersionRequest) {}
class RequestGuardianshipDto extends createZodDto(RequestGuardianshipRequest) {}
class ActivateGuardianshipDto extends createZodDto(ActivateGuardianshipRequest) {}
class EndGuardianshipDto extends createZodDto(EndGuardianshipRequest) {}
class AddCareTeamMemberDto extends createZodDto(AddCareTeamMemberRequest) {}
const listQuery = (statuses: [string, ...string[]]) =>
  z.object({
    status: z.enum(statuses).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  });
class AccountListQueryDto extends createZodDto(listQuery(['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED'])) {}
class GuardianshipListQueryDto extends createZodDto(listQuery(['PENDING', 'ACTIVE', 'ENDED', 'REVOKED'])) {}

/** Patient accounts (API §3.4; AUTHORIZATION-MATRIX §4). */
@Controller('patient-accounts')
export class PatientAccountController {
  constructor(
    @Inject(PATIENT_SERVICES) private readonly svc: PatientServices,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}

  /** Patient user (no tenant header): the request stays PENDING until the tenant's staff verify it. */
  @Post('link-requests')
  @Idempotent()
  @RateLimit({ rule: { scope: 'patient_link:ip', limit: 10, windowSeconds: 3600 }, by: 'ip' })
  async requestLink(
    @CurrentActor() actor: ActorContext,
    @Body() dto: LinkRequestDto,
    @Req() req: FastifyRequest,
  ) {
    const user = await this.runtime.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    return this.svc.access.requestLink(
      { userId: actor.userId, phoneE164: user.phoneVerifiedAt ? user.phoneE164 : null, requestId: req.id },
      dto,
    );
  }

  @Get()
  @RequirePermission('patient_account.manage')
  list(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: AccountListQueryDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.access.listAccounts(staffActor(actor, tenant, req), q);
  }

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermission('patient_account.manage')
  @Idempotent()
  verify(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyAccountDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.access.verifyAccount(staffActor(actor, tenant, req), id, dto);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermission('patient_account.manage')
  @Idempotent()
  revoke(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RowVersionDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.access.revokeAccount(staffActor(actor, tenant, req), id, dto.expectedRowVersion);
  }
}

/** Guardianships nested under patients plus their own resource routes. */
@Controller()
export class GuardianshipController {
  constructor(
    @Inject(PATIENT_SERVICES) private readonly svc: PatientServices,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}

  /**
   * Staff with `guardianship.manage` create PENDING requests for any guardian user; any other authenticated
   * user may only request a guardianship for themselves (PENDING). The tenant header identifies the tenant
   * without requiring a membership.
   */
  @Post('patients/:id/guardianships')
  @Idempotent()
  @TenantMembershipOptional()
  @RateLimit({ rule: { scope: 'guardianship_request:ip', limit: 20, windowSeconds: 3600 }, by: 'ip' })
  async request(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) dependentPatientId: string,
    @Body() dto: RequestGuardianshipDto,
    @Req() req: FastifyRequest,
  ) {
    const tenantId = req.hm?.tenantId; // validated by the guard (membership optional on this route)
    if (!tenantId) throw new AppError('TENANT_CONTEXT_REQUIRED');
    const staff = req.hm?.tenant;
    if (staff?.effectivePermissions.has('guardianship.manage')) {
      return this.svc.access.requestGuardianship(
        { kind: 'staff', actor: staffActor(actor, staff, req) },
        dependentPatientId,
        dto,
      );
    }
    if (dto.guardianUserId && dto.guardianUserId !== actor.userId) throw new AppError('FORBIDDEN');
    const user = await this.runtime.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    return this.svc.access.requestGuardianship(
      {
        kind: 'user',
        user: {
          userId: actor.userId,
          phoneE164: user.phoneVerifiedAt ? user.phoneE164 : null,
          requestId: req.id,
        },
        tenantId,
      },
      dependentPatientId,
      { ...dto, guardianUserId: actor.userId },
    );
  }

  @Get('patients/:id/guardianships')
  @RequireTenant()
  listForPatient(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) patientId: string,
    @Req() req: FastifyRequest,
  ) {
    if (
      !tenant.effectivePermissions.has('guardianship.manage') &&
      !tenant.effectivePermissions.has('patient.read')
    ) {
      throw new AppError('FORBIDDEN');
    }
    return this.svc.access
      .listGuardianships(staffActor(actor, tenant, req), { patientId, limit: 100 })
      .then((r) => r.items);
  }

  @Get('guardianships')
  @RequirePermission('guardianship.manage')
  list(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: GuardianshipListQueryDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.access.listGuardianships(staffActor(actor, tenant, req), q);
  }

  @Post('guardianships/:id/activate')
  @HttpCode(200)
  @RequirePermission('guardianship.manage')
  @Idempotent()
  activate(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActivateGuardianshipDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.access.activateGuardianship(staffActor(actor, tenant, req), id, dto);
  }

  @Post('guardianships/:id/end')
  @HttpCode(200)
  @RequirePermission('guardianship.manage')
  @Idempotent()
  end(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EndGuardianshipDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.access.endGuardianship(staffActor(actor, tenant, req), id, { ...dto, outcome: 'ENDED' });
  }

  @Post('guardianships/:id/revoke')
  @HttpCode(200)
  @RequirePermission('guardianship.manage')
  @Idempotent()
  revoke(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EndGuardianshipDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.access.endGuardianship(staffActor(actor, tenant, req), id, {
      ...dto,
      outcome: 'REVOKED',
    });
  }
}

@Controller()
export class CareTeamController {
  constructor(@Inject(PATIENT_SERVICES) private readonly svc: PatientServices) {}

  @Get('patients/:id/care-team')
  @RequirePermission('patient.read')
  list(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) patientId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.access.listCareTeam(staffActor(actor, tenant, req), patientId);
  }

  @Post('patients/:id/care-team')
  @RequirePermission('care_team.manage')
  @Idempotent()
  add(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) patientId: string,
    @Body() dto: AddCareTeamMemberDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.access.addCareTeamMember(staffActor(actor, tenant, req), patientId, dto);
  }

  @Post('care-team-members/:id/end')
  @HttpCode(200)
  @RequirePermission('care_team.manage')
  @Idempotent()
  end(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RowVersionDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.access.endCareTeamMember(staffActor(actor, tenant, req), id, dto.expectedRowVersion);
  }
}
