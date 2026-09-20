import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { AppError, type ActorContext, type TenantContext } from '@hmedic/kernel';
import {
  CancelAppointmentRequest,
  CancelChamberDayRequest,
  CreateAppointmentRequest,
  MaterializeChamberDayRequest,
  RecordDelayRequest,
  RowVersionOnlyRequest,
  UpdateChamberDayPolicyRequest,
} from '@hmedic/contracts';
import { Idempotent } from '@hmedic/http-kit';
import {
  CurrentActor,
  CurrentPatientContext,
  CurrentTenant,
  OptionalTenant,
  PatientContextRoute,
  RequirePermission,
} from '@hmedic/identity-access/nest';
import type { ResolvedPatientContext } from '@hmedic/identity-access';
import { SCHEDULING_SERVICES, type SchedulingServices } from '@hmedic/scheduling/nest';
import type {
  AppointmentPage,
  AppointmentView,
  AvailabilityView,
  BookingActor,
  ChamberDayView,
} from '@hmedic/scheduling';
import { z } from 'zod';
import { schedulingActor } from './scheduling.controllers';

class MaterializeDto extends createZodDto(MaterializeChamberDayRequest) {}
class RowVersionOnlyDto extends createZodDto(RowVersionOnlyRequest) {}
class CancelDayDto extends createZodDto(CancelChamberDayRequest) {}
class RecordDelayDto extends createZodDto(RecordDelayRequest) {}
class UpdatePolicyDto extends createZodDto(UpdateChamberDayPolicyRequest) {}
class CreateAppointmentDto extends createZodDto(CreateAppointmentRequest) {}
class CancelAppointmentDto extends createZodDto(CancelAppointmentRequest) {}
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
class DayListQueryDto extends createZodDto(
  z.object({
    chamberId: z.string().uuid().optional(),
    doctorProfileId: z.string().uuid().optional(),
    from: localDate,
    to: localDate,
  }),
) {}
class AppointmentListQueryDto extends createZodDto(
  z.object({
    chamberDayId: z.string().uuid().optional(),
    patientId: z.string().uuid().optional(),
    status: z
      .enum(['REQUESTED', 'PENDING_PAYMENT', 'BOOKED', 'CANCELLED', 'RESCHEDULED', 'FULFILLED', 'NO_SHOW'])
      .optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
) {}
class CursorQueryDto extends createZodDto(
  z.object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
) {}

function bookingActor(
  actor: ActorContext,
  req: FastifyRequest,
  ctx: ResolvedPatientContext | undefined,
  tenant: TenantContext | undefined,
): BookingActor {
  if (ctx) return { kind: 'patient', context: { ...ctx, requestId: req.id, correlationId: req.id } };
  if (!tenant) throw new AppError('TENANT_CONTEXT_REQUIRED');
  return { kind: 'staff', actor: schedulingActor(actor, tenant, req) };
}

/** Chamber days: materialize, read, availability and the administrative transitions (API §3.5). */
@Controller('chamber-days')
export class ChamberDayController {
  constructor(@Inject(SCHEDULING_SERVICES) private readonly svc: SchedulingServices) {}

  @Get()
  @RequirePermission('appointment.read')
  list(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Query() query: DayListQueryDto,
    @Req() req: FastifyRequest,
  ): Promise<ChamberDayView[]> {
    return this.svc.days.list(schedulingActor(actor, tenant, req), query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('schedule.manage')
  async materialize(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: MaterializeDto,
    @Req() req: FastifyRequest,
  ): Promise<ChamberDayView> {
    const { day } = await this.svc.days.materialize(schedulingActor(actor, tenant, req), dto);
    return day;
  }

  @Get(':id')
  @RequirePermission('appointment.read')
  @PatientContextRoute({ mode: 'or-staff' })
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ): Promise<ChamberDayView> {
    if (ctx) return this.svc.days.getPublic(ctx.tenantId, id);
    if (!tenant) throw new AppError('TENANT_CONTEXT_REQUIRED');
    return this.svc.days.get(schedulingActor(actor, tenant, req), id);
  }

  @Get(':id/availability')
  @RequirePermission('appointment.read')
  @PatientContextRoute({ mode: 'or-staff' })
  availability(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ): Promise<AvailabilityView> {
    const tenantId = ctx?.tenantId ?? tenant?.tenantId;
    if (!tenantId) throw new AppError('TENANT_CONTEXT_REQUIRED');
    return this.svc.days.availability(tenantId, id);
  }

  @Post(':id/open')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('schedule.manage')
  open(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RowVersionOnlyDto,
    @Req() req: FastifyRequest,
  ): Promise<ChamberDayView> {
    return this.svc.days.open(schedulingActor(actor, tenant, req), id, dto);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('schedule.manage')
  pause(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RowVersionOnlyDto,
    @Req() req: FastifyRequest,
  ): Promise<ChamberDayView> {
    return this.svc.days.pause(schedulingActor(actor, tenant, req), id, dto);
  }

  @Post(':id/close')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('chamber_day.close')
  close(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RowVersionOnlyDto,
    @Req() req: FastifyRequest,
  ): Promise<ChamberDayView> {
    return this.svc.days.close(schedulingActor(actor, tenant, req), id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('schedule.manage')
  cancel(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelDayDto,
    @Req() req: FastifyRequest,
  ): Promise<ChamberDayView> {
    return this.svc.days.cancel(schedulingActor(actor, tenant, req), id, dto);
  }

  @Post(':id/delay')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('queue.manage')
  delay(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RecordDelayDto,
    @Req() req: FastifyRequest,
  ): Promise<ChamberDayView> {
    return this.svc.days.recordDelay(schedulingActor(actor, tenant, req), id, dto);
  }

  @Put(':id/queue-policy')
  @Idempotent()
  @RequirePermission('queue.manage')
  updatePolicy(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePolicyDto,
    @Req() req: FastifyRequest,
  ): Promise<ChamberDayView> {
    return this.svc.days.updatePolicy(schedulingActor(actor, tenant, req), id, dto);
  }
}

/** Appointments (API §3.5): staff with `appointment.write` or a patient context with BOOK_APPOINTMENTS. */
@Controller('appointments')
export class AppointmentController {
  constructor(@Inject(SCHEDULING_SERVICES) private readonly svc: SchedulingServices) {}

  @Get()
  @RequirePermission('appointment.read')
  list(
    @CurrentActor() actor: ActorContext,
    @CurrentTenant() tenant: TenantContext,
    @Query() query: AppointmentListQueryDto,
    @Req() req: FastifyRequest,
  ): Promise<AppointmentPage> {
    return this.svc.appointments.list(schedulingActor(actor, tenant, req), query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('appointment.write')
  @PatientContextRoute({ mode: 'or-staff', scope: 'BOOK_APPOINTMENTS' })
  create(
    @CurrentActor() actor: ActorContext,
    @Body() dto: CreateAppointmentDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ): Promise<AppointmentView> {
    const key = req.headers['idempotency-key'];
    return this.svc.appointments.create(bookingActor(actor, req, ctx, tenant), dto, {
      idempotencyKey: Array.isArray(key) ? key[0] : key,
    });
  }

  @Get(':id')
  @RequirePermission('appointment.read')
  @PatientContextRoute({ mode: 'or-staff' })
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ): Promise<AppointmentView> {
    if (ctx) return this.svc.appointments.getForContext({ ...ctx, requestId: req.id }, id);
    if (!tenant) throw new AppError('TENANT_CONTEXT_REQUIRED');
    return this.svc.appointments.get(schedulingActor(actor, tenant, req), id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('appointment.write')
  @PatientContextRoute({ mode: 'or-staff', scope: 'BOOK_APPOINTMENTS' })
  cancel(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelAppointmentDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
    @OptionalTenant() tenant?: TenantContext,
  ): Promise<AppointmentView> {
    return this.svc.appointments.cancel(bookingActor(actor, req, ctx, tenant), id, dto);
  }
}

/** `GET /me/appointments` (C-43): the context patient's own bookings. */
@Controller('me/appointments')
export class MyAppointmentsController {
  constructor(@Inject(SCHEDULING_SERVICES) private readonly svc: SchedulingServices) {}

  @Get()
  @PatientContextRoute({ mode: 'only', scope: 'VIEW_RECORDS' })
  list(
    @Query() query: CursorQueryDto,
    @Req() req: FastifyRequest,
    @CurrentPatientContext() ctx?: ResolvedPatientContext,
  ): Promise<AppointmentPage> {
    if (!ctx) throw new AppError('PATIENT_CONTEXT_REQUIRED');
    return this.svc.appointments.listMine({ ...ctx, requestId: req.id }, query);
  }
}
