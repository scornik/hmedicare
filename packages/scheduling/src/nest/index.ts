// NestJS module of the scheduling context. Controllers live in apps/api (REPOSITORY-STRUCTURE §2.2).
import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { AppointmentService } from '../infrastructure/appointment-service';
import type { ChamberDayService } from '../infrastructure/chamber-day-service';
import type { ChamberService } from '../infrastructure/chamber-service';
import type { ScheduleService } from '../infrastructure/schedule-service';

export const SCHEDULING_SERVICES = Symbol('SCHEDULING_SERVICES');

export interface SchedulingServices {
  chambers: ChamberService;
  schedules: ScheduleService;
  days: ChamberDayService;
  appointments: AppointmentService;
}

@Global()
@Module({})
export class SchedulingWriteModule {
  static forRoot(services: SchedulingServices): DynamicModule {
    return {
      module: SchedulingWriteModule,
      providers: [{ provide: SCHEDULING_SERVICES, useValue: services }],
      exports: [SCHEDULING_SERVICES],
    };
  }
}
