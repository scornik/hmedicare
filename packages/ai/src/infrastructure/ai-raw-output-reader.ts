import type { Readable } from 'node:stream';
import { AppError, type Clock, systemClock } from '@hmedic/kernel';
import { type PrismaClient, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { TenantContextResolver } from '@hmedic/identity-access';

/**
 * Reading what was actually sent to a provider (AI-001 §11, `ai.audit.raw_read`).
 *
 * This exists for one question: when something went wrong, what did the model actually receive and
 * what did it actually say? The stored object is the post-minimization request and the raw response,
 * which is the only honest answer to that — a reconstruction from the draft would show what survived
 * validation rather than what the provider was given.
 *
 * It is not a clinical record and must not be used as one. The response is the model's unvalidated
 * output: it may contain suggestions the validator dropped for citing nothing, placeholders nobody
 * restored, and whatever else a model produces. Everything a doctor may act on is in the draft, and
 * everything in the chart went through an approval.
 *
 * Every read is audited before the bytes are handed over. The permission is tenant-owner level by the
 * matrix, and a read of this object is exactly the kind of access somebody should be able to ask about
 * afterwards.
 */
export interface AIRawOutputActor {
  tenantId: string;
  userId: string;
  requestId?: string;
}

/** The read half of the storage port; composition passes the same adapter the runner writes with. */
export interface AIRawOutputStorage {
  get(key: string): Promise<{ stream: Readable; sizeBytes: number }>;
}

export class AIRawOutputReader {
  private readonly clock: Clock;
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      audit: PrismaAuditPort;
      storage?: AIRawOutputStorage;
      clock?: Clock;
    },
  ) {
    this.clock = deps.clock ?? systemClock;
  }

  async open(
    actor: AIRawOutputActor,
    aiJobId: string,
  ): Promise<{ stream: Readable; sizeBytes: number; objectKey: string }> {
    if (!this.deps.storage) {
      // No object storage configured, so nothing was ever written. A client can tell this apart from
      // "the retention was zero", which is the draft's own `rawOutputObjectKey` being null.
      throw new AppError('FEATURE_DISABLED');
    }
    const draft = await withTransaction(this.deps.prisma, async (tx) => {
      const context = await new TenantContextResolver(tx).resolve(actor.userId, actor.tenantId);
      if (!context || !(await tx.user.count({ where: { id: actor.userId, status: 'ACTIVE' } }))) {
        throw new AppError('FORBIDDEN');
      }
      if (!context.effectivePermissions.has('ai.audit.raw_read')) throw new AppError('FORBIDDEN');
      const row = await tx.aiDraft.findFirst({ where: { tenantId: actor.tenantId, aiJobId } });
      if (!row) throw new AppError('RESOURCE_NOT_FOUND');
      if (!row.rawOutputObjectKey) {
        // The tenant's retention is zero, or storage was unavailable when the job finished. Either
        // way nothing was kept, and saying so is better than an empty stream.
        throw new AppError('RESOURCE_NOT_FOUND', undefined, { details: { reason: 'NOT_RETAINED' } });
      }
      /*
       * Audited inside the same transaction that authorized it, and before the bytes are opened. An
       * audit row written afterwards would be missing exactly when it matters most: a read that
       * crashed halfway is still a read.
       */
      await this.deps.audit.append(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'AI_RAW_OUTPUT_READ',
        resourceType: 'ai_job',
        resourceId: aiJobId,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        // The key and the draft, never any content.
        metadata: { aiDraftId: row.id, objectKey: row.rawOutputObjectKey },
      });
      return row;
    });

    const objectKey = draft.rawOutputObjectKey!;
    const object = await this.deps.storage.get(objectKey);
    return { ...object, objectKey };
  }

  /** Whether this job kept anything, for a screen that wants to hide the button rather than fail. */
  async isRetained(actor: AIRawOutputActor, aiJobId: string): Promise<boolean> {
    const row = await this.deps.prisma.aiDraft.findFirst({
      where: { tenantId: actor.tenantId, aiJobId },
      select: { rawOutputObjectKey: true },
    });
    return Boolean(row?.rawOutputObjectKey) && this.deps.storage !== undefined;
  }
}
