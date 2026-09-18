import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext } from '@hmedic/kernel';
import { BootstrapTenantRequest } from '@hmedic/contracts';
import { Idempotent } from '@hmedic/http-kit';
import { CurrentActor, PlatformRoute } from '@hmedic/identity-access/nest';
import type { BootstrapResult } from '@hmedic/tenant-org';
import { TENANT_ORG_SERVICES, type TenantOrgServices } from '@hmedic/tenant-org/nest';

class BootstrapTenantDto extends createZodDto(BootstrapTenantRequest) {}

/** `POST /tenants` (API §3.3/§3.12): platform operators with `platform.tenants.bootstrap` only. */
@Controller('tenants')
export class PlatformTenantController {
  constructor(@Inject(TENANT_ORG_SERVICES) private readonly svc: TenantOrgServices) {}

  @Post()
  @PlatformRoute('platform.tenants.bootstrap')
  @Idempotent()
  bootstrap(
    @CurrentActor() actor: ActorContext,
    @Body() dto: BootstrapTenantDto,
    @Req() req: FastifyRequest,
  ): Promise<BootstrapResult> {
    return this.svc.bootstrap.bootstrap({
      ...dto,
      actor: { userId: actor.userId, type: 'OPERATOR' },
      requestId: req.id,
    });
  }
}
