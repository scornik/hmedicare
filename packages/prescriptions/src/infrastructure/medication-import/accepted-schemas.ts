/**
 * The schema sets this importer accepts (ADR-020 §1, PRESCRIPTION-IMPLEMENTATION.md §5.2).
 *
 * The Stage M JSON Schemas shipped inside the dataset are the import contract. The importer does not
 * redefine a single field; it validates each line against the schema file in the dataset directory, and
 * checks that file's SHA-256 against this list first.
 *
 * Pinning matters because the schemas travel with the data. A dataset could arrive with a schema that
 * permits something this importer was never written to handle — a new field the mapping ignores, a
 * loosened type — and validation would pass while the catalog quietly filled with rows nobody designed.
 * An unrecognised schema hash is refused (`MEDDATA_SCHEMA_UNSUPPORTED`) until someone reads the diff,
 * updates the importer and adds the new set here with an ADR-020 amendment.
 */
export interface SchemaSet {
  /** Identifier used in logs and in the import row. */
  id: string;
  /** Hex SHA-256 per schema file, for the files this importer reads. */
  hashes: Readonly<Record<string, string>>;
}

/**
 * `stage-m-v1` — from `medicine-dataset-20260917-4/checksums.sha256`, recomputed 2026-09-17 and verified
 * against the shipped files again on 2026-09-24.
 *
 * `provenance`, `conflicts` and `review_queue` are checksum-verified as part of the dataset but are not
 * imported, so their schemas are not pinned here: nothing maps them, and pinning a schema the importer
 * never reads would be a rule with no failure mode.
 */
export const STAGE_M_V1: SchemaSet = {
  id: 'stage-m-v1',
  hashes: {
    'aliases.schema.json': 'b97e4a99a633a630438cfb849c7c9fe831a9d2047778b563f6528a94af1cae01',
    'generics.schema.json': '92e9fd4506f450a9efb890b06163f3b5d91c48fd3ae72fa1fcf5de5fcb47c6cc',
    'manufacturers.schema.json': '09d493b1b9dd88a34790796c859be5b2c4032588179521b6df4125c72380d4f8',
    'medications.schema.json': '37ad080efd04da8eeba5397594eac4024ab6da69b9b0a651e293f7095c703bc7',
    'prices_observed.schema.json': '5992ea1a5ce62bd9dc5957e26f59fd4f4faf5a4b09c2bd935715aa7277cd3f25',
  },
};

export const ACCEPTED_SCHEMA_SETS: readonly SchemaSet[] = [STAGE_M_V1];

/** The files the importer reads, in the order it reads them. */
export const IMPORTED_FILES = [
  'manufacturers.jsonl',
  'generics.jsonl',
  'medications.jsonl',
  'aliases.jsonl',
  'prices_observed.jsonl',
] as const;

export type ImportedFile = (typeof IMPORTED_FILES)[number];

export const SCHEMA_FOR_FILE: Readonly<Record<ImportedFile, string>> = {
  'manufacturers.jsonl': 'manufacturers.schema.json',
  'generics.jsonl': 'generics.schema.json',
  'medications.jsonl': 'medications.schema.json',
  'aliases.jsonl': 'aliases.schema.json',
  'prices_observed.jsonl': 'prices_observed.schema.json',
};

/** The set whose every pinned hash matches, or null when none does. */
export function matchSchemaSet(actual: Readonly<Record<string, string>>): SchemaSet | null {
  return (
    ACCEPTED_SCHEMA_SETS.find((set) =>
      Object.entries(set.hashes).every(([file, hash]) => actual[file] === hash),
    ) ?? null
  );
}
