import { Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import type { TelemedicineSessionService } from '@hmedic/telemedicine';
import type { ResolvedPatientContext } from '@hmedic/identity-access';
import {
  CurrentActor,
  CurrentPatientContext,
  CurrentTenant,
  OptionalTenant,
  PatientContextRoute,
  RequirePermission,
} from '@hmedic/identity-access/nest';
import { HTTP_RUNTIME, Idempotent, RateLimit, type HttpRuntime } from '@hmedic/http-kit';
import { clinicalActor } from '../clinical/actor';

export const TELEMEDICINE_SESSIONS = Symbol('TELEMEDICINE_SESSIONS');
@Controller()
export class TelemedicineSessionController {
  constructor(
    @Inject(TELEMEDICINE_SESSIONS) private readonly sessions: TelemedicineSessionService | null,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}
  private service() {
    if (!this.sessions) throw new AppError('FEATURE_DISABLED');
    return this.sessions;
  }
  @Post('encounters/:id/telemedicine/session')
  @RequirePermission('telemedicine.start')
  @Idempotent()
  create(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    const service = this.service();
    return clinicalActor(this.runtime, actor, tenant, req).then((resolved) => service.create(resolved, id));
  }
  private async joinActor(
    actor: ActorContext,
    tenant: TenantContext | null,
    patient: ResolvedPatientContext | null,
    req: FastifyRequest,
  ) {
    if (patient)
      return {
        userId: patient.userId,
        tenantId: patient.tenantId,
        patientId: patient.patientId,
        actingAs: patient.actingAs,
        requestId: req.id,
      };
    if (!tenant) throw new AppError('FORBIDDEN');
    return clinicalActor(this.runtime, actor, tenant, req);
  }
  @Get('telemedicine/sessions/:id')
  @RequirePermission('encounter.read')
  @PatientContextRoute({ mode: 'or-staff', scope: 'JOIN_TELEMEDICINE' })
  @Header('Cache-Control', 'no-store')
  read(
    @CurrentActor() actor: ActorContext,
    @OptionalTenant() tenant: TenantContext | null,
    @CurrentPatientContext() patient: ResolvedPatientContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    const service = this.service();
    return this.joinActor(actor, tenant, patient, req).then((resolved) => service.read(resolved, id));
  }
  @Post('telemedicine/sessions/:id/join-token')
  @HttpCode(200)
  @RequirePermission('telemedicine.join')
  @PatientContextRoute({ mode: 'or-staff', scope: 'JOIN_TELEMEDICINE' })
  @Idempotent('required', { replay: 'refuse' })
  @Header('Cache-Control', 'no-store')
  @RateLimit({ rule: { scope: 'telemedicine-join', limit: 20, windowSeconds: 60 }, by: 'ip' })
  join(
    @CurrentActor() actor: ActorContext,
    @OptionalTenant() tenant: TenantContext | null,
    @CurrentPatientContext() patient: ResolvedPatientContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    const service = this.service();
    return this.joinActor(actor, tenant, patient, req).then((resolved) => service.join(resolved, id));
  }
  @Post('telemedicine/sessions/:id/end')
  @HttpCode(200)
  @RequirePermission('telemedicine.manage')
  @Idempotent()
  end(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    const service = this.service();
    return clinicalActor(this.runtime, actor, tenant, req).then((resolved) => service.end(resolved, id));
  }
}
