import type { FastifyRequest } from 'fastify';
import type { Tx } from '@hmedic/database';
import type { IdempotencyStore } from '@hmedic/jobs';

/**
 * Completes the request's idempotency record inside the use case transaction (the stored response then
 * exists iff the change committed). No-op when the route has no idempotency key.
 */
export async function completeIdempotencyInTx(
  store: IdempotencyStore,
  request: FastifyRequest,
  tx: Tx,
  response: { status: number; body: unknown },
): Promise<void> {
  const handle = request.hm?.idempotency;
  if (!handle || handle.completedInTx) return;
  await store.completeInTx(tx, handle.recordId, response);
  handle.completedInTx = true;
}
