import { createHash } from 'node:crypto';
import { medicationSearchKey } from '@hmedic/localization';

/**
 * Mapping from the Stage M dataset to the catalog columns (ADR-020 §1), plus the two rules that decide
 * what never reaches the database at all.
 *
 * Pure functions, no database and no I/O, so the decisions that matter — is this veterinary, is this
 * price representable, what is this row's identity — can be tested against real dataset lines without a
 * container. They are also the parts most likely to be wrong in a way nobody notices.
 */

/** The dataset's provenanced value shape: `{value, sources, agreement_count}`. */
export interface Provenanced<T> {
  value: T;
  sources?: string[];
  agreement_count?: number;
  alternatives?: Array<{ value: T; sources?: string[] }>;
}

export interface MedicationRecord {
  id: string;
  record_key: string;
  brand_name: Provenanced<string>;
  brand_name_bn?: Provenanced<string>;
  generic_names: Provenanced<string[]>;
  salt_forms?: Provenanced<string[]> | string[];
  strength?: Provenanced<string>;
  strength_parsed?: unknown;
  dosage_form?: Provenanced<string>;
  dosage_form_raw?: string[];
  route?: Provenanced<string>;
  manufacturer?: Provenanced<string>;
  registration_number?: Provenanced<string>;
  monograph_urls?: string[];
  dgda_match?: string;
  source_ids?: string[];
  status?: string;
}

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Dosage forms the dataset card marks veterinary. Excluded by default
 * (`MEDICATION_IMPORT_EXCLUDE_VETERINARY`), because a human prescribing system offering a cattle bolus
 * is not a curiosity — it is a route to a mistake that the catalog invited.
 */
const VETERINARY_FORMS = new Set([
  'bolus_veterinary',
  'water_soluble_powder_veterinary',
  'pour_on_veterinary',
]);

/** True when this product is veterinary by form or by manufacturer marking (ADR-020 §2). */
export function isVeterinary(record: MedicationRecord): boolean {
  const form = record.dosage_form?.value;
  if (form && VETERINARY_FORMS.has(form)) return true;
  const names = [
    record.manufacturer?.value,
    ...(record.manufacturer?.alternatives ?? []).map((a) => a.value),
  ];
  return names.some((n) => typeof n === 'string' && n.includes('(Veterinary)'));
}

/**
 * A money value the catalog can hold exactly, or null.
 *
 * The dataset carries JSON numbers; the column is `DECIMAL(12,2)`. Rather than rounding — which would
 * invent a price nobody published — the shortest round-trip decimal string is checked against the shape
 * the column can store. Anything else is rejected and counted, so a price is either exactly what the
 * source said or absent, never approximately right.
 */
export function toMoney(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const s = String(value);
  return /^\d{1,10}(\.\d{1,2})?$/.test(s) ? s : null;
}

/** Generic names joined the way a combination product reads on a prescription. */
export function genericDisplay(names: readonly string[]): string {
  return names.join(' + ');
}

/** A stable key for the set of generics, so two products with the same ingredients sort together. */
export function genericSetKey(names: readonly string[]): string {
  return medicationSearchKey([...names].sort((a, b) => a.localeCompare(b)).join(' + '));
}

/**
 * Per-field provenance, bounded at 16 KB (DATABASE §3.8).
 *
 * What the importer believed and why: which sources agreed on each field. Truncated rather than dropped
 * when a row is unusually contested, because some provenance is more useful than none, and the bound is
 * what stops one pathological row from carrying a megabyte of JSON into every query that selects it.
 */
export function fieldProvenance(record: MedicationRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, raw] of Object.entries(record)) {
    const v = raw as Provenanced<unknown> | undefined;
    if (!v || typeof v !== 'object' || !('sources' in v)) continue;
    out[field] = { sources: v.sources ?? [], agreementCount: v.agreement_count ?? 0 };
  }
  if (Buffer.byteLength(JSON.stringify(out)) <= 16_384) return out;
  const trimmed: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(out)) {
    trimmed[field] = value;
    if (Buffer.byteLength(JSON.stringify(trimmed)) > 16_384) {
      delete trimmed[field];
      break;
    }
  }
  return { ...trimmed, _truncated: true };
}

export interface MappedMedication {
  canonicalKey: string;
  canonicalKeySha256: string;
  datasetRecordId: string;
  brandName: string;
  brandSearchKey: string;
  brandNameBn: string | null;
  brandBnSearchKey: string | null;
  genericDisplay: string;
  genericSetKey: string;
  genericNames: string[];
  strengthText: string | null;
  strengthParsed: unknown;
  dosageForm: string;
  dosageFormRaw: string[];
  route: string | null;
  manufacturerKey: string | null;
  manufacturerDisplay: string;
  registrationNumber: string | null;
  registrationAlternatives: unknown;
  dgdaMatch: string;
  reviewStatus: string;
  monographSourceUrl: string | null;
  sourceIds: string[];
  fieldProvenance: Record<string, unknown>;
}

const DGDA_MATCHES = new Set(['MATCHED', 'NOT_FOUND', 'AMBIGUOUS', 'NOT_CHECKED']);
const REVIEW_STATUSES = new Set(['UNVERIFIED', 'SAMPLED_REVIEWED', 'VERIFIED']);

/**
 * One dataset record to one catalog row (ADR-020 §1).
 *
 * `dosage_form` deliberately has no allowed list: the dataset's own vocabulary is authoritative, including
 * `unmapped`, and a form nobody anticipated must import as itself rather than be rejected or quietly
 * reshaped into something a prescriber would misread. `dgda_match` and `review_status` do have lists,
 * because the database enforces them and a value outside them would fail the insert with a constraint
 * error that says nothing about which record caused it.
 */
export function mapMedication(record: MedicationRecord): MappedMedication {
  const generics = record.generic_names?.value ?? [];
  const brand = record.brand_name.value;
  const brandBn = record.brand_name_bn?.value ?? null;
  const manufacturer = record.manufacturer?.value ?? null;
  const dgda = record.dgda_match ?? 'NOT_CHECKED';
  const review = record.status ?? 'UNVERIFIED';

  return {
    canonicalKey: record.record_key,
    canonicalKeySha256: sha256Hex(record.record_key),
    datasetRecordId: record.id,
    brandName: brand,
    brandSearchKey: medicationSearchKey(brand),
    brandNameBn: brandBn,
    brandBnSearchKey: brandBn ? medicationSearchKey(brandBn) : null,
    genericDisplay: genericDisplay(generics),
    genericSetKey: genericSetKey(generics),
    genericNames: generics,
    strengthText: record.strength?.value ?? null,
    strengthParsed: record.strength_parsed ?? {},
    dosageForm: record.dosage_form?.value ?? 'unmapped',
    dosageFormRaw: record.dosage_form_raw ?? [],
    route: record.route?.value ?? null,
    manufacturerKey: manufacturer ? medicationSearchKey(manufacturer) : null,
    manufacturerDisplay: manufacturer ?? '',
    registrationNumber: record.registration_number?.value ?? null,
    registrationAlternatives: record.registration_number?.alternatives ?? null,
    dgdaMatch: DGDA_MATCHES.has(dgda) ? dgda : 'NOT_CHECKED',
    reviewStatus: REVIEW_STATUSES.has(review) ? review : 'UNVERIFIED',
    // A link, never the text: a monograph belongs to whoever published it, and copying it would put this
    // system in the position of appearing to author dosing guidance.
    monographSourceUrl: record.monograph_urls?.[0] ?? null,
    sourceIds: record.source_ids ?? [],
    fieldProvenance: fieldProvenance(record),
  };
}

/** The identity of one alias row, so the same spelling cannot be recorded twice for the same target. */
export function aliasIdentity(input: {
  targetType: string;
  targetId: string;
  alias: string;
  kind: string;
}): string {
  return sha256Hex(`${input.targetType}|${input.targetId}|${input.alias}|${input.kind}`);
}
