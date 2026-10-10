import { z } from 'zod';
import { type JobRegistry, type JobRunner, type PeriodicJob } from '@hmedic/jobs';
import type { CommunicationService } from '../infrastructure/communication-service';
export interface ReminderTaskSource {
  due(
    limit?: number,
  ): Promise<
    Array<{ id: string; tenantId: string; patientId: string; followUpPlanId: string; rowVersion: number }>
  >;
  finish(taskId: string, tenantId: string, planId: string, rowVersion: number): Promise<unknown>;
}
export const CREATE_FOLLOW_UP_REMINDERS = 'CreateFollowUpReminders';
export async function createDueReminders(
  service: CommunicationService,
  source: ReminderTaskSource,
  signal?: AbortSignal,
) {
  for (const task of await source.due(100)) {
    if (signal?.aborted) return;
    // Prefer email; only try WhatsApp when email was suppressed before any provider call.
    // This is channel selection, not failure fallback. Both require their own live grant.
    for (const channel of service.reminderChannels()) {
      const intent = await service.requestReminder({
        tenantId: task.tenantId,
        patientId: task.patientId,
        planId: task.followUpPlanId,
        channel,
        locale: 'bn-BD',
        idempotencyKey: `follow-up:${task.id}:${task.rowVersion}:${channel}`,
        task: { id: task.id, rowVersion: task.rowVersion },
      });
      if (intent.status !== 'CANCELLED') break;
    }
    if (service.reminderChannels().length === 0) continue;
    await source.finish(task.id, task.tenantId, task.followUpPlanId, task.rowVersion);
  }
}
export function registerReminderJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  service: CommunicationService,
  source: ReminderTaskSource,
): PeriodicJob[] {
  registry.register({
    type: CREATE_FOLLOW_UP_REMINDERS,
    queue: 'notifications',
    payloadSchema: z.object({ v: z.literal(1), window: z.number().int() }).strict(),
    maxAttempts: 5,
    leaseSeconds: 120,
  });
  runner?.handle(CREATE_FOLLOW_UP_REMINDERS, async (ctx) => {
    await createDueReminders(service, source, ctx.signal);
  });
  return [{ type: CREATE_FOLLOW_UP_REMINDERS, everyMs: 60_000 }];
}
