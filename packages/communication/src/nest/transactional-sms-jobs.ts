import { z } from 'zod';
import { JobPort, type JobRegistry, type JobRunner, NonRetryableJobError } from '@hmedic/jobs';
import type { PrismaClient } from '@hmedic/database';
import type { Clock } from '@hmedic/kernel';
import {
  TransactionalSmsDelivery,
  DELIVER_TRANSACTIONAL_SMS,
} from '../infrastructure/transactional-sms-delivery';
const Payload = z
  .object({
    v: z.literal(1),
    communicationId: z.string().uuid(),
    credentialScope: z.enum(['PLATFORM', 'TENANT']),
    credentialId: z.string().uuid().nullable(),
  })
  .strict()
  .refine((value) =>
    value.credentialScope === 'TENANT' ? value.credentialId !== null : value.credentialId === null,
  );
export function registerTransactionalSmsJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  delivery: TransactionalSmsDelivery,
  prisma: PrismaClient,
  clock: Clock,
) {
  registry.register({
    type: DELIVER_TRANSACTIONAL_SMS,
    queue: 'notifications',
    payloadSchema: Payload,
    maxAttempts: 8,
    leaseSeconds: 180,
  });
  delivery.bindQueue(new JobPort(prisma, registry, clock));
  runner?.handle(DELIVER_TRANSACTIONAL_SMS, async (ctx) => {
    if (!ctx.tenantId) throw new NonRetryableJobError('SMS_TENANT_REQUIRED');
    await delivery.execute(ctx.tenantId, Payload.parse(ctx.payload), ctx.signal);
  });
}
