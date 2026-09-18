import type { z } from 'zod';

/**
 * Job type registry (ADR-015 §1, §6). Every job type declares its queue, versioned payload schema,
 * retry policy and lease. Payloads carry ids and enums only (deny-list enforced on enqueue).
 */
export interface JobTypeDefinition<P = unknown> {
  readonly type: string;
  readonly queue: string;
  /** Zod schema for `payload`; must include `v` (payload version). */
  readonly payloadSchema: z.ZodType<P>;
  readonly maxAttempts?: number;
  readonly leaseSeconds?: number;
  readonly backoff?: { baseMs: number; maxMs: number };
  /** Max RUNNING jobs per concurrency key (default 1). */
  readonly concurrencyLimit?: number;
  readonly priority?: number;
}

export const DEFAULT_MAX_ATTEMPTS = 8;
export const DEFAULT_LEASE_SECONDS = 120;
export const DEFAULT_BACKOFF = { baseMs: 5_000, maxMs: 30 * 60_000 };

export class JobRegistry {
  private readonly types = new Map<string, JobTypeDefinition>();

  register<P>(def: JobTypeDefinition<P>): this {
    if (this.types.has(def.type)) throw new Error(`job type ${def.type} registered twice`);
    this.types.set(def.type, def as JobTypeDefinition);
    return this;
  }

  get(type: string): JobTypeDefinition | undefined {
    return this.types.get(type);
  }

  require(type: string): JobTypeDefinition {
    const def = this.types.get(type);
    if (!def) throw new Error(`unknown job type ${type}`);
    return def;
  }

  queues(): string[] {
    return [...new Set([...this.types.values()].map((d) => d.queue))].sort();
  }

  all(): JobTypeDefinition[] {
    return [...this.types.values()];
  }
}

/** Backoff: min(maxDelay, base × 2^(attempts−1)) × random(0.5, 1.0) (ADR-015 §3). */
export function backoffDelayMs(
  attempts: number,
  policy: { baseMs: number; maxMs: number } = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** Math.max(0, attempts - 1));
  return Math.round(exp * (0.5 + random() / 2));
}
