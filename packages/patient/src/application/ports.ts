import type { TenantContext } from '@hmedic/kernel';

/** Staff actor for patient use cases: a membership-backed tenant context plus request correlation. */
export interface PatientActor {
  userId: string;
  tenant: TenantContext;
  requestId?: string;
  correlationId?: string;
}

/**
 * Patient-context actor (AUTHORIZATION-MATRIX §4): a patient user acting for `patientId` in `tenantId`, as
 * SELF (patient account) or as a GUARDIAN with the listed authority scope. Resolved per request from
 * `X-Patient-Context`; never cached.
 */
export interface PatientContextActor {
  userId: string;
  tenantId: string;
  patientId: string;
  actingAs: 'SELF' | 'GUARDIAN';
  guardianshipId: string | null;
  authorityScope: ReadonlySet<string>;
  requestId?: string;
  correlationId?: string;
}

export const GUARDIAN_SCOPES = [
  'VIEW_RECORDS',
  'BOOK_APPOINTMENTS',
  'MANAGE_SERIALS',
  'JOIN_TELEMEDICINE',
  'UPLOAD_DOCUMENTS',
  'MANAGE_COMMUNICATION_PREFERENCES',
  'GIVE_CONSENT',
  'MAKE_PAYMENTS',
] as const;
export type GuardianScope = (typeof GUARDIAN_SCOPES)[number];

/** Minimum-necessary patient facts for other contexts (queue, scheduling). Never names or phones in events. */
export interface PatientFacts {
  id: string;
  tenantId: string;
  status: 'ACTIVE' | 'MERGED' | 'INACTIVE';
  mergedIntoPatientId: string | null;
  displayName: string;
  medicalRecordNumber: string;
}

export interface PatientReadPort {
  /** Resolves a patient in a tenant; a MERGED patient resolves to its target (audit C-47). */
  resolveActive(tenantId: string, patientId: string): Promise<PatientFacts | null>;
  /** Display facts for staff screens (queue lists). */
  factsByIds(tenantId: string, patientIds: readonly string[]): Promise<Map<string, PatientFacts>>;
}

/**
 * Merge re-pointing (audit C-47). Contexts owning patient references (scheduling: appointments; queue:
 * serials) register a repointer; `ApprovePatientMerge` calls every registered one inside the merge
 * transaction, after both patients are locked. Stage 5 CP3 has no references yet. `TTx` is the persistence
 * transaction handle (opaque to application code, as in AuditPort).
 */
export interface MergeReferenceRepointer<TTx = unknown> {
  readonly resource: string;
  /**
   * Re-points rows from `sourcePatientId` to `targetPatientId` and returns the ids moved. Throws
   * `DUPLICATE_ACTIVE_SERIAL` (or the resource's documented conflict) when both patients hold an
   * incompatible active reference.
   */
  repoint(tx: TTx, tenantId: string, sourcePatientId: string, targetPatientId: string): Promise<string[]>;
}

export class MergeRepointerRegistry<TTx = unknown> {
  private readonly items: MergeReferenceRepointer<TTx>[] = [];

  register(repointer: MergeReferenceRepointer<TTx>): this {
    if (this.items.some((r) => r.resource === repointer.resource)) {
      throw new Error(`merge repointer for ${repointer.resource} already registered`);
    }
    this.items.push(repointer);
    return this;
  }

  all(): readonly MergeReferenceRepointer<TTx>[] {
    return this.items;
  }
}
