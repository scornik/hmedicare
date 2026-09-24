# ADR-020 — Medicine dataset import (Stage M dataset → medication catalog)

**Status:** Accepted (2026-09-17, Stage 3.2)
**Resolves:** the Stage 3.1 external decision "Verified Bangladesh medicine dataset" as far as the **import mechanism** goes. The data itself stays `UNVERIFIED`.
**Inputs:** `tools/medicine-data/dist/latest.json` → `medicine-dataset-20260917-4`, and its `DATASET-CARD.md`, `checksums.sha256` and `schema/*.schema.json`.
**No compliance claim** is made. The catalog is **not clinical guidance**.

## Context

**What Stage M produced** (version `medicine-dataset-20260917-4`, status `UNVERIFIED`, built 2026-09-17):

| File | Records |
|---|---:|
| medications | 50,946 |
| generics | 1,852 |
| manufacturers | 401 |
| aliases | 1,389 (all `alias_origin: source`) |
| prices_observed | 58 |
| provenance | 62,494 |
| conflicts | 2,809 |
| review_queue | 5,764 |

- **Sources:** DGDA, the Mendeley CC BY 4.0 dataset and LazzPharma are `UNCLEAR` (legal review required). Six sources are `PROHIBITED` and contributed nothing.
- **DGDA match:** 78.3% of products are `MATCHED`.
- **Dataset card production gates** (all outstanding):
  1. legal/terms review for every `UNCLEAR` source;
  2. clinician/pharmacist sample review with sample size and error rate;
  3. DGDA cross-reference completed where public data allows;
  4. import safeguards (catalog-source indicator, free-text fallback, no dosing text).
- **Records:**
  - A medication record has a stable `id` = `med_` + the first 16 hex characters of SHA-256(`record_key`).
  - `record_key` = `brand | sorted generic set | strength | dosage form | manufacturer [#route]`, all normalized.
  - Fields carry per-field provenance `{value, sources, agreement_count, alternatives}`.
- **Known limitations** stated by the card:
  - veterinary products are included and should be excluded at import;
  - `unmapped` dosage forms exist;
  - Bangla brand names, pack size and therapeutic class are empty in this build;
  - observed prices are retail observations, not MRP, unless `is_official_mrp` is true.

## Decision

### 1. Import contract

- **The Stage M JSON Schemas are the import contract**, adopted without redefining fields. The importer validates every line against the schema files **shipped in the dataset directory**, and checks each schema file's SHA-256 against `checksums.sha256`.
- **Pinned schema set.** The importer pins accepted schema sets by the SHA-256 of `schema/medications.schema.json` et al. For this version they are listed in `docs/implementation/PRESCRIPTION-IMPLEMENTATION.md` §5.2. A dataset with a new schema hash is refused (`MEDDATA_SCHEMA_UNSUPPORTED`) until an importer update and an ADR-020 amendment accept it.
- **Field mapping** (no renaming inside the dataset; mapping happens only at the database boundary):

| Dataset field | Catalog column |
|---|---|
| `record_key` | `medications.canonical_key` (upsert key) |
| `id` | `medications.dataset_record_id` |
| `brand_name.value` / `brand_name_bn.value` | `brand_name` / `brand_name_bn` |
| `generic_names.value[]` | `medication_generic_links` → `medication_generics` (matched by generic `key`) |
| `strength.value` / `strength_parsed` | `strength_text` / `strength_parsed` JSON |
| `dosage_form.value` / `dosage_form_raw` | `dosage_form` / `dosage_form_raw` JSON |
| `route.value` | `route` |
| `manufacturer.value` | `manufacturer_id` → `medication_manufacturers` (matched by the manufacturers file `key`) |
| `registration_number.value` + `.alternatives` | `registration_number` + `registration_alternatives` JSON |
| `dgda_match` | `dgda_match` |
| `status` | `review_status` (`UNVERIFIED` for this version) |
| `monograph_urls[0]` | `monograph_source_url` (link only; content never imported) |
| `source_ids`, per-field `sources`/`agreement_count` | `source_ids` JSON, `field_provenance` JSON (bounded) |
| aliases file | `medication_aliases` (`alias_origin` kept; `target_type=generic` → generic aliases) |
| prices_observed file | `medication_price_observations` |
| provenance / conflicts / review_queue | **not imported** into the application DB; counts are recorded in `medication_dataset_imports.counts` |

### 2. Import rules

- **Integrity first.** Verify every file listed in `checksums.sha256` before any write. `latest.json` is informational; the importer requires an explicit version.
- **Upsert by `canonical_key`**, in batches of `MEDICATION_IMPORT_BATCH_SIZE` (500) within short transactions:
  - update attributes and `dataset_version`;
  - rows absent from the new version → `active=0`, `deactivated_in_version`;
  - **rows referenced by `prescription_items` or `patient_medications` are never deleted.** Nothing in the catalog is ever hard-deleted.
- **Idempotent per version.** `medication_dataset_imports` has a unique `dataset_version` for `SUCCEEDED`. Re-running the same version is a no-op report. A failed run resumes from its checkpoint (last processed line per file).
- **Veterinary exclusion** (default `MEDICATION_IMPORT_EXCLUDE_VETERINARY=true`), per the dataset card:
  - dosage forms `bolus_veterinary`, `water_soluble_powder_veterinary`, `pour_on_veterinary`;
  - products whose `manufacturer.value` or any `manufacturer.alternatives[].value` contains `(Veterinary)`.

  Excluded rows are counted in the report, not imported. For `medicine-dataset-20260917-4` this is 732 products (669 with a veterinary form, 117 with a veterinary manufacturer, overlapping; counted on 2026-09-17), leaving 50,214 importable products. `unmapped` dosage forms (552) are imported with `dosage_form='unmapped'` and a "form not mapped" badge.
- **Price check (this version):** all 58 observed prices pass the 2-decimal rule, and none is `is_official_mrp`.
- **Price conversion.** The dataset carries JSON numbers. They are converted to `DECIMAL(12,2)` by validating the number's shortest round-trip decimal string against `^\d{1,10}(\.\d{1,2})?$`. Rows failing this are skipped with `PRICE_PRECISION_REJECTED` in the report, so no float is ever stored. `is_official_mrp=false` rows are stored with `price_label` as given and **never displayed as MRP**.
- **Environment gate.**
  - `review_status=UNVERIFIED` datasets import freely in `development`, `test` and `staging`.
  - In `production` the import is refused (`POLICY_BLOCKED`, reason `MEDDATA_PRODUCTION_GATES_OPEN`) unless **both** hold:
    - `MEDICATION_IMPORT_PRODUCTION_ALLOWED=true`;
    - `medication_dataset_gate_attestations` contains all four dataset-card gates (`LEGAL_SOURCE_REVIEW`, `CLINICAL_SAMPLE_REVIEW`, `DGDA_CROSS_REFERENCE`, `IMPORT_SAFEGUARDS_VERIFIED`) for that version, each with an evidence reference, recorded by a platform operator (audited).
  - `GATE-MEDDATA-PROD` is OPEN for `medicine-dataset-20260917-4`.
- **Synthetic seed remains synthetic.** `pnpm db:seed` inserts a handful of clearly synthetic catalog rows (`DEMO-` brands, `canonical_key` prefixed `synthetic:`). The real dataset is a separate, opt-in step in dev: `pnpm meddata:import --dir tools/medicine-data/dist/<version>`.

### 3. Execution paths

| Environment | How |
|---|---|
| local / dev | CLI `pnpm meddata:import --dir <dataset dir> [--dry-run] [--force]` (`packages/prescriptions/src/cli/meddata-import.ts`). It runs the importer in-process against `DATABASE_URL`. The dataset is read as **data files**; `tools/` code is never imported. |
| staging / production | 1. The operator stages files under the storage prefix `platform/medicine-datasets/<version>/`: `pnpm meddata:stage --dir … --env staging` for the S3 adapter, or SFTP into `<STORAGE_DISK_ROOT>/platform/medicine-datasets/<version>/` for the disk adapter (write access verified by MEDDATA-003 / HOST-007). 2. A platform operator calls `POST /admin/medications/imports {datasetVersion}`. 3. The worker job `ImportMedicationDataset` streams the JSONL through `ObjectStoragePort` line by line, bounded by memory (ADR-013 budget). |

### As built (Stage 7 MEDDATA-003)

The execution paths above are built with one deliberate substitution, recorded here rather than left to
be discovered:

- **The job reads from the disk path, not `ObjectStoragePort`.** That port arrives with file storage in
  Stage 8 and does not exist yet. Building a throwaway abstraction for one caller — and then replacing it
  a stage later — buys nothing that a shared `stagedDatasetDir()` does not, and the layout it computes is
  the same `<STORAGE_DISK_ROOT>/<prefix><version>/` an operator reaches over SFTP. When the port lands,
  the reader behind that path changes and the job does not.
- **`pnpm meddata:stage` is the disk-adapter form**: it verifies the dataset, copies it, re-verifies the
  copy where it landed, and refuses a destination inside a web root, a version already staged (without
  `--force`) or a version name that is not a plain token. The S3 form follows the port.
- **The job runs on its own `catalog` queue** with a 900-second lease. The runner's claim lease is the
  longest lease of any type on a queue, so a long job sharing a queue would stretch every other job's
  lease with it.
- **`GATE-MEDDATA-PROD` remains OPEN.** No attestation has been recorded for
  `medicine-dataset-20260917-4`, and production refuses it. The attestation chain is verified alongside
  the audit and platform-gate chains, so the four rows that would open the gate cannot be edited after
  the fact without the verifier noticing.

### 4. Search and prescribing

- **Search** (`GET /medications/search?q=&limit=`) matches:
  - brand-name prefix (normalized), generic name/key prefix, Bangla brand/alias prefix, Banglish/brand-variant aliases;
  - ranking: exact brand > brand prefix > source alias > generic > **generated alias (lowest)**;
  - a tenant "frequently prescribed" boost from `medication_usage_stats`, updated by a `PrescriptionApproved` consumer;
  - inactive rows excluded;
  - veterinary rows never present.
- **Results show:**
  - brand, generics, strength, form, manufacturer;
  - a **catalog source indicator** (dataset version, `review_status` badge "Unverified catalog", DGDA match badge);
  - optionally, an "observed price, may differ" label with source and date.
- **Prescribing:**
  - selection stores `medication_id` + `medication_dataset_version` and snapshots strength/form text into the item;
  - the free-text fallback stays and is visibly marked;
  - **no dose, frequency or duration is ever suggested from catalog or scraped data**;
  - monograph URLs are not shown as guidance.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Upsert by dataset `id` | Equivalent (id = hash of `record_key`), but `canonical_key` is human-auditable and the id is derived; both are stored |
| Import provenance/conflicts into the app DB | 23 MB of source linkage that is not needed at runtime; kept with the dataset artifact |
| Allow production import with a warning | Contradicts the dataset card gates |
| Delete removed products | Breaks prescription history |

## Consequences

- Dev and staging get a realistic 50k-product catalog, with provenance and badges.
- Production keeps an empty catalog until all four gates are attested (the seed never runs in production). Free-text prescribing works throughout.
- A new Stage M version with the same schema hash imports without code changes.
