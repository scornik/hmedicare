export * from '../domain/session';
export type { TelemedicineProvider, ParticipantEvent } from '../application/provider';
export { MockTelemedicineProvider, type MockVideoScenario } from '../infrastructure/mock-provider';
export { TelemedicineSessionService, type RemotePatientActor } from '../infrastructure/session-service';
