import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { FollowUpService } from '../infrastructure/follow-up-service';
export const FOLLOW_UP_SERVICE = Symbol('FOLLOW_UP_SERVICE');
@Global()
@Module({})
export class FollowUpModule {
  static forRoot(service: FollowUpService): DynamicModule {
    return {
      module: FollowUpModule,
      providers: [{ provide: FOLLOW_UP_SERVICE, useValue: service }],
      exports: [FOLLOW_UP_SERVICE],
    };
  }
}
