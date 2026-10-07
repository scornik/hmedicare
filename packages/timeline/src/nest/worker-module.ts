import { z } from 'zod';
import { type PrismaClient, pendingTimelineTenants, timelineBootstrapTenants } from '@hmedic/database';
import { type Clock, newId, systemClock } from '@hmedic/kernel';
import {
  JobPort,
  type JobRegistry,
  type JobRunner,
  type PeriodicJob,
  type SubscriptionRegistry,
  NonRetryableJobError,
} from '@hmedic/jobs';
import type { Logger } from '@hmedic/observability';
import { ClinicalHistoryMetadata } from '@hmedic/clinical';
import { PrescriptionHistoryMetadata } from '@hmedic/prescriptions';
import { QueueHistoryMetadata } from '@hmedic/queue';
import { SchedulingHistoryMetadata } from '@hmedic/scheduling';
import { DocumentHistoryMetadata } from '@hmedic/laboratory-documents';
import { TimelineProjector, TIMELINE_EVENT_NAMES } from '../infrastructure/projector';
import type { HistoryMetadataPort } from '../application/history-port';

export const PROJECT_TIMELINE_EVENT = 'ProjectTimelineEvent';
export const PROJECT_TIMELINE_BACKLOG = 'ProjectTimelineBacklog';
export const BACKFILL_TIMELINE_SOURCES = 'BackfillTimelineSources';
const EventPayload = z.object({
  v: z.literal(1),
  eventId: z.string().uuid(),
  eventType: z.string(),
  aggregateId: z.string().uuid(),
});
const PagePayload = z.object({
  v: z.literal(1),
  tenantId: z.string().uuid(),
  projectionVersion: z.number().int().min(1).max(32767),
  kind: z.string().regex(/^[a-z_]+$/),
  afterId: z.string().uuid().nullable(),
});

export function createTimelineProjector(prisma: PrismaClient, version: number, clock: Clock = systemClock) {
  const sources: HistoryMetadataPort[] = [
    new ClinicalHistoryMetadata(prisma),
    new PrescriptionHistoryMetadata(prisma),
    new QueueHistoryMetadata(prisma),
    new SchedulingHistoryMetadata(prisma),
    new DocumentHistoryMetadata(prisma),
  ];
  return {
    projector: new TimelineProjector(prisma, sources, version, clock),
    kinds: sources.flatMap((s) => s.kinds),
  };
}
export function registerTimelineJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  subscriptions: SubscriptionRegistry,
  deps: { prisma: PrismaClient; version: number; clock?: Clock; logger?: Logger },
): PeriodicJob[] {
  const { projector, kinds } = createTimelineProjector(deps.prisma, deps.version, deps.clock);
  registry.register({
    type: PROJECT_TIMELINE_EVENT,
    queue: 'timeline',
    payloadSchema: EventPayload,
    leaseSeconds: 120,
    priority: 200,
  });
  registry.register({
    type: PROJECT_TIMELINE_BACKLOG,
    queue: 'timeline',
    payloadSchema: z.object({ v: z.literal(1), window: z.number().int() }),
    priority: 400,
    leaseSeconds: 120,
  });
  registry.register({
    type: BACKFILL_TIMELINE_SOURCES,
    queue: 'timeline',
    payloadSchema: PagePayload,
    priority: 700,
    leaseSeconds: 120,
  });
  for (const eventName of TIMELINE_EVENT_NAMES)
    subscriptions.subscribe(eventName, { handler: PROJECT_TIMELINE_EVENT, orderedByAggregate: true });
  const jobs = new JobPort(deps.prisma, registry, deps.clock ?? systemClock);
  runner?.handle(PROJECT_TIMELINE_EVENT, async (ctx) => {
    const p = EventPayload.parse(ctx.payload);
    if (!ctx.tenantId) throw new NonRetryableJobError('TIMELINE_TENANT_REQUIRED');
    ctx.signal.throwIfAborted();
    await projector.projectEvent(ctx.tenantId, p.eventId);
  });
  runner?.handle(BACKFILL_TIMELINE_SOURCES, async (ctx) => {
    const p = PagePayload.parse(ctx.payload);
    if (ctx.tenantId !== p.tenantId) throw new NonRetryableJobError('TIMELINE_TENANT_MISMATCH');
    const { nextCursor } = await projector.backfillPage(
      p.tenantId,
      p.kind,
      p.afterId,
      p.projectionVersion,
      ctx.signal,
    );
    const nextKind = nextCursor ? p.kind : kinds[kinds.indexOf(p.kind) + 1];
    if (nextKind)
      await jobs.enqueue({
        type: BACKFILL_TIMELINE_SOURCES,
        tenantId: p.tenantId,
        payload: { ...p, kind: nextKind, afterId: nextCursor },
        correlationId: ctx.correlationId,
        idempotencyKey: `${BACKFILL_TIMELINE_SOURCES}:${p.tenantId}:v${p.projectionVersion}:${nextKind}:${nextCursor ?? 'start'}`,
      });
  });
  runner?.handle(PROJECT_TIMELINE_BACKLOG, async (ctx) => {
    const deadline = Date.now() + 10_000;
    // Bootstrap is source-based: patients older than retained outbox events are included too.
    for (const tenantId of await timelineBootstrapTenants(deps.prisma, deps.version, 25)) {
      ctx.signal.throwIfAborted();
      await jobs.enqueue({
        type: BACKFILL_TIMELINE_SOURCES,
        tenantId,
        payload: { v: 1, tenantId, projectionVersion: deps.version, kind: kinds[0]!, afterId: null },
        correlationId: newId(),
        idempotencyKey: `${BACKFILL_TIMELINE_SOURCES}:${tenantId}:v${deps.version}`,
      });
      if (Date.now() > deadline) return;
    }
    let failed = false;
    for (const tenantId of await pendingTimelineTenants(deps.prisma, deps.version, 100)) {
      ctx.signal.throwIfAborted();
      try {
        await projector.catchUp(tenantId, 3, deps.version, ctx.signal);
      } catch {
        failed = true;
        deps.logger?.warn({ tenantId }, 'timeline catch-up blocked; unacknowledged events retained');
      }
      if (Date.now() > deadline) break;
    }
    if (failed) throw new Error('timeline catch-up incomplete');
  });
  return [{ type: PROJECT_TIMELINE_BACKLOG, everyMs: 60_000 }];
}
