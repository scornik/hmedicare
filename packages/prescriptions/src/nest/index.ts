// NestJS module of the prescriptions context. Controllers live in apps/api (REPOSITORY-STRUCTURE §2.2).
import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { MedicationCatalogAdminService } from '../infrastructure/medication-catalog-admin';
import type { MedicationSearchService } from '../infrastructure/medication-search';

export * from './worker-module';

export const PRESCRIPTION_SERVICES = Symbol('PRESCRIPTION_SERVICES');

export interface PrescriptionServices {
  /** Platform-operator import controls and gate attestations. */
  catalogAdmin: MedicationCatalogAdminService;
  /** The prescriber-facing catalog lookup. */
  search: MedicationSearchService;
}

@Global()
@Module({})
export class PrescriptionWriteModule {
  static forRoot(services: PrescriptionServices): DynamicModule {
    return {
      module: PrescriptionWriteModule,
      providers: [{ provide: PRESCRIPTION_SERVICES, useValue: services }],
      exports: [PRESCRIPTION_SERVICES],
    };
  }
}
