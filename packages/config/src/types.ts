import type { z } from 'zod';
import type {
  authSection,
  databaseSection,
  jobsSection,
  medicationCatalogSection,
  observabilitySection,
  runtimeSection,
  smsSection,
} from './schema';

type Out<T extends Record<string, z.ZodTypeAny>> = { [K in keyof T]: z.output<T[K]> };

export type RuntimeConfig = Out<typeof runtimeSection>;
export type DatabaseConfig = Out<typeof databaseSection>;
export type JobsConfig = Out<typeof jobsSection>;
export type AuthConfig = Out<typeof authSection>;
export type SmsConfig = Out<typeof smsSection>;
export type MedicationCatalogConfig = Out<typeof medicationCatalogSection>;
export type ObservabilityConfig = Out<typeof observabilitySection>;

/** Full configuration of the api and worker apps (Stage 4 sections). */
export type ServerConfig = RuntimeConfig &
  DatabaseConfig &
  JobsConfig &
  AuthConfig &
  SmsConfig &
  MedicationCatalogConfig &
  ObservabilityConfig;
