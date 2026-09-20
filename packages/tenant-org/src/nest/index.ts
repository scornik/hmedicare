// NestJS module of the tenant-org context. Controllers live in apps/api (REPOSITORY-STRUCTURE §2.2).
import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { ClinicService } from '../infrastructure/clinic-service';
import type { CoverageService } from '../infrastructure/coverage-service';
import type { MembershipService } from '../infrastructure/membership-service';
import type { TenantBootstrapService } from '../infrastructure/tenant-bootstrap';

export const TENANT_ORG_SERVICES = Symbol('TENANT_ORG_SERVICES');

export interface TenantOrgServices {
  clinics: ClinicService;
  memberships: MembershipService;
  coverages: CoverageService;
  bootstrap: TenantBootstrapService;
}

@Global()
@Module({})
export class TenantOrgWriteModule {
  static forRoot(services: TenantOrgServices): DynamicModule {
    return {
      module: TenantOrgWriteModule,
      providers: [{ provide: TENANT_ORG_SERVICES, useValue: services }],
      exports: [TENANT_ORG_SERVICES],
    };
  }
}
