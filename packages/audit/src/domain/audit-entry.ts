/**
 * Audit entry (DATABASE-IMPLEMENTATION.md §3.2 `audit_logs`). Metadata carries ids, enums and counts only:
 * never secrets, never PHI values (SECURITY-IMPLEMENTATION.md T5/T22).
 */
export type AuditActorType = 'USER' | 'SYSTEM' | 'PATIENT_CONTEXT' | 'OPERATOR';
export type AuditOutcome = 'SUCCESS' | 'DENIED' | 'FAILED';
export type AuditMetadataValue = string | number | boolean | null | ReadonlyArray<string | number | boolean>;
export type AuditMetadata = Readonly<Record<string, AuditMetadataValue>>;

export interface AuditEntry {
  /** null → platform chain. */
  tenantId: string | null;
  actorUserId: string | null;
  actorType: AuditActorType;
  actingAs?: 'SELF' | 'GUARDIAN' | null;
  onBehalfOfPatientId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: AuditOutcome;
  requestId?: string | null;
  correlationId?: string | null;
  ipHash?: string | null;
  userAgentHash?: string | null;
  metadata?: AuditMetadata;
  rolePermissionsVersion?: number | null;
  occurredAt?: Date;
}

export interface AuditAppended {
  id: string;
  chainKey: string;
  seq: bigint;
  rowHash: string;
}

/** `audit_logs.chain_key` (`tenant:<id>` or `platform`). */
export function auditChainKey(tenantId: string | null): string {
  return tenantId ? `tenant:${tenantId}` : 'platform';
}

/** `integrity_chain_checkpoints.chain_key` for an audit chain (`audit:tenant:<id>` / `audit:platform`). */
export function auditCheckpointKey(chainKey: string): string {
  return `audit:${chainKey}`;
}

export const AUDIT_ACTION_RE = /^[A-Z][A-Z0-9_]{2,95}$/;
export const MAX_METADATA_BYTES = 4096;

/** Security event actions (SECURITY-IMPLEMENTATION.md §3) used by Stage 4 code. */
export const SECURITY_ACTIONS = {
  INTEGRITY_CHAIN_BROKEN: 'INTEGRITY_CHAIN_BROKEN',
  INTERNAL_TOKEN_REJECTED: 'INTERNAL_TOKEN_REJECTED',
  RATE_LIMIT_TRIPPED: 'RATE_LIMIT_TRIPPED',
  REFRESH_REUSE: 'REFRESH_REUSE',
  CROSS_TENANT_ATTEMPT: 'CROSS_TENANT_ATTEMPT',
  MIGRATION_APPLIED: 'MIGRATION_APPLIED',
} as const;
