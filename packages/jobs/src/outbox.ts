import { type Clock, type EventEnvelope, findDeniedPayloadKeys, newId, systemClock } from '@hmedic/kernel';
import { type OutboxRow, type PrismaClient, type Tx, publishOutboxBatch } from '@hmedic/database';
import type { Metrics } from '@hmedic/observability';
import { DEFAULT_MAX_ATTEMPTS, type JobRegistry } from './job-types';
import { JobPayloadError } from './errors';

/**
 * Outbox (EVENT-ARCHITECTURE.md §3). Domain events are written in the same transaction as the change;
 * the publisher maps each event to one job per subscribed handler (idempotency key `<eventId>:<handler>`)
 * and marks it published in one transaction.
 */
export interface Subscription {
  /** Job type that handles the event. */
  handler: string;
  /** Per-aggregate ordering: concurrency key `<handler>:<aggregateType>:<aggregateId>` with limit 1. */
  orderedByAggregate?: boolean;
}

export class SubscriptionRegistry {
  private readonly map = new Map<string, Subscription[]>();

  subscribe(eventName: string, subscription: Subscription): this {
    const list = this.map.get(eventName) ?? [];
    if (list.some((s) => s.handler === subscription.handler)) {
      throw new Error(`${subscription.handler} already subscribed to ${eventName}`);
    }
    list.push(subscription);
    this.map.set(eventName, list);
    return this;
  }

  for(eventName: string): readonly Subscription[] {
    return this.map.get(eventName) ?? [];
  }

  entries(): Array<[string, readonly Subscription[]]> {
    return [...this.map.entries()];
  }
}

export type DomainEvent = Omit<EventEnvelope, 'eventId' | 'occurredAt'> & {
  eventId?: string;
  occurredAt?: Date;
};

/** Appends events inside the caller's transaction. Payloads must be id/enum-only. */
export class OutboxPort {
  constructor(private readonly clock: Clock = systemClock) {}

  async append(tx: Tx, event: DomainEvent): Promise<string> {
    const denied = findDeniedPayloadKeys(event.payload);
    if (denied.length)
      throw new JobPayloadError(denied.map((k) => `${k}: PHI/secret field not allowed in event payloads`));
    const id = event.eventId ?? newId();
    await tx.outboxEvent.create({
      data: {
        id,
        tenantId: event.tenantId,
        eventName: event.eventName,
        eventVersion: event.eventVersion,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload as never,
        occurredAt: event.occurredAt ?? this.clock.now(),
        correlationId: event.correlationId,
        causationId: event.causationId,
        actorUserId: event.actorId,
        idempotencyKey: event.idempotencyKey,
        status: 'PENDING',
      },
    });
    return id;
  }
}

export class OutboxPublisher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: JobRegistry,
    private readonly subscriptions: SubscriptionRegistry,
    private readonly options: {
      strategy: 'skip_locked' | 'conditional_update';
      clock?: Clock;
      metrics?: Metrics;
    },
  ) {}

  private async publish(tx: Tx, events: OutboxRow[]): Promise<void> {
    const now = (this.options.clock ?? systemClock).now();
    const rows = events.flatMap((event) =>
      this.subscriptions.for(event.eventName).map((sub) => {
        const def = this.registry.require(sub.handler);
        return {
          id: newId(),
          tenantId: event.tenantId,
          queue: def.queue,
          type: def.type,
          payload: {
            v: 1,
            eventId: event.id,
            eventType: event.eventName,
            aggregateId: event.aggregateId,
          } as never,
          status: 'QUEUED',
          priority: def.priority ?? 100,
          runAt: now,
          attempts: 0,
          maxAttempts: def.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          concurrencyKey: sub.orderedByAggregate
            ? `${sub.handler}:${event.aggregateType}:${event.aggregateId}`.slice(0, 128)
            : null,
          idempotencyKey: `${event.id}:${sub.handler}`,
          correlationId: event.correlationId,
          causationId: event.id,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );
    if (rows.length) await tx.job.createMany({ data: rows, skipDuplicates: true });
  }

  async publishBatch(limit = 50): Promise<number> {
    const clock = this.options.clock ?? systemClock;
    const n = await publishOutboxBatch(
      this.prisma,
      limit,
      clock.now(),
      (tx, events) => this.publish(tx, events),
      this.options.strategy,
    );
    return n;
  }
}
