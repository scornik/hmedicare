import { z } from 'zod';
import {
  type JobRegistry,
  type JobRunner,
  type SubscriptionRegistry,
  NonRetryableJobError,
} from '@hmedic/jobs';
import type { CommunicationService } from '../infrastructure/communication-service';

const Payload = z
  .object({
    v: z.literal(1),
    eventId: z.string().uuid(),
    eventType: z.literal('CommunicationDeliveryRequested'),
    aggregateId: z.string().uuid(),
  })
  .strict();
export const DELIVER_COMMUNICATION = 'DeliverCommunication';
export function registerDeliveryJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  subscriptions: SubscriptionRegistry,
  service: CommunicationService,
) {
  registry.register({
    type: DELIVER_COMMUNICATION,
    queue: 'notifications',
    payloadSchema: Payload,
    maxAttempts: 5,
    leaseSeconds: 120,
  });
  subscriptions.subscribe('CommunicationDeliveryRequested', {
    handler: DELIVER_COMMUNICATION,
    orderedByAggregate: true,
  });
  runner?.handle(DELIVER_COMMUNICATION, async (ctx) => {
    const payload = Payload.parse(ctx.payload);
    if (!ctx.tenantId) throw new NonRetryableJobError('COMMUNICATION_TENANT_REQUIRED');
    await service.deliver(ctx.tenantId, payload.aggregateId, ctx.signal, ctx.attempt);
  });
}
