import type { AuditAppended, AuditEntry } from '../domain/audit-entry';

/**
 * AuditPort (MODULE-BOUNDARIES.md): appends in the caller's transaction so the audit row exists iff the
 * audited change committed. `TTx` is the persistence transaction handle (opaque to application code).
 */
export interface AuditPort<TTx = unknown> {
  append(tx: TTx, entry: AuditEntry): Promise<AuditAppended>;
}

export interface AuditRecord {
  id: string;
  tenantId: string | null;
  seq: bigint;
  actorUserId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  correlationId: string | null;
  metadata: unknown;
  occurredAt: Date;
}

/** Read-only queries (append-only: no update/delete method exists on any audit repository). */
export interface AuditReadPort {
  listForResource(
    tenantId: string,
    resourceType: string,
    resourceId: string,
    limit?: number,
  ): Promise<AuditRecord[]>;
  listForActor(tenantId: string, actorUserId: string, limit?: number): Promise<AuditRecord[]>;
}

export interface ChainBreak {
  checkpointKey: string;
  seq: bigint;
  reason: 'HASH_MISMATCH' | 'PREV_HASH_MISMATCH' | 'SEQ_GAP' | 'HEAD_MISMATCH' | 'ANCHOR_MISSING';
}

export interface ChainVerification {
  checkpointKey: string;
  ok: boolean;
  verifiedFrom: bigint;
  verifiedThrough: bigint;
  rows: number;
  break?: ChainBreak;
}
