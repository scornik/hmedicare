// NestJS module of the patient context. Controllers live in apps/api (REPOSITORY-STRUCTURE §2.2).
import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { ConsentService } from '../infrastructure/consent-service';
import type { MergeService } from '../infrastructure/merge-service';
import type { PatientAccessService } from '../infrastructure/patient-access-service';
import type { PatientContextResolver } from '../infrastructure/patient-context-resolver';
import type { PatientService } from '../infrastructure/patient-service';

export const PATIENT_SERVICES = Symbol('PATIENT_SERVICES');

export interface PatientServices {
  patients: PatientService;
  merges: MergeService;
  consents: ConsentService;
  access: PatientAccessService;
  contexts: PatientContextResolver;
}

@Global()
@Module({})
export class PatientWriteModule {
  static forRoot(services: PatientServices): DynamicModule {
    return {
      module: PatientWriteModule,
      providers: [{ provide: PATIENT_SERVICES, useValue: services }],
      exports: [PATIENT_SERVICES],
    };
  }
}
