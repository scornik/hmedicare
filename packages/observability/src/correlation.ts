import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac } from 'node:crypto';

/**
 * Request/job correlation (OBSERVABILITY.md §1). Bound into every log line by the logger mixin.
 * Tenant and actor ids are logged only as HMACs with LOG_HASH_PEPPER.
 */
export interface LogContext {
  requestId?: string;
  jobId?: string;
  correlationId?: string;
  tenantHash?: string;
  actorHash?: string;
  route?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run({ ...context }, fn);
}

export function currentLogContext(): LogContext | undefined {
  return storage.getStore();
}

/** Mutates the current context (e.g. after authentication resolves the tenant). */
export function enrichLogContext(patch: Partial<LogContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}

export function hashForLog(value: string, pepper: string): string {
  return createHmac('sha256', pepper).update(value).digest('hex').slice(0, 16);
}
