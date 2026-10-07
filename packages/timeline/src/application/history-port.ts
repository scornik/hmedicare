/** Metadata only: source owners never expose clinical text to the projector. */
export interface HistoryReference {
  sourceType: string;
  sourceId: string;
  aggregateId: string;
  eventName: string;
  patientId: string;
  occurredAt: Date;
  visibility: 'CLINICAL' | 'PATIENT_SHARED' | 'OPERATIONAL';
  encounterId?: string;
  eventCode?: string;
  redactedAt?: Date | null;
  redactionReason?: 'ENTERED_IN_ERROR' | 'DOCUMENT_REDACTED' | 'VOIDED';
}
export interface HistoryMetadataPort {
  readonly kinds: readonly string[];
  read(tenantId: string, kind: string, id: string): Promise<HistoryReference[]>;
  ids(tenantId: string, kind: string, afterId: string | null, limit: number): Promise<string[]>;
  /** Distinguish an intentionally excluded document from an unresolved source. */
  exists?(tenantId: string, kind: string, id: string): Promise<boolean>;
  /** Queue events before the new source identifier was added to their outbox payload. */
  legacyQueueId?(
    tenantId: string,
    serialId: string,
    eventName: string,
    occurredAt: Date,
  ): Promise<string | null>;
}
