import {
  Body,
  Controller,
  Get,
  Put,
  Post,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import type { CommunicationService, CommunicationProvider } from '@hmedic/communication';
import { SetCommunicationPreferenceRequest } from '@hmedic/contracts';
import {
  CurrentActor,
  CurrentPatientContext,
  OptionalTenant,
  PatientContextRoute,
  RequirePermission,
} from '@hmedic/identity-access/nest';
import type { ResolvedPatientContext } from '@hmedic/identity-access';
import { PATIENT_SERVICES, type PatientServices } from '@hmedic/patient/nest';
import { Public, RateLimit, HTTP_RUNTIME, type HttpRuntime } from '@hmedic/http-kit';
import { staffActor, contextActor } from '../patient/patient.controllers';
export const COMMUNICATION_SERVICE = Symbol('COMMUNICATION_SERVICE');
export const COMMUNICATION_PROVIDERS = Symbol('COMMUNICATION_PROVIDERS');
class PreferenceDto extends createZodDto(SetCommunicationPreferenceRequest) {}
const preferenceView = (p: {
  id: string;
  channel: string;
  preference: string;
  contactId: string | null;
  consentVersion: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  rowVersion: number;
}) => ({
  id: p.id,
  channel: p.channel,
  preference: p.preference,
  contactId: p.contactId,
  consentVersion: p.consentVersion,
  rowVersion: p.rowVersion,
  effectiveFrom: p.effectiveFrom.toISOString(),
  effectiveTo: p.effectiveTo?.toISOString() ?? null,
});
@Controller()
export class CommunicationController {
  constructor(
    @Inject(COMMUNICATION_SERVICE) private readonly service: CommunicationService,
    @Inject(PATIENT_SERVICES) private readonly patient: PatientServices,
  ) {}
  private async access(
    actor: ActorContext,
    id: string,
    req: FastifyRequest,
    ctx?: ResolvedPatientContext,
    tenant?: TenantContext,
  ) {
    if (ctx) {
      if (ctx.patientId !== id) throw new AppError('FORBIDDEN');
      await this.patient.patients.getForContext(contextActor(ctx, req), id);
      return ctx.tenantId;
    }
    if (!tenant) throw new AppError('TENANT_CONTEXT_REQUIRED');
    const p = await this.patient.patients.get(staffActor(actor, tenant, req), id);
    if (p.id !== id) throw new AppError('RESOURCE_NOT_FOUND');
    return tenant.tenantId;
  }
  @Get('patients/:id/communications')
  @RequirePermission('communication.read')
  @PatientContextRoute({ mode: 'or-staff', scope: 'VIEW_RECORDS' })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ) {
    const tenantId = await this.access(actor, id, req, ctx, tenant);
    return this.service.list(tenantId, id, {
      userId: actor.userId,
      actingAs: ctx?.actingAs,
      requestId: req.id,
    });
  }
  @Get('patients/:id/communication-preferences')
  @RequirePermission('communication.read')
  @PatientContextRoute({ mode: 'or-staff', scope: 'VIEW_RECORDS' })
  async preferences(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ) {
    const tenantId = await this.access(actor, id, req, ctx, tenant);
    return (
      await this.service.preferences(tenantId, id, {
        userId: actor.userId,
        actingAs: ctx?.actingAs,
        requestId: req.id,
      })
    ).map(preferenceView);
  }
  @Put('patients/:id/communication-preferences')
  @RequirePermission('communication.send')
  @PatientContextRoute({ mode: 'or-staff', scope: 'GIVE_CONSENT' })
  async set(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PreferenceDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ) {
    const tenantId = await this.access(actor, id, req, ctx, tenant);
    return preferenceView(
      await this.service.setPreference(
        tenantId,
        id,
        body.channel,
        body.preference,
        body.consentVersion,
        body.contactId ?? null,
        { userId: actor.userId, actingAs: ctx?.actingAs, requestId: req.id },
      ),
    );
  }
}
@Controller('webhooks/communication')
export class CommunicationWebhookController {
  constructor(
    @Inject(COMMUNICATION_SERVICE) private readonly service: CommunicationService,
    @Inject(COMMUNICATION_PROVIDERS) private readonly providers: ReadonlyMap<string, CommunicationProvider>,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}
  @Post(':providerAdapter')
  @HttpCode(200)
  @Public()
  @RateLimit({ rule: { scope: 'communication_webhook:ip', limit: 120, windowSeconds: 60 }, by: 'ip' })
  async receive(@Param('providerAdapter') code: string, @Req() req: RawBodyRequest<FastifyRequest>) {
    if (this.runtime.config.APP_ENV === 'production') throw new AppError('FEATURE_DISABLED');
    const provider = [...this.providers.values()].find((p) => p.code === code);
    if (!provider) throw new AppError('RESOURCE_NOT_FOUND');
    if (!req.rawBody || req.rawBody.byteLength > 4096) throw new AppError('PAYLOAD_TOO_LARGE');
    const signature = req.headers['x-mock-signature'];
    if (typeof signature !== 'string') throw new AppError('FORBIDDEN');
    const receipt = await this.service.receiveWebhook(provider, {
      rawBody: req.rawBody,
      headers: { 'x-mock-signature': signature },
    });
    if (!receipt) throw new AppError('FORBIDDEN');
    return { accepted: true };
  }
}
