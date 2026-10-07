/** Redaction is scoped to the patient and version. An encounter marker also masks its descendants. */
export interface TimelineRedactionReference {
  tenantId: string;
  patientId: string;
  projectionVersion: number;
  eventType: string;
  sourceType: string;
  sourceId: string;
  structuredRefs: unknown;
}
export function isTimelineEntryRedacted(
  row: TimelineRedactionReference,
  markers: readonly TimelineRedactionReference[],
) {
  if (row.eventType === 'REDACTED') return false;
  const refs = row.structuredRefs;
  const encounterId = refs && typeof refs === 'object' && 'encounterId' in refs ? refs.encounterId : null;
  return markers.some(
    (marker) =>
      marker.eventType === 'REDACTED' &&
      marker.tenantId === row.tenantId &&
      marker.patientId === row.patientId &&
      marker.projectionVersion === row.projectionVersion &&
      ((marker.sourceType === row.sourceType && marker.sourceId === row.sourceId) ||
        (marker.sourceType === 'encounter' && marker.sourceId === encounterId)),
  );
}
