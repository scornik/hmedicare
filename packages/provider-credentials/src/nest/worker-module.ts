import { z } from 'zod';
import type { ServerConfig } from '@hmedic/config';
import type { PrismaClient } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { type JobRegistry, type JobRunner, MAINTENANCE_QUEUE, type PeriodicJob } from '@hmedic/jobs';
import type { Clock } from '@hmedic/kernel';
import { SecretEnvelope, kekFromBase64 } from '@hmedic/secrets';
import { ProviderCredentialVault } from '../infrastructure/vault';

export const REENCRYPT_JOB = 'ReencryptProviderCredentials';

/** Builds the vault from configuration (current KEK + optional previous KEK during rotation). */
export function createProviderCredentialVault(
  config: ServerConfig,
  prisma: PrismaClient,
  audit: PrismaAuditPort,
  clock: Clock,
): ProviderCredentialVault {
  const previous =
    config.PROVIDER_CREDENTIAL_KEK_PREVIOUS && config.PROVIDER_CREDENTIAL_KEK_PREVIOUS_ID
      ? kekFromBase64(config.PROVIDER_CREDENTIAL_KEK_PREVIOUS_ID, config.PROVIDER_CREDENTIAL_KEK_PREVIOUS)
      : undefined;
  const envelope = new SecretEnvelope({
    current: kekFromBase64(config.PROVIDER_CREDENTIAL_KEK_ID, config.PROVIDER_CREDENTIAL_KEK),
    previous,
  });
  return new ProviderCredentialVault(
    prisma,
    envelope,
    config.PROVIDER_CREDENTIAL_FINGERPRINT_PEPPER,
    audit,
    clock,
  );
}

/** Worker job: re-wrap data keys still under the previous KEK (hourly, bounded batches). */
export function registerProviderCredentialJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  vault: ProviderCredentialVault,
): PeriodicJob[] {
  registry.register({
    type: REENCRYPT_JOB,
    queue: MAINTENANCE_QUEUE,
    payloadSchema: z.object({ v: z.literal(1), window: z.number().int() }),
    maxAttempts: 3,
    leaseSeconds: 120,
    priority: 230,
  });
  runner?.handle(REENCRYPT_JOB, async () => {
    for (let i = 0; i < 20; i++) if ((await vault.rewrapBatch(100)) < 100) break;
  });
  return [{ type: REENCRYPT_JOB, everyMs: 3_600_000 }];
}
