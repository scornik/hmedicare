// NestJS module of the clinical context. Controllers live in apps/api (REPOSITORY-STRUCTURE §2.2).
import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { DiagnosisService } from '../infrastructure/diagnosis-service';
import type { EncounterService } from '../infrastructure/encounter-service';
import type { NoteService } from '../infrastructure/note-service';

export const CLINICAL_SERVICES = Symbol('CLINICAL_SERVICES');

export interface ClinicalServices {
  encounters: EncounterService;
  notes: NoteService;
  diagnoses: DiagnosisService;
}

@Global()
@Module({})
export class ClinicalWriteModule {
  static forRoot(services: ClinicalServices): DynamicModule {
    return {
      module: ClinicalWriteModule,
      providers: [{ provide: CLINICAL_SERVICES, useValue: services }],
      exports: [CLINICAL_SERVICES],
    };
  }
}
