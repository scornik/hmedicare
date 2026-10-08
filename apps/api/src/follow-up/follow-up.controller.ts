import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import type { FastifyRequest } from 'fastify';
import type { ActorContext, TenantContext } from '@hmedic/kernel';
import {
  CurrentActor,
  CurrentTenant,
  CurrentPatientContext,
  OptionalTenant,
  PatientContextRoute,
  RequirePermission,
} from '@hmedic/identity-access/nest';
import type { ResolvedPatientContext } from '@hmedic/identity-access';
import { BookFollowUpRequest, CreateFollowUpRequest, UpdateFollowUpRequest } from '@hmedic/contracts';
import type { FollowUpService } from '@hmedic/follow-up';
import { FOLLOW_UP_SERVICE } from '@hmedic/follow-up/nest';
import { HTTP_RUNTIME, Idempotent, completeIdempotencyInTx, type HttpRuntime } from '@hmedic/http-kit';
import { clinicalActor, idempotencyKey } from '../clinical/actor';
import { bookingActor } from '../scheduling/chamber-day.controllers';
class CreateDto extends createZodDto(CreateFollowUpRequest) {}
class UpdateDto extends createZodDto(UpdateFollowUpRequest) {}
class BookDto extends createZodDto(BookFollowUpRequest) {}
@Controller()
export class FollowUpController {
  constructor(
    @Inject(FOLLOW_UP_SERVICE) private readonly service: FollowUpService,
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
  ) {}
  @Get('encounters/:id/follow-ups')
  @RequirePermission('encounter.read')
  async list(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.service.list(await clinicalActor(this.runtime, actor, tenant, req), id);
  }
  @Post('encounters/:id/follow-ups')
  @Idempotent()
  @RequirePermission('followup.write')
  async create(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.create(
      await clinicalActor(this.runtime, actor, tenant, req),
      id,
      body,
      idempotencyKey(req),
      (tx, result) =>
        completeIdempotencyInTx(this.runtime.idempotency, req, tx, { status: 201, body: result }),
    );
  }
  @Patch('follow-ups/:id')
  @RequirePermission('followup.write')
  async update(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.update(await clinicalActor(this.runtime, actor, tenant, req), id, body);
  }
  @Post('follow-ups/:id/book')
  @Idempotent()
  @RequirePermission('appointment.write')
  @PatientContextRoute({ mode: 'or-staff', scope: 'BOOK_APPOINTMENTS' })
  book(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: BookDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ) {
    return this.service.book(bookingActor(actor, req, ctx, tenant), id, body, {
      idempotencyKey: idempotencyKey(req),
      onCommit: (tx, result) =>
        completeIdempotencyInTx(this.runtime.idempotency, req, tx, { status: 201, body: result }),
    });
  }
}
