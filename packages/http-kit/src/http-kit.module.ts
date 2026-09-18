import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { HealthController, InternalJobsController, InternalMetricsController } from './controllers';
import { InternalTokenGuard } from './internal-token';
import {
  EnvelopeInterceptor,
  IdempotencyInterceptor,
  ProblemDetailsFilter,
  RateLimitGuard,
} from './nest-components';
import { HTTP_RUNTIME, type HttpRuntime } from './runtime';

/**
 * Cross-cutting HTTP layer shared by apps/api and apps/worker. Interceptor order: envelope (outer) →
 * idempotency (inner), so replays are enveloped like fresh responses. Guards: internal token, then rate
 * limits (identity-access adds authentication/authorization guards in its own modules).
 */
@Global()
@Module({})
export class HttpKitModule {
  static forRoot(runtime: HttpRuntime, options: { jobsEndpoint: boolean }): DynamicModule {
    return {
      module: HttpKitModule,
      controllers: [
        HealthController,
        InternalMetricsController,
        ...(options.jobsEndpoint ? [InternalJobsController] : []),
      ],
      providers: [
        { provide: HTTP_RUNTIME, useValue: runtime },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_GUARD, useClass: InternalTokenGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
      exports: [HTTP_RUNTIME],
    };
  }
}
