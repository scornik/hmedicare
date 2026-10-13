import { z } from 'zod';
import { newId } from '@hmedic/kernel';
import type { Tx } from '@hmedic/database';
import {
  DEFAULT_MAX_ATTEMPTS,
  type JobRegistry,
  type JobRunner,
  NonRetryableJobError,
  RateLimitedJobError,
} from '@hmedic/jobs';
import type { Logger } from '@hmedic/observability';
import type { AIJobRunner } from './ai-job-runner';
import { AI_QUEUE } from './validation-jobs';

/**
 * `RunAIJob` on the queue (AI-001, ADR-015).
 *
 * Enqueued directly rather than through the outbox, because the `ai_jobs` row and its queue row are
 * written in the same transaction as the request: the doctor's request either produces both or
 * neither, and an outbox hop would add a window in which the job existed but nothing would run it.
 *
 * The three retry behaviours mirror the credential validation job, for the same reasons. A provider
 * rate limit waits until the time the provider named and gives the attempt back. A definite refusal
 * — a spent quota, a rejected key, blocked content, a withdrawn model, failed minimization — does not
 * retry, because the next attempt sends the same thing to the same place. Anything inconclusive
 * retries under the ordinary backoff.
 *
 * `ai_jobs.status` is the doctor-visible state and the platform `jobs` row is the mechanism. They are
 * kept in step rather than merged: a lease lost mid-call must leave the AI job re-runnable, which the
 * platform row already handles, while the AI job keeps the error class a doctor's screen shows.
 */
export const RUN_AI_JOB = 'RunAIJob';

export const RunAIJobPayload = z.object({ v: z.literal(1), aiJobId: z.string().uuid() }).strict();

export type RunAIJobPayload = z.infer<typeof RunAIJobPayload>;

/** Writes the queue row inside the caller's transaction. Returns the platform job id. */
export function enqueueAIJob(clockNow: () => Date) {
  return async (
    tx: Tx,
    job: { tenantId: string; aiJobId: string; correlationId: string },
  ): Promise<string> => {
    const now = clockNow();
    const id = newId();
    await tx.job.create({
      data: {
        id,
        tenantId: job.tenantId,
        queue: AI_QUEUE,
        type: RUN_AI_JOB,
        payload: { v: 1, aiJobId: job.aiJobId } as never,
        status: 'QUEUED',
        // Above the background refresh and beside credential validation: a doctor is waiting.
        priority: 150,
        runAt: now,
        attempts: 0,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        // One run at a time per AI job: a second attempt while the first is mid-call would send the
        // same patient's data twice.
        concurrencyKey: `${RUN_AI_JOB}:${job.aiJobId}`.slice(0, 128),
        idempotencyKey: `${RUN_AI_JOB}:${job.aiJobId}`,
        correlationId: job.correlationId,
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  };
}

export function registerRunAIJob(
  registry: JobRegistry,
  runner: JobRunner | null,
  aiRunner: AIJobRunner,
  options: { providerTimeoutSeconds?: number; logger?: Logger } = {},
): void {
  registry.register({
    type: RUN_AI_JOB,
    queue: AI_QUEUE,
    payloadSchema: RunAIJobPayload,
    maxAttempts: 6,
    // Longer than the provider timeout plus the writes around it, so a lease does not expire while a
    // model is still answering and leave two runs racing.
    leaseSeconds: (options.providerTimeoutSeconds ?? 60) + 60,
    priority: 150,
  });

  runner?.handle(RUN_AI_JOB, async (ctx) => {
    const payload = RunAIJobPayload.parse(ctx.payload);
    if (!ctx.tenantId) throw new NonRetryableJobError('AI_JOB_TENANT_REQUIRED');
    const report = await aiRunner.run(ctx.tenantId, payload.aiJobId, ctx.signal);

    options.logger?.info(
      {
        aiJobId: payload.aiJobId,
        outcome: report.outcome,
        errorClass: report.errorClass ?? null,
        suggestions: report.suggestions ?? null,
        droppedUnsourced: report.droppedUnsourced ?? null,
      },
      'AI job attempt',
    );

    if (report.outcome === 'WAITING_RATE_LIMIT' && report.retryAt) {
      throw new RateLimitedJobError(report.retryAt);
    }
    if (report.outcome === 'FAILED') {
      // The AI job row already carries the class the doctor sees, and retrying would repeat a refusal.
      throw new NonRetryableJobError(report.errorClass ?? 'AI_JOB_FAILED');
    }
    if (report.outcome === 'RETRY') {
      const retryable = new Error(report.errorClass ?? 'PROVIDER_ERROR') as Error & { code: string };
      retryable.code = report.errorClass ?? 'PROVIDER_ERROR';
      throw retryable;
    }
    // SUCCEEDED, CANCELLED and SKIPPED are all finished states for this attempt.
  });
}
