import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { TimelineReader } from '../infrastructure/reader';
export const TIMELINE_READER = Symbol('TIMELINE_READER');
@Global()
@Module({})
export class TimelineReadModule {
  static forRoot(reader: TimelineReader): DynamicModule {
    return {
      module: TimelineReadModule,
      providers: [{ provide: TIMELINE_READER, useValue: reader }],
      exports: [TIMELINE_READER],
    };
  }
}
