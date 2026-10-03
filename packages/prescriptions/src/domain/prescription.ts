import { createHash } from 'node:crypto';

/**
 * The prescription lifecycle and the approved snapshot (PRESCRIPTION-IMPLEMENTATION.md §1).
 *
 * Pure: no database, no clock, no actor. The transition table and the snapshot are the two things that
 * decide whether a prescription can be trusted, so they are the two things that must be testable without
 * standing anything up.
 *
 * Nothing here suggests a dose, a frequency, a duration or a substitution. Stage 7 does no clinical
 * decision support, and this file is where such a thing would try to creep in first.
 */
export const CLINICAL_STATUSES = ['DRAFT', 'REVIEWED', 'APPROVED', 'VOID'] as const;
export const RENDER_STATUSES = ['NOT_REQUESTED', 'QUEUED', 'RENDERING', 'AVAILABLE', 'FAILED'] as const;

export type ClinicalStatus = (typeof CLINICAL_STATUSES)[number];
export type RenderStatus = (typeof RENDER_STATUSES)[number];

/** Statuses whose items may still be changed. Everything else is a historical record. */
export const EDITABLE_STATUSES: ReadonlySet<ClinicalStatus> = new Set(['DRAFT', 'REVIEWED']);

/** Statuses that are final clinical truth, and therefore renderable. */
export const FINAL_STATUSES: ReadonlySet<ClinicalStatus> = new Set(['APPROVED', 'VOID']);

/**
 * Every transition the lifecycle permits.
 *
 * `REVIEWED → DRAFT` is here because editing an item invalidates the review: "someone checked these
 * items" stops being true the moment the items change, and silently keeping the marker would be a claim
 * nobody made. The service applies it automatically rather than asking the editor to remember.
 *
 * There is no path out of `VOID` and none out of `APPROVED` except to `VOID`. A mistake in an approved
 * prescription is answered by a new revision that supersedes it, never by editing what was handed over.
 */
const TRANSITIONS: Readonly<Record<ClinicalStatus, readonly ClinicalStatus[]>> = {
  DRAFT: ['REVIEWED', 'APPROVED'],
  REVIEWED: ['DRAFT', 'APPROVED'],
  APPROVED: ['VOID'],
  VOID: [],
};

export function canTransition(from: ClinicalStatus, to: ClinicalStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Items may only change while the parent is a draft or a review. */
export function itemsEditable(status: ClinicalStatus): boolean {
  return EDITABLE_STATUSES.has(status);
}

/** Editing items in `REVIEWED` drops it back to `DRAFT`; in `DRAFT` it stays put. */
export function statusAfterItemEdit(status: ClinicalStatus): ClinicalStatus {
  return status === 'REVIEWED' ? 'DRAFT' : status;
}

/**
 * What the catalog contributed to an item, frozen at selection time.
 *
 * A `type` rather than an `interface`, because only type aliases get an implicit index signature and
 * Prisma's `InputJsonValue` refuses the shape without one.
 */
export type CatalogItemSnapshot = {
  brandName: string;
  brandNameBn: string | null;
  genericDisplay: string;
  strengthText: string | null;
  dosageForm: string;
  manufacturerDisplay: string;
  /** `UNVERIFIED` for the current dataset — carried so a reader knows what they are looking at. */
  reviewStatus: string;
  dgdaMatch: string;
};

/**
 * One prescribed line as it is stored.
 *
 * `dose`, `frequency` and `duration` are required and always come from the prescriber. The catalog
 * prefills only `strength` and `dosageForm` text, and even those are editable — a product's packaged
 * strength is not automatically the strength being prescribed.
 */
export interface PrescriptionItemInput {
  sequence: number;
  medicationId: string | null;
  medicationDatasetVersion: string | null;
  catalogSnapshot: CatalogItemSnapshot | null;
  freeTextName: string | null;
  isFreeText: boolean;
  strength: string | null;
  dosageForm: string | null;
  route: string | null;
  dose: string;
  frequency: string;
  duration: string;
  quantity: string | null;
  timing: string | null;
  instructions: string | null;
  instructionsBn: string | null;
  substitutionAllowed: boolean;
}

export const MAX_ITEMS = 50;
const LIMITS: Readonly<Record<string, number>> = {
  dose: 80,
  frequency: 80,
  duration: 80,
  strength: 120,
  dosageForm: 40,
  route: 24,
  quantity: 40,
  timing: 80,
  instructions: 500,
  instructionsBn: 500,
  freeTextName: 200,
};

export interface ItemProblem {
  sequence: number;
  field: string;
  code: string;
}

/**
 * Validates the item list the way the database would, but with a field name attached.
 *
 * The CHECK constraints are the real guarantee and they stay; this exists so a prescriber gets "dose is
 * required on line 2" instead of a constraint violation. Where the two could disagree, the database
 * wins — which is why every rule here has a constraint behind it.
 */
export function validateItems(items: readonly PrescriptionItemInput[]): ItemProblem[] {
  const problems: ItemProblem[] = [];
  if (items.length > MAX_ITEMS) {
    problems.push({ sequence: 0, field: 'items', code: 'too_many_items' });
  }

  const seen = new Set<number>();
  for (const item of items) {
    const at = (field: string, code: string) => problems.push({ sequence: item.sequence, field, code });

    if (!Number.isInteger(item.sequence) || item.sequence < 1) at('sequence', 'invalid_sequence');
    if (seen.has(item.sequence)) at('sequence', 'duplicate_sequence');
    seen.add(item.sequence);

    // Catalog line or free text, never both and never neither.
    if (item.isFreeText) {
      if (!item.freeTextName?.trim()) at('freeTextName', 'required');
      if (item.medicationId) at('medicationId', 'not_allowed_for_free_text');
    } else {
      if (!item.medicationId) at('medicationId', 'required');
      if (item.freeTextName) at('freeTextName', 'not_allowed_for_catalog_item');
      // Without the version, a later import silently changes what this line meant.
      if (!item.medicationDatasetVersion) at('medicationDatasetVersion', 'required');
    }

    for (const field of ['dose', 'frequency', 'duration'] as const) {
      if (!item[field]?.trim()) at(field, 'required');
    }

    for (const [field, max] of Object.entries(LIMITS)) {
      const value = (item as unknown as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.length > max) at(field, 'too_long');
    }
  }
  return problems;
}

/** The header fields the approved snapshot covers. */
export interface SnapshotHeader {
  patientId: string;
  encounterId: string;
  doctorProfileId: string;
  revision: number;
  attestationVersion: number;
}

/**
 * The hash frozen into an approved prescription.
 *
 * It covers the header and every item, in sequence order, field by field. It does **not** cover the
 * approver, the approval time or the row version: those live in the row, and keeping them out means two
 * revisions with identical clinical content hash identically — which is how "this correction changed the
 * instructions, not the medicines" becomes checkable rather than claimed.
 *
 * Every field is listed explicitly rather than serialising the object. A field added to the table later
 * would otherwise start or stop being covered depending on how it was fetched, and a hash whose input
 * depends on a query shape is not a hash anybody can verify twice.
 */
export function approvedSnapshotSha256(
  header: SnapshotHeader,
  items: readonly PrescriptionItemInput[],
): string {
  const canonical = {
    header: {
      patientId: header.patientId,
      encounterId: header.encounterId,
      doctorProfileId: header.doctorProfileId,
      revision: header.revision,
      attestationVersion: header.attestationVersion,
    },
    items: [...items]
      .sort((a, b) => a.sequence - b.sequence)
      .map((i) => ({
        sequence: i.sequence,
        medicationId: i.medicationId,
        medicationDatasetVersion: i.medicationDatasetVersion,
        catalogSnapshot: i.catalogSnapshot,
        freeTextName: i.freeTextName,
        isFreeText: i.isFreeText,
        strength: i.strength,
        dosageForm: i.dosageForm,
        route: i.route,
        dose: i.dose,
        frequency: i.frequency,
        duration: i.duration,
        quantity: i.quantity,
        timing: i.timing,
        instructions: i.instructions,
        instructionsBn: i.instructionsBn,
        substitutionAllowed: i.substitutionAllowed,
      })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** The attestation text version a doctor approves under. Bumped when the wording changes. */
export const ATTESTATION_VERSION = 1;
