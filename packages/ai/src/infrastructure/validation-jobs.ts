import { z } from 'zod';
import {
  type JobRegistry,
  type JobRunner,
  type SubscriptionRegistry,
  NonRetryableJobError,
  RateLimitedJobError,
} from '@hmedic/jobs';
import type { Logger } from '@hmedic/observability';
import type { AICredentialValidator } from './credential-validator';

/**
 * `ValidateAICredential` (AICRED-004, ADR-017 §4).
 *
 * Runs after a credential is saved or a doctor asks for revalidation, and settles the status every
 * later policy decision reads. The payload is the outbox envelope the publisher produces, so the
 * credential id is the event's aggregate id and the tenant comes from the job row.
 *
 * Two retry behaviours are deliberate. A provider refusing on quota raises `RateLimitedJobError`,
 * which waits until the provider said it would stop refusing and gives back the attempt — a wait the
 * provider itself asked for must not consume the retry budget. An inconclusive attempt throws
 * ordinarily so the backoff applies, because something may yet be wrong on our side.
 *
 * A blocked credential does not retry at all. The production gate closes only through a reviewed
 * change to adapter metadata and the register (ADR-017 §6), so no number of attempts changes the
 * answer and the job says so once.
 */
export const AI_QUEUE = 'ai';
export const VALIDATE_AI_CREDENTIAL = 'ValidateAICredential';

export const ValidateAICredentialPayload = z
  .object({
    v: z.literal(1),
    eventId: z.string().uuid(),
    eventType: z.enum(['AICredentialCreated', 'AICredentialValidationRequested']),
    aggregateId: z.string().uuid(),
  })
  .strict();

export type ValidateAICredentialPayload = z.infer<typeof ValidateAICredentialPayload>;

export function registerAIValidationJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  subscriptions: SubscriptionRegistry,
  validator: AICredentialValidator,
  logger?: Logger,
): void {
  registry.register({
    type: VALIDATE_AI_CREDENTIAL,
    queue: AI_QUEUE,
    payloadSchema: ValidateAICredentialPayload,
    maxAttempts: 6,
    // A vendor's slowest acceptable answer plus room for the write, not more: the lease is what makes
    // a lost worker's credential claimable again.
    leaseSeconds: 120,
    // Above background maintenance. A doctor is waiting to see whether their key works.
    priority: 200,
  });

  // Ordered per credential, so a save followed quickly by a revalidation cannot have two attempts
  // writing one row's status at once.
  for (const eventType of ['AICredentialCreated', 'AICredentialValidationRequested'] as const) {
    subscriptions.subscribe(eventType, {
      handler: VALIDATE_AI_CREDENTIAL,
      orderedByAggregate: true,
    });
  }

  runner?.handle(VALIDATE_AI_CREDENTIAL, async (ctx) => {
    const payload = ValidateAICredentialPayload.parse(ctx.payload);
    if (!ctx.tenantId) throw new NonRetryableJobError('AI_CREDENTIAL_TENANT_REQUIRED');
    const report = await validator.validate(ctx.tenantId, payload.aggregateId);

    // The credential id is safe to log; the provider code and error class are the only other fields,
    // and the key never reaches this layer.
    logger?.info(
      {
        credentialId: payload.aggregateId,
        outcome: report.outcome,
        status: report.status,
        errorClass: report.errorClass ?? null,
      },
      'AI credential validation attempt',
    );

    if (report.outcome === 'RESCHEDULED' && report.retryAt) {
      throw new RateLimitedJobError(report.retryAt);
    }
    if (report.outcome === 'BLOCKED') {
      throw new NonRetryableJobError(report.reason ?? 'POLICY_BLOCKED');
    }
    if (report.outcome === 'INCONCLUSIVE') {
      // Nothing was learned about the key. Retry under the ordinary backoff; the status has not moved,
      // so a doctor's working credential is not disabled by a transport failure. `code` is what
      // `errorClassOf` stores and counts, so the retry is attributable without a provider message.
      const retryable = new Error(report.errorClass ?? 'PROVIDER_ERROR') as Error & { code: string };
      retryable.code = report.errorClass ?? 'PROVIDER_ERROR';
      throw retryable;
    }
  });
}
