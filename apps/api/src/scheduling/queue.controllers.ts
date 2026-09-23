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
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import {
  CallSerialRequest,
  CancelSerialRequest,
  CheckInRequest,
  IssueWalkInRequest,
  ReorderQueueRequest,
  RescheduleSerialRequest,
  RowVersionOnlyRequest,
  SkipSerialRequest,
} from '@hmedic/contracts';
import { Idempotent, notModified } from '@hmedic/http-kit';
import {
  CurrentActor,
  CurrentPatientContext,
  CurrentTenant,
  OptionalTenant,
  PatientContextRoute,
  RequirePermission,
} from '@hmedic/identity-access/nest';
import type { ResolvedPatientContext } from '@hmedic/identity-access';
import { QUEUE_SERVICES, type QueueServices } from '@hmedic/queue/nest';
import type { PatientSerialView, QueueSnapshot, SerialActor, SerialView } from '@hmedic/queue';
import { z } from 'zod';
import { schedulingActor } from './scheduling.controllers';

class IssueWalkInDto extends createZodDto(IssueWalkInRequest) {}
class ReorderQueueDto extends createZodDto(ReorderQueueRequest) {}
class RowVersionOnlyDto extends createZodDto(RowVersionOnlyRequest) {}
class CheckInDto extends createZodDto(CheckInRequest) {}
class CallSerialDto extends createZodDto(CallSerialRequest) {}
class SkipSerialDto extends createZodDto(SkipSerialRequest) {}
class CancelSerialDto extends createZodDto(CancelSerialRequest) {}
class RescheduleSerialDto extends createZodDto(RescheduleSerialRequest) {}
class MySerialsQueryDto extends createZodDto(
  z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }),
) {}

/**
 * A serial command is issued either by staff under a tenant permission or by the patient in context; the
 * services take the two as one actor and apply the patient-side authority checks themselves.
 */
function serialActor(
  actor: ActorContext,
  req: FastifyRequest,
  ctx: ResolvedPatientContext | undefined,
  tenant: TenantContext | undefined,
): SerialActor {
  if (ctx) return { kind: 'patient', context: { ...ctx, requestId: req.id, correlationId: req.id } };
  if (!tenant) throw new AppError('TENANT_CONTEXT_REQUIRED');
  return { kind: 'staff', actor: schedulingActor(actor, tenant, req) };
}

/** The live queue of one chamber day: the board, walk-ins and reordering (API §3.5, QUEUE §3.5/§5.3). */
@Controller('chamber-days')
export class QueueBoardController {
  constructor(@Inject(QUEUE_SERVICES) private readonly svc: QueueServices) {}

  /** Polled every few seconds by the board, so an unchanged queue answers 304 with no body (ADR-013). */
  @Get(':id/queue')
  @RequirePermission('queue.read')
  async snapshot(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<QueueSnapshot | undefined> {
    const snapshot = await this.svc.queue.snapshot(tenant.tenantId, id);
    return notModified(req, reply, snapshot.etag) ? undefined : snapshot;
  }

  @Post(':id/walk-ins')
  @Idempotent()
  @RequirePermission('serial.write')
  issueWalkIn(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: IssueWalkInDto,
    @Req() req: FastifyRequest,
  ): Promise<SerialView> {
    return this.svc.queue.issueWalkIn(schedulingActor(actor, tenant, req), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }

  @Post(':id/reorder')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('queue.manage')
  reorder(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReorderQueueDto,
    @Req() req: FastifyRequest,
  ): Promise<QueueSnapshot> {
    return this.svc.queue.reorder(schedulingActor(actor, tenant, req), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }
}

/** The client's Idempotency-Key, which is what every queue event of the request is keyed by. */
function idempotencyKey(req: FastifyRequest): string | null {
  const header = req.headers['idempotency-key'];
  return typeof header === 'string' && header.length > 0 ? header : null;
}

/** One serial: the lifecycle commands and the two read paths (API §3.5, QUEUE §5.4). */
@Controller('serials')
export class SerialController {
  constructor(@Inject(QUEUE_SERVICES) private readonly svc: QueueServices) {}

  @Get(':id')
  @RequirePermission('queue.read')
  get(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ): Promise<SerialView> {
    return this.svc.serials.get({ kind: 'staff', actor: schedulingActor(actor, tenant, req) }, id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('serial.manage')
  @PatientContextRoute({ mode: 'or-staff' })
  confirm(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RowVersionOnlyDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ): Promise<SerialView> {
    return this.svc.serials.confirm(serialActor(actor, req, ctx, tenant), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }

  @Post(':id/check-in')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('serial.manage')
  @PatientContextRoute({ mode: 'or-staff' })
  checkIn(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CheckInDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ): Promise<SerialView> {
    return this.svc.queue.checkIn(serialActor(actor, req, ctx, tenant), id, {
      ...dto,
      idempotencyKey: idempotencyKey(req),
    });
  }

  @Post(':id/remote-ready')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('serial.manage')
  @PatientContextRoute({ mode: 'or-staff' })
  remoteReady(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RowVersionOnlyDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ): Promise<SerialView> {
    return this.svc.queue.markRemoteReady(serialActor(actor, req, ctx, tenant), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }

  @Post(':id/mark-waiting')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('serial.manage')
  markWaiting(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RowVersionOnlyDto,
    @Req() req: FastifyRequest,
  ): Promise<SerialView> {
    return this.svc.queue.markWaiting(
      { kind: 'staff', actor: schedulingActor(actor, tenant, req) },
      id,
      dto,
      { idempotencyKey: idempotencyKey(req) },
    );
  }

  @Post(':id/call')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('queue.call')
  call(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CallSerialDto,
    @Req() req: FastifyRequest,
  ): Promise<SerialView> {
    return this.svc.queue.call({ kind: 'staff', actor: schedulingActor(actor, tenant, req) }, id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }

  @Post(':id/skip')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('queue.manage')
  skip(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SkipSerialDto,
    @Req() req: FastifyRequest,
  ): Promise<SerialView> {
    return this.svc.queue.skip({ kind: 'staff', actor: schedulingActor(actor, tenant, req) }, id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }

  @Post(':id/recall')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('queue.manage')
  recall(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RowVersionOnlyDto,
    @Req() req: FastifyRequest,
  ): Promise<SerialView> {
    return this.svc.queue.recall({ kind: 'staff', actor: schedulingActor(actor, tenant, req) }, id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }

  /** ADR-021: interim, pre-clinical. Both are retired when Stage 6 introduces encounters. */
  /**
   * ADR-021's own exit clause. These two transitions existed because Stage 5 had to run a full chamber
   * day with no clinical model; they checked only that the caller was the chamber's doctor, which is one
   * of the five assignment rules and meant a doctor covering a sick colleague could not see the patient
   * in front of them. `POST /encounters` does the same work and applies the whole rule.
   *
   * 410 rather than a silent redirect: a client calling this is written against a model that no longer
   * exists, and should be told so rather than quietly given different behaviour. Deleted one release later.
   */
  @Post(':id/start-consultation')
  @RequirePermission('encounter.start')
  startConsultation(): never {
    throw new AppError('ENDPOINT_RETIRED', undefined, {
      details: { replacement: 'POST /api/v1/serials/{id}/encounter', adr: 'ADR-021' },
    });
  }

  /** Retired with `start-consultation` above; `POST /encounters/{id}/complete` replaces it. */
  @Post(':id/complete')
  @RequirePermission('encounter.complete')
  complete(): never {
    throw new AppError('ENDPOINT_RETIRED', undefined, {
      details: { replacement: 'POST /api/v1/encounters/{id}/complete', adr: 'ADR-021' },
    });
  }

  @Post(':id/no-show')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('serial.manage')
  noShow(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RowVersionOnlyDto,
    @Req() req: FastifyRequest,
  ): Promise<SerialView> {
    return this.svc.serials.markNoShow(
      { kind: 'staff', actor: schedulingActor(actor, tenant, req) },
      id,
      dto,
      { idempotencyKey: idempotencyKey(req) },
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('serial.manage')
  @PatientContextRoute({ mode: 'or-staff' })
  cancel(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelSerialDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ): Promise<SerialView> {
    return this.svc.serials.cancel(serialActor(actor, req, ctx, tenant), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('appointment.write')
  @PatientContextRoute({ mode: 'or-staff' })
  reschedule(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RescheduleSerialDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ): Promise<{ old: SerialView; next: SerialView }> {
    return this.svc.serials.reschedule(serialActor(actor, req, ctx, tenant), id, dto, {
      idempotencyKey: idempotencyKey(req),
    });
  }
}

/** The patient's own serials (API §3.5 `GET /me/serials`). */
@Controller('me/serials')
export class MySerialsController {
  constructor(@Inject(QUEUE_SERVICES) private readonly svc: QueueServices) {}

  @Get(':id')
  @PatientContextRoute({ mode: 'only', scope: 'VIEW_RECORDS' })
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
  ): Promise<PatientSerialView> {
    if (!ctx) throw new AppError('PATIENT_CONTEXT_REQUIRED');
    return this.svc.queue.patientView({ ...ctx, requestId: req.id, correlationId: req.id }, id);
  }

  @Get()
  @PatientContextRoute({ mode: 'only', scope: 'VIEW_RECORDS' })
  async list(
    @Query() query: MySerialsQueryDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
  ): Promise<{ items: PatientSerialView[] }> {
    if (!ctx) throw new AppError('PATIENT_CONTEXT_REQUIRED');
    const items = await this.svc.queue.listMine(
      { ...ctx, requestId: req.id, correlationId: req.id },
      query.limit,
    );
    return { items };
  }
}
