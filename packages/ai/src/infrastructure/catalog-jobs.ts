import { z } from 'zod';
import type { PrismaClient } from '@hmedic/database';
import type { JobRegistry, JobRunner, PeriodicJob } from '@hmedic/jobs';
import type { Logger } from '@hmedic/observability';
import type { DeclaredTier } from '../application/policy/effective-policy';
import type { AICredentialSecrets } from '../application/credentials/credential-secrets';
import type { AIProviderRegister } from '../application/providers/provider-register';
import type { AIModelCatalogStore } from './model-catalog-store';
import { AI_QUEUE } from './validation-jobs';

/**
 * `RefreshAIModelCatalog` (ADAPT-002).
 *
 * Periodic rather than event-driven: nothing in this system knows when a vendor adds or retires a
 * model, so the only way to find out is to ask. Daily is frequent enough — a withdrawn model is
 * caught by the job that tries to use it, which fails with `MODEL_UNAVAILABLE` and does not need the
 * catalog to have noticed first.
 *
 * Listing models needs a credential, which makes the choice of credential part of the job. It uses an
 * ACTIVE one per provider, highest priority first, and it reads nothing patient-related: a list call
 * carries no prompt. Where a provider has no ACTIVE credential the refresh simply records that it
 * could not ask, because deprecating a provider's whole catalog for want of a key would disable every
 * model a doctor had configured.
 */
export const REFRESH_AI_MODEL_CATALOG = 'RefreshAIModelCatalog';

export const RefreshAIModelCatalogPayload = z.object({ v: z.literal(1), window: z.number().int() }).strict();

export type RefreshAIModelCatalogPayload = z.infer<typeof RefreshAIModelCatalogPayload>;

export interface CatalogJobDeps {
  prisma: PrismaClient;
  catalog: AIModelCatalogStore;
  providers: AIProviderRegister;
  secrets: AICredentialSecrets;
  logger?: Logger;
}

/** Returns the periodic schedule, which composition hands to the maintenance scheduler. */
export function registerAICatalogJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  deps: CatalogJobDeps,
): PeriodicJob[] {
  registry.register({
    type: REFRESH_AI_MODEL_CATALOG,
    queue: AI_QUEUE,
    payloadSchema: RefreshAIModelCatalogPayload,
    maxAttempts: 3,
    leaseSeconds: 180,
    // Background: nobody is waiting on a model list, and a doctor's credential validation is.
    priority: 700,
  });

  runner?.handle(REFRESH_AI_MODEL_CATALOG, async (ctx) => {
    RefreshAIModelCatalogPayload.parse(ctx.payload);
    const codes = deps.providers.codes();
    if (codes.length === 0) {
      // No adapter composed, which is production's state until a vendor adapter ships. Nothing to ask.
      return;
    }
    for (const providerCode of codes) {
      const provider = deps.providers.get(providerCode);
      if (!provider) continue;
      const credential = await deps.prisma.aiProviderCredential.findFirst({
        where: { providerCode, status: 'ACTIVE' },
        orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      });
      if (!credential) {
        deps.logger?.info({ providerCode }, 'model catalog refresh skipped: no active credential');
        continue;
      }
      const declaredTier = credential.declaredTier as DeclaredTier;
      const scope = {
        credentialId: credential.id,
        tenantId: credential.tenantId,
        doctorProfileId: credential.doctorProfileId,
        providerCode,
      };
      let result;
      try {
        result = await deps.secrets.use(scope, credential, async (apiKey) =>
          provider.listModels({
            credentialId: credential.id,
            providerCode,
            declaredTier,
            withKey: (fn) => fn(apiKey),
          }),
        );
      } catch {
        // An unusable envelope or an adapter that threw. Neither says anything about the catalog, and
        // the next window asks again.
        deps.logger?.info({ providerCode }, 'model catalog refresh failed to reach the provider');
        continue;
      }
      if (result.outcome === 'ERROR') {
        deps.logger?.info(
          { providerCode, errorClass: result.errorClass },
          'model catalog refresh refused by the provider',
        );
        continue;
      }
      // Availability is recorded for the tier of the credential that asked. A FREE key cannot report
      // what a PAID account would see, so claiming both would be an invention.
      const refreshed = await deps.catalog.refresh(providerCode, result.value, [declaredTier]);
      deps.logger?.info({ ...refreshed }, 'model catalog refreshed');
    }
  });

  // Daily. A withdrawn model is caught by the job that tries to use it, which fails with
  // MODEL_UNAVAILABLE without needing the catalog to have noticed first, so asking more often would
  // spend a doctor's quota on a question that is rarely answered differently.
  return [{ type: REFRESH_AI_MODEL_CATALOG, everyMs: 24 * 60 * 60 * 1000 }];
}
