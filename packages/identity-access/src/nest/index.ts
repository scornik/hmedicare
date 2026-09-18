// NestJS modules of the identity-access context. Controllers live in apps/api (REPOSITORY-STRUCTURE §2.2).
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { IDENTITY_SERVICES, type IdentityServices } from './identity-services';

export * from './identity-services';
export * from './decorators';
export { AuthGuard } from './auth.guard';

/** Registers the identity services and the global default-deny AuthGuard. */
@Global()
@Module({})
export class IdentityWriteModule {
  static forRoot(services: IdentityServices): DynamicModule {
    return {
      module: IdentityWriteModule,
      providers: [
        { provide: IDENTITY_SERVICES, useValue: services },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [IDENTITY_SERVICES],
    };
  }
}
