import { createHash } from 'node:crypto';
import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, isUniqueViolation } from '@hmedic/database';

/**
 * DB-backed idempotency (DATABASE-IMPLEMENTATION.md §3.2, API-IMPLEMENTATION.md §1).
 * - Same key + same request hash: COMPLETED → replay; IN_PROGRESS → 409 IDEMPOTENCY_IN_PROGRESS;
 *   FAILED_RETRYABLE → re-execute.
 * - Same key + different hash → 422 IDEMPOTENCY_KEY_REUSED.
 * - The COMPLETED record is written in the same transaction as the mutation (`commit`), so a crash before
 *   commit leaves nothing. Two-phase flows (provider call after commit) use `begin` + `complete`.
 */
export interface IdempotencyScope {
  tenantId: string | null;
  /** Route template, e.g. `POST /auth/otp/request`. */
  scope: string;
  key: string;
  actorUserId: string | null;
  requestHash: string;
}

export interface IdempotentResponse {
  status: number;
  body: unknown;
}

export type LookupResult =
  { state: 'NEW' } | { state: 'REPLAY'; response: IdempotentResponse } | { state: 'RETRY' };

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_\-:.]{8,191}$/;

/** SHA-256 of canonical JSON (sorted keys) of method, path params and body. */
export function requestHash(parts: { method: string; path: string; body: unknown }): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return createHash('sha256')
    .update(
      JSON.stringify(canonical({ m: parts.method.toUpperCase(), p: parts.path, b: parts.body ?? null })),
    )
    .digest('hex');
}

export class IdempotencyStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlHours: number,
    private readonly clock: Clock = systemClock,
  ) {}

  private where(s: IdempotencyScope) {
    return { tenantId: s.tenantId, scope: s.scope, idemKey: s.key };
  }

  /** Checks an incoming request against an existing record. Throws the documented 409/422 errors. */
  async lookup(s: IdempotencyScope, db: PrismaClient | Tx = this.prisma): Promise<LookupResult> {
    const existing = await db.idempotencyRecord.findFirst({ where: this.where(s) });
    if (!existing) return { state: 'NEW' };
    if (existing.requestHash !== s.requestHash) throw new AppError('IDEMPOTENCY_KEY_REUSED');
    if (existing.status === 'COMPLETED') {
      return {
        state: 'REPLAY',
        response: { status: existing.responseStatus ?? 200, body: existing.responseSnapshot },
      };
    }
    if (existing.status === 'IN_PROGRESS')
      throw new AppError('IDEMPOTENCY_IN_PROGRESS', undefined, { retryAfterSeconds: 1 });
    return { state: 'RETRY' };
  }

  private expires(): Date {
    return new Date(this.clock.now().getTime() + this.ttlHours * 3_600_000);
  }

  /**
   * Records a completed request inside the mutation's transaction. A concurrent duplicate makes this
   * insert fail with the unique key, rolling back the duplicate mutation.
   */
  async commit(
    tx: Tx,
    s: IdempotencyScope,
    response: IdempotentResponse,
    resource?: { type: string; id: string },
  ): Promise<void> {
    const now = this.clock.now();
    await tx.idempotencyRecord.deleteMany({ where: { ...this.where(s), status: 'FAILED_RETRYABLE' } });
    await tx.idempotencyRecord.create({
      data: {
        id: newId(),
        ...this.where(s),
        actorUserId: s.actorUserId,
        requestHash: s.requestHash,
        status: 'COMPLETED',
        responseStatus: response.status,
        responseSnapshot: (response.body ?? null) as never,
        resourceType: resource?.type ?? null,
        resourceId: resource?.id ?? null,
        createdAt: now,
        completedAt: now,
        expiresAt: this.expires(),
      },
    });
  }

  /** Two-phase flows: IN_PROGRESS inside the transaction, completed after the external call. */
  async begin(tx: Tx, s: IdempotencyScope): Promise<string> {
    const now = this.clock.now();
    const id = newId();
    await tx.idempotencyRecord.deleteMany({ where: { ...this.where(s), status: 'FAILED_RETRYABLE' } });
    await tx.idempotencyRecord.create({
      data: {
        id,
        ...this.where(s),
        actorUserId: s.actorUserId,
        requestHash: s.requestHash,
        status: 'IN_PROGRESS',
        createdAt: now,
        expiresAt: this.expires(),
      },
    });
    return id;
  }

  async complete(id: string, response: IdempotentResponse): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        responseStatus: response.status,
        responseSnapshot: (response.body ?? null) as never,
        completedAt: this.clock.now(),
      },
    });
  }

  async markRetryable(id: string): Promise<void> {
    await this.prisma.idempotencyRecord.updateMany({
      where: { id, status: 'IN_PROGRESS' },
      data: { status: 'FAILED_RETRYABLE' },
    });
  }

  /** Records a completed response outside any business transaction (routes without a DB mutation). */
  async commitStandalone(s: IdempotencyScope, response: IdempotentResponse): Promise<void> {
    try {
      await this.prisma.$transaction((tx) => this.commit(tx, s, response));
    } catch (error) {
      if (!isUniqueViolation(error, 'uq_idem')) throw error;
    }
  }
}

export function isIdempotencyConflict(error: unknown): boolean {
  return isUniqueViolation(error, 'uq_idem');
}
