// Public surface of the patient context (REPOSITORY-STRUCTURE.md §2.2, MODULE-BOUNDARIES.md).
export * from '../domain/duplicates';
export * from '../domain/mrn';
export * from '../application/ports';
export { PatientService } from '../infrastructure/patient-service';
export type {
  PatientView,
  PatientSummaryView,
  SearchResult,
  DuplicateCheckResult,
} from '../infrastructure/patient-service';
export { MergeService } from '../infrastructure/merge-service';
export type { MergeCaseView } from '../infrastructure/merge-service';
export { ConsentService } from '../infrastructure/consent-service';
export type { ConsentView } from '../infrastructure/consent-service';
export { PatientAccessService } from '../infrastructure/patient-access-service';
export type {
  PatientAccountView,
  GuardianshipView,
  CareTeamMemberView,
} from '../infrastructure/patient-access-service';
export { PatientContextResolver } from '../infrastructure/patient-context-resolver';
export type { PatientContextSummary } from '../infrastructure/patient-context-resolver';
export { PatientEvents } from '../infrastructure/events';
export type { PatientEventName } from '../infrastructure/events';
