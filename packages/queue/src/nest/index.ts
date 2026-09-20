// NestJS module of the queue context. Controllers live in apps/api (REPOSITORY-STRUCTURE §2.2).
import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { QueueService } from '../infrastructure/queue-service';
import type { SerialService } from '../infrastructure/serial-service';

export const QUEUE_SERVICES = Symbol('QUEUE_SERVICES');

export interface QueueServices {
  serials: SerialService;
  queue: QueueService;
}

@Global()
@Module({})
export class QueueWriteModule {
  static forRoot(services: QueueServices): DynamicModule {
    return {
      module: QueueWriteModule,
      providers: [{ provide: QUEUE_SERVICES, useValue: services }],
      exports: [QUEUE_SERVICES],
    };
  }
}
