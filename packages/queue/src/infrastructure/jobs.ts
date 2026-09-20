import { z } from 'zod';
import type { Logger } from '@hmedic/observability';
import { type JobRegistry, type JobRunner, type PeriodicJob } from '@hmedic/jobs';
import type { SerialService } from './serial-service';

/**
 * Queue background jobs (QUEUE §1, §5.6). `ApplyNoShowPolicy` runs every five minutes and computes its
 * cut-offs in clinic local time; it is idempotent, so a duplicate run changes nothing. `ExpireRecallDeadlines`
 * belongs to CP5 (the called/skipped lifecycle) and is registered there.
 */
export const QUEUE_QUEUE = 'queue';
export const APPLY_NO_SHOW_POLICY = 'queue.apply_no_show_policy';

export function registerQueueJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  serials: SerialService,
  options: { logger?: Logger } = {},
): PeriodicJob[] {
  registry.register({
    type: APPLY_NO_SHOW_POLICY,
    queue: QUEUE_QUEUE,
    payloadSchema: z.object({ v: z.literal(1), window: z.number().int() }),
    maxAttempts: 3,
    leaseSeconds: 120,
    priority: 150,
  });
  runner?.handle(APPLY_NO_SHOW_POLICY, async () => {
    const result = await serials.applyNoShowPolicy();
    if (result.marked > 0) {
      options.logger?.info(
        { daysScanned: result.daysScanned, marked: result.marked },
        'no-show policy applied',
      );
    }
  });
  return [{ type: APPLY_NO_SHOW_POLICY, everyMs: 5 * 60_000 }];
}
