import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext, TenantContext } from '@hmedic/kernel';
import type { SmsAccountService } from '@hmedic/communication';
import { CreateSmsCredentialRequest, ValidateSmsCredentialRequest } from '@hmedic/contracts';
import { CurrentActor, CurrentTenant, PlatformRoute, RequirePermission } from '@hmedic/identity-access/nest';
import { RateLimit } from '@hmedic/http-kit';
export const SMS_ACCOUNT_SERVICE = Symbol('SMS_ACCOUNT_SERVICE');
class CreateDto extends createZodDto(CreateSmsCredentialRequest) {}
class ValidateDto extends createZodDto(ValidateSmsCredentialRequest) {}
@Controller('tenant/sms-credentials')
@RequirePermission('sms.credentials.manage')
export class SmsAccountsController {
  constructor(@Inject(SMS_ACCOUNT_SERVICE) private readonly service: SmsAccountService) {}
  @Get()
  list(@CurrentTenant() tenant: TenantContext, @CurrentActor() actor: ActorContext) {
    return this.service.list(tenant.tenantId, actor.userId);
  }
  @Post()
  @HttpCode(200)
  @RateLimit({ rule: { scope: 'sms-credential-create', limit: 10, windowSeconds: 60 }, by: 'ip' })
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentActor() actor: ActorContext,
    @Body() dto: CreateDto,
  ) {
    return this.service.create(tenant.tenantId, actor.userId, dto);
  }
  @Delete(':id')
  revoke(
    @CurrentTenant() tenant: TenantContext,
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.revoke(tenant.tenantId, actor.userId, id);
  }
  @Post(':id/validate')
  @HttpCode(200)
  @RateLimit({ rule: { scope: 'sms-credential-validate', limit: 10, windowSeconds: 60 }, by: 'ip' })
  validate(
    @CurrentTenant() tenant: TenantContext,
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidateDto,
  ) {
    return this.service.validate(tenant.tenantId, actor.userId, id, dto.rowVersion);
  }
  @Get(':id/balance')
  balance(
    @CurrentTenant() tenant: TenantContext,
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.balance(tenant.tenantId, actor.userId, id);
  }
}
@Controller('platform/sms')
export class PlatformSmsBalanceController {
  constructor(@Inject(SMS_ACCOUNT_SERVICE) private readonly service: SmsAccountService) {}
  @Get('balance')
  @PlatformRoute('ops.sms.read')
  @RateLimit({ rule: { scope: 'platform-sms-balance', limit: 30, windowSeconds: 60 }, by: 'ip' })
  read(@CurrentActor() actor: ActorContext) {
    return this.service.platformBalance(actor.userId);
  }
}
