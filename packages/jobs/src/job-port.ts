import { type Clock, findDeniedPayloadKeys, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, isUniqueViolation } from '@hmedic/database';
import { DEFAULT_MAX_ATTEMPTS, type JobRegistry } from './job-types';
import { JobPayloadError } from './errors';

export interface EnqueueRequest {
  type: string;
  payload: Record<string, unknown>;
  tenantId?: string | null;
  runAt?: Date;
  priority?: number;
  idempotencyKey?: string | null;
  concurrencyKey?: string | null;
  correlationId: string;
  causationId?: string | null;
}

export interface EnqueueResult {
  jobId: string;
  /** False when (queue, idempotency_key) already existed; the existing job id is returned. */
  created: boolean;
}

/**
 * JobPort (ADR-015): the only way to enqueue background work. Enqueue inside the caller's transaction
 * (pass `tx`) so the job exists iff the business change committed.
 */
export class JobPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: JobRegistry,
    private readonly clock: Clock = systemClock,
  ) {}

  validatePayload(type: string, payload: Record<string, unknown>): Record<string, unknown> {
    const def = this.registry.require(type);
    const denied = findDeniedPayloadKeys(payload);
    if (denied.length)
      throw new JobPayloadError(denied.map((k) => `${k}: PHI/secret field not allowed in job payloads`));
    const parsed = def.payloadSchema.safeParse(payload);
    if (!parsed.success)
      throw new JobPayloadError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    return parsed.data as Record<string, unknown>;
  }

  async enqueue(req: EnqueueRequest, tx?: Tx): Promise<EnqueueResult> {
    const def = this.registry.require(req.type);
    const payload = this.validatePayload(req.type, req.payload);
    const db = tx ?? this.prisma;
    const now = this.clock.now();
    const id = newId();
    try {
      await db.job.create({
        data: {
          id,
          tenantId: req.tenantId ?? null,
          queue: def.queue,
          type: def.type,
          payload: payload as never,
          status: 'QUEUED',
          priority: req.priority ?? def.priority ?? 100,
          runAt: req.runAt ?? now,
          attempts: 0,
          maxAttempts: def.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          concurrencyKey: req.concurrencyKey ?? null,
          idempotencyKey: req.idempotencyKey ?? null,
          correlationId: req.correlationId,
          causationId: req.causationId ?? null,
          createdAt: now,
          updatedAt: now,
        },
      });
      return { jobId: id, created: true };
    } catch (error) {
      if (req.idempotencyKey && isUniqueViolation(error, 'uq_jobs_queue_idem')) {
        if (tx) {
          // Inside a caller transaction the duplicate aborts nothing (statement-level error); report it.
          const existing = await tx.job.findFirst({
            where: { queue: def.queue, idempotencyKey: req.idempotencyKey },
          });
          return { jobId: existing?.id ?? '', created: false };
        }
        const existing = await this.prisma.job.findFirst({
          where: { queue: def.queue, idempotencyKey: req.idempotencyKey },
        });
        return { jobId: existing?.id ?? '', created: false };
      }
      throw error;
    }
  }
}
