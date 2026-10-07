import type { PrismaClient } from '../client';
import type { Tx } from '../tx';

/** Exact anti-join, rather than a high-water mark: retries and late commits cannot be skipped. */
export async function pendingTimelineEventIds(
  prisma: PrismaClient | Tx,
  tenantId: string,
  version: number,
  limit = 100,
) {
  return prisma.$queryRawUnsafe<Array<{ id: string; occurredAt: Date }>>(
    `SELECT e.id, e.occurred_at AS occurredAt FROM outbox_events e
       WHERE e.tenant_id = ? AND NOT EXISTS (
         SELECT 1 FROM timeline_projection_receipts r WHERE r.tenant_id = e.tenant_id
           AND r.source_event_id = e.id AND r.projection_version = ?)
       ORDER BY e.occurred_at, e.id LIMIT ?`,
    tenantId,
    version,
    limit,
  );
}
export async function pendingTimelineTenants(prisma: PrismaClient, version: number, limit = 100) {
  const rows = await prisma.$queryRawUnsafe<Array<{ tenantId: string }>>(
    `SELECT DISTINCT e.tenant_id AS tenantId FROM outbox_events e
       WHERE e.tenant_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM timeline_projection_receipts r WHERE r.tenant_id = e.tenant_id
           AND r.source_event_id = e.id AND r.projection_version = ?)
       ORDER BY e.tenant_id LIMIT ?`,
    version,
    limit,
  );
  return rows.map((r) => r.tenantId);
}

/** Tenant bootstrap jobs are idempotent, including after a process restart. */
export async function timelineBootstrapTenants(prisma: PrismaClient, version: number, limit = 100) {
  const rows = await prisma.$queryRawUnsafe<Array<{ tenantId: string }>>(
    `SELECT t.id AS tenantId FROM tenants t WHERE NOT EXISTS (
      SELECT 1 FROM jobs j WHERE j.queue = 'timeline'
        AND j.idempotency_key = CONCAT('BackfillTimelineSources:', t.id, ':v', ?))
      ORDER BY t.id LIMIT ?`,
    version,
    limit,
  );
  return rows.map((r) => r.tenantId);
}
