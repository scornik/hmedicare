import { type Clock, newId, systemClock } from '@hmedic/kernel';
import type { PrismaClient, Tx } from '@hmedic/database';
import { redact } from '@hmedic/observability';
import {
  AUDIT_ACTION_RE,
  type AuditAppended,
  type AuditEntry,
  type AuditMetadata,
  MAX_METADATA_BYTES,
  auditChainKey,
  auditCheckpointKey,
} from '../domain/audit-entry';
import type { AuditPort, AuditReadPort, AuditRecord } from '../application/ports';
import { ChainAppender } from './chain-appender';

/** Row fields covered by `row_hash` (every column except `prev_row_hash` and `row_hash`). */
export interface AuditHashedRow {
  id: string;
  tenantId: string | null;
  seq: bigint;
  chainKey: string;
  actorUserId: string | null;
  actorType: string;
  actingAs: string | null;
  onBehalfOfPatientId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  requestId: string | null;
  correlationId: string | null;
  ipHash: string | null;
  userAgentHash: string | null;
  metadata: unknown;
  rolePermissionsVersion: number | null;
  occurredAt: Date;
}

export function auditHashInput(row: AuditHashedRow): AuditHashedRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    seq: row.seq,
    chainKey: row.chainKey,
    actorUserId: row.actorUserId,
    actorType: row.actorType,
    actingAs: row.actingAs,
    onBehalfOfPatientId: row.onBehalfOfPatientId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    outcome: row.outcome,
    requestId: row.requestId,
    correlationId: row.correlationId,
    ipHash: row.ipHash,
    userAgentHash: row.userAgentHash,
    metadata: row.metadata,
    rolePermissionsVersion: row.rolePermissionsVersion,
    occurredAt: row.occurredAt,
  };
}

export class AuditMetadataError extends Error {
  constructor(problem: string) {
    super(`audit metadata rejected: ${problem}`);
    this.name = 'AuditMetadataError';
  }
}

/**
 * Metadata must be flat (primitives or arrays of primitives); it passes the log redactor so secret keys
 * and PHI-like values never reach `audit_logs`, and is capped in size.
 */
export function sanitizeAuditMetadata(metadata: AuditMetadata | undefined): Record<string, unknown> {
  if (!metadata) return {};
  if (Buffer.byteLength(JSON.stringify(metadata)) > MAX_METADATA_BYTES)
    throw new AuditMetadataError('too large');
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) throw new AuditMetadataError('invalid key');
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) {
        throw new AuditMetadataError(`${key} must be a primitive or an array of primitives`);
      }
    }
  }
  const clean = JSON.parse(JSON.stringify(redact(metadata))) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(clean)) > MAX_METADATA_BYTES)
    throw new AuditMetadataError('too large');
  return clean;
}

export class PrismaAuditPort implements AuditPort<Tx> {
  private readonly appender = new ChainAppender();

  constructor(private readonly clock: Clock = systemClock) {}

  async append(tx: Tx, entry: AuditEntry): Promise<AuditAppended> {
    if (!AUDIT_ACTION_RE.test(entry.action)) throw new AuditMetadataError('invalid action');
    const now = this.clock.now();
    const chainKey = auditChainKey(entry.tenantId);
    const base = {
      id: newId(),
      tenantId: entry.tenantId,
      chainKey,
      actorUserId: entry.actorUserId,
      actorType: entry.actorType,
      actingAs: entry.actingAs ?? null,
      onBehalfOfPatientId: entry.onBehalfOfPatientId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      outcome: entry.outcome,
      requestId: entry.requestId ?? null,
      correlationId: entry.correlationId ?? null,
      ipHash: entry.ipHash ?? null,
      userAgentHash: entry.userAgentHash ?? null,
      metadata: sanitizeAuditMetadata(entry.metadata),
      rolePermissionsVersion: entry.rolePermissionsVersion ?? null,
      // DATETIME(3): hash exactly what is stored.
      occurredAt: new Date(Math.floor((entry.occurredAt ?? now).getTime())),
    };
    const { slot, rowHash } = await this.appender.append(
      tx,
      auditCheckpointKey(chainKey),
      now,
      (s) => auditHashInput({ ...base, seq: s.seq }),
      (s, hash) =>
        tx.auditLog.create({
          data: {
            ...base,
            metadata: base.metadata as never,
            seq: s.seq,
            prevRowHash: s.prevRowHash,
            rowHash: hash,
          },
        }),
    );
    return { id: base.id, chainKey, seq: slot.seq, rowHash };
  }
}

/** Read-only audit repository: exposes no mutating method (append-only test asserts this). */
export class PrismaAuditReader implements AuditReadPort {
  constructor(private readonly prisma: PrismaClient) {}

  private static readonly select = {
    id: true,
    tenantId: true,
    seq: true,
    actorUserId: true,
    actorType: true,
    action: true,
    resourceType: true,
    resourceId: true,
    outcome: true,
    correlationId: true,
    metadata: true,
    occurredAt: true,
  } as const;

  listForResource(
    tenantId: string,
    resourceType: string,
    resourceId: string,
    limit = 50,
  ): Promise<AuditRecord[]> {
    return this.prisma.auditLog.findMany({
      where: { tenantId, resourceType, resourceId },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(limit, 200),
      select: PrismaAuditReader.select,
    });
  }

  listForActor(tenantId: string, actorUserId: string, limit = 50): Promise<AuditRecord[]> {
    return this.prisma.auditLog.findMany({
      where: { tenantId, actorUserId },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(limit, 200),
      select: PrismaAuditReader.select,
    });
  }
}
