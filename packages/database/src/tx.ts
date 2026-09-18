import { AppError } from '@hmedic/kernel';
import { Prisma, type PrismaClient } from './client';
import { dbErrorInfo, isRetryableLockError } from './errors';

export type Tx = Prisma.TransactionClient;

export interface TransactionOptions {
  isolation?: 'ReadCommitted' | 'RepeatableRead';
  timeoutMs?: number;
  maxWaitMs?: number;
  /** Retries after 1205 lock-wait / 1213 deadlock (DB_TX_RETRY_MAX, default 3). */
  retries?: number;
  /** Queue contexts map exhaustion to QUEUE_BUSY; everything else to CONCURRENCY_RETRY_EXHAUSTED. */
  exhaustedCode?: 'QUEUE_BUSY' | 'CONCURRENCY_RETRY_EXHAUSTED';
  context?: string;
  onRetry?: (info: { attempt: number; errno: number | null; context: string }) => void;
  onExhausted?: (info: { errno: number | null; context: string }) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` in one database transaction (DATABASE-IMPLEMENTATION.md §1.4). READ COMMITTED by default;
 * lock-wait timeouts and deadlocks are retried with jittered backoff, then mapped to a 503 AppError.
 */
export async function withTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const context = options.context ?? 'default';
  const isolationLevel =
    options.isolation === 'RepeatableRead'
      ? Prisma.TransactionIsolationLevel.RepeatableRead
      : Prisma.TransactionIsolationLevel.ReadCommitted;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel,
        timeout: options.timeoutMs ?? 15_000,
        maxWait: options.maxWaitMs ?? 5_000,
      });
    } catch (error) {
      if (!isRetryableLockError(error)) throw error;
      const { errno } = dbErrorInfo(error);
      if (attempt >= retries) {
        options.onExhausted?.({ errno, context });
        throw new AppError(options.exhaustedCode ?? 'CONCURRENCY_RETRY_EXHAUSTED', undefined, {
          retryAfterSeconds: 1,
          cause: error,
        });
      }
      options.onRetry?.({ attempt: attempt + 1, errno, context });
      await sleep(25 * 2 ** attempt * (0.5 + Math.random() / 2));
    }
  }
}
