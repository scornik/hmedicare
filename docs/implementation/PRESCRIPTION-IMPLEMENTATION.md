# Prescription Implementation Contract

**Stage 3.1 rewrite (2026-09-17).** Resolves C-11 (`REVIEWED` defined) and C-06 (`revision` vs `row_version`). Tables: `DATABASE-IMPLEMENTATION.md` §3.9.

**Stage 3.2 update (2026-09-17):** the medication catalog is imported from the Stage M dataset (ADR-020). Catalog tables: `DATABASE-IMPLEMENTATION.md` §3.8. Search and prescribing rules: §2. Import contract: §5.

## 1. Clinical and render states

```text
clinical_status:  DRAFT -> REVIEWED -> APPROVED -> VOID
                  DRAFT -> APPROVED
                  REVIEWED -> DRAFT      (any item edit after review)
render_status:    NOT_REQUESTED -> QUEUED -> RENDERING -> AVAILABLE
                  QUEUED/RENDERING -> FAILED -> QUEUED (retry)
```

| State / transition | Meaning | Who | Permission |
|---|---|---|---|
| `DRAFT` | editable items | prescribing doctor (asg); nurse may edit items only if granted `prescription.write` | `prescription.write` |
| `DRAFT → REVIEWED` | **optional** "items checked" marker; **no clinical effect** (not final, not visible to patients, not renderable) | prescribing doctor, or nurse granted `prescription.review` | `prescription.review` |
| `REVIEWED → DRAFT` | automatic on any item edit (review is invalidated) | editor | `prescription.write` |
| `DRAFT/REVIEWED → APPROVED` | final clinical truth, immutable snapshot | **doctor role + assigned to the encounter** | `prescription.approve` |
| `APPROVED → VOID` | withdrawn with a reason | per `AUTHORIZATION-MATRIX.md` §6 | `prescription.void` |

- **One prescription row = one revision.** `revision` 1, 2, … per encounter; `row_version` is the draft-editing concurrency token.
- A **correction** of an approved prescription creates a new `DRAFT` revision (`supersedes_prescription_id`, items copied). Approving it voids the superseded `APPROVED` revision **in the same transaction** (void first, then approve), which satisfies `uq_prescriptions_one_approved`.
- Rendering never changes `clinical_status`. Only `APPROVED` (and, for an audit re-render, `VOID` with a watermark) can render.

## 2. Editor contract

- **Catalog search.** `GET /medications/search?q=&limit=` (min 2 characters; `limit` ≤ 20).
  - **Matching** runs over normalized search keys (`*_search_key`) with indexed prefix matches:
    1. exact brand match;
    2. brand prefix;
    3. Bangla brand prefix (`brand_bn_search_key`);
    4. source aliases (`alias_origin=source`: brand variants → the medication; generic variants → all active medications of that generic);
    5. generic name prefix;
    6. generated aliases (`alias_origin=generated`), always ranked **lowest**.
  - **Ranking:** tier from the list above, then tenant boost (`medication_usage_stats.prescribed_count` in the last 180 days, log-scaled, capped so it never lifts a lower tier above a higher one), then brand alphabetical.

    > **As built (Stage 7 CP9).** Two deliberate divergences, both narrowing rather than widening what the ranking can do:
    >
    > - **No arithmetic cap.** The boost is not a score that is clamped; results are sorted by `(tier, usage desc, brand)`, so a lower tier *cannot* be lifted above a higher one by construction. There is no constant anyone can tune until a generated alias outranks a real brand name.
    > - **The 180 days are a cut-off, not a window.** `medication_usage_stats` holds a cumulative `prescribed_count` and a `last_prescribed_at`; it has no per-period buckets. So a row whose last prescription is older than 180 days stops boosting entirely rather than decaying, and a row inside the window boosts by its lifetime count. A true rolling window is a schema change (per-period counters) and an owner decision; approximating one and presenting it as the real thing would be worse than saying this.

  - **Excluded:** inactive and veterinary rows (never imported). Synthetic rows appear only where seeded (`is_synthetic`).
  - **Results show:** brand, generics, strength, dosage form (with a "form not mapped" badge for `unmapped`), manufacturer, and a **catalog source indicator**: dataset version, `review_status` badge ("Unverified catalog"), DGDA match badge, and a "synthetic demo" badge where `is_synthetic`.
  - **Optional observed prices** (tenant setting `showObservedPrices`, default `false`) are labelled **"observed price, may differ"**, with source and date. They are never labelled MRP unless `is_official_mrp=1`.
  - **Catalog text is never shown as dosing guidance.** Monograph URLs are not displayed in the editor.
- **Items:**
  - a selected catalog item stores `medication_id`, `medication_dataset_version` and `catalog_snapshot` (brand, generics, strength, form, manufacturer, review status, DGDA match at selection time), and prefills only `strength` and `dosage_form` text;
  - **no dose, frequency, duration, route or instruction is ever suggested from catalog or scraped data**; those fields start empty;
  - a free-text fallback sets `is_free_text=1` and is visibly marked;
  - required fields: `dose`, `frequency`, `duration`;
  - optional: strength, form, route, quantity, timing, instructions (en/bn), substitution.
- **Draft edits** use `PATCH /prescriptions/{id}` with `expectedRowVersion` and an item diff. The server locks the prescription row and rejects edits unless DRAFT/REVIEWED (`PRESCRIPTION_NOT_EDITABLE`).
- **Approval:** `POST /prescriptions/{id}/approve {expectedRowVersion, attestationVersion}`. The server:
  1. locks the row;
  2. validates every item, the encounter/patient/doctor scope and the assignment;
  3. computes `approved_snapshot_sha256` over the canonical JSON of header and items;
  4. sets APPROVED, approval actor and time;
  5. writes the audit event and outbox `PrescriptionApproved` → timeline, render job (if `autoRender` tenant setting, default true) and delivery intents per consent.

## 3. PDF lifecycle

- `RenderPrescriptionPdf` job (queue `documents`) loads the approved snapshot and verifies its SHA-256 matches.
- It renders deterministically with `pdfmake` and the template version `RX_TEMPLATE_VERSION`. A Bangla-capable embedded font is used; its license is reviewed at RX-005, and no font is copied from reference repositories.
- It stores the file via `ObjectStoragePort` as a `documents` row (category `PRESCRIPTION_PDF`, AVAILABLE; generated files are not scanned) with a checksum, and sets `rendered_document_id` and `render_status=AVAILABLE`.
- On failure: `FAILED`, retry with backoff. The clinical status is unaffected.
- **Patient delivery** is a separate communication job using a download-token link or portal notification (never a permanent URL).

## 4. Tests

- Draft is editable; REVIEWED reverts to DRAFT on edit; APPROVED is immutable (repository rejects item mutation; test bypassing the use case also fails via the locked-parent check).
- Nurse with `prescription.review` can mark REVIEWED but cannot approve. A doctor not assigned to the encounter cannot approve.
- Approval from DRAFT and from REVIEWED both succeed. A stale `expectedRowVersion` returns `STALE_VERSION`.
- Correction flow: approving revision 2 voids revision 1 atomically; concurrent approvals of two revisions yield one success (unique index).
- Void requires permission and reason; void by clinic admin requires a named clinical reviewer.
- Rendering a draft returns `PRESCRIPTION_NOT_APPROVED`; duplicate render requests are idempotent; the snapshot hash is verified before render.
- Free-text items are visibly marked; catalog search never invents data; `UNVERIFIED` catalog badge shown.
- Selecting a catalog item leaves dose/frequency/duration empty; the snapshot is stored; a later import that changes or deactivates the medication does not change the approved prescription or its PDF.
- Search ranking: generated aliases below source aliases; tenant boost never crosses tiers; tenant A's usage does not affect tenant B.
- AI cannot create or approve prescription items in MVP (`FEATURE_DISABLED` for the `PRESCRIPTION_ITEM` target).

## 5. Medication dataset import (ADR-020)

### 5.1 Inputs

- **Dataset directory layout** (Stage M `dist/<version>/`): `medications.jsonl`, `generics.jsonl`, `manufacturers.jsonl`, `aliases.jsonl`, `prices_observed.jsonl`, `provenance.jsonl`, `conflicts.jsonl`, `review_queue.jsonl`, `schema/*.schema.json`, `reports/*.json`, `DATASET-CARD.md`, `checksums.sha256`.
- **Current version:** `medicine-dataset-20260917-4`, status `UNVERIFIED` (`tools/medicine-data/dist/latest.json`).
- **The JSON Schemas in `schema/` are the import contract.** The importer does not redefine fields. It validates each line with `ajv@8.20.0` (`Ajv2020` class, `strict: true`, `allErrors: false`) plus `ajv-formats@3.0.1` for `uri` and `date-time` against the schema **file shipped with the dataset**.

### 5.2 Accepted schema set (pinned)

`packages/prescriptions/src/infrastructure/medication-import/accepted-schemas.ts` lists accepted SHA-256 values. Set **`stage-m-v1`** (from `medicine-dataset-20260917-4/checksums.sha256`, recomputed on 2026-09-17):

| Schema file | SHA-256 |
|---|---|
| `aliases.schema.json` | `b97e4a99a633a630438cfb849c7c9fe831a9d2047778b563f6528a94af1cae01` |
| `generics.schema.json` | `92e9fd4506f450a9efb890b06163f3b5d91c48fd3ae72fa1fcf5de5fcb47c6cc` |
| `manufacturers.schema.json` | `09d493b1b9dd88a34790796c859be5b2c4032588179521b6df4125c72380d4f8` |
| `medications.schema.json` | `37ad080efd04da8eeba5397594eac4024ab6da69b9b0a651e293f7095c703bc7` |
| `prices_observed.schema.json` | `5992ea1a5ce62bd9dc5957e26f59fd4f4faf5a4b09c2bd935715aa7277cd3f25` |

(`provenance`, `conflicts` and `review_queue` schemas are checksum-verified but their files are not imported.) A dataset whose imported-file schema hash is not in an accepted set → `MEDDATA_SCHEMA_UNSUPPORTED`.

### 5.3 Algorithm

1. **Preflight** (no writes except the import row):
   - resolve the directory (CLI) or storage prefix (job);
   - parse `checksums.sha256` and stream-hash every listed file (mismatch → `MEDDATA_CHECKSUM_MISMATCH`);
   - check schema hashes (§5.2);
   - read `status` from the first medication record and `latest.json` if present;
   - evaluate the environment gate (ADR-020 §2);
   - `--dry-run` stops after step 2 with counts only.
2. **Manufacturers, then generics:** upsert by `*_key_sha256`; keys absent from this version → `active=0`.
3. **Medications** (streamed line by line, batches of `MEDICATION_IMPORT_BATCH_SIZE`):
   - skip veterinary (ADR-020 §2);
   - map fields (ADR-020 §1);
   - `canonical_key_sha256 = sha256(record_key)`;
   - upsert: insert, or update when any mapped value differs (`unchanged` counted otherwise); set `dataset_version`;
   - replace `medication_generic_links` for changed rows;
   - checkpoint after each committed batch (`{file, line}`).
4. **Deactivation:** medications with `dataset_version <> <this version>` and `is_synthetic=0` → `active=0`, `deactivated_in_version=<this version>` in batches. **Never delete.**
5. **Aliases:** upsert by `alias_identity_sha256`; resolve `target_id` via `dataset_record_id` (medication or generic); unknown targets are counted `rejected_unresolved_target`; aliases not seen in this version → `active=0`.
6. **Prices:** validate the 2-decimal rule, then insert-or-ignore by `(medication_id, source_id, observed_at)`.
7. **Finish:** status `SUCCEEDED`, `counts`, `finished_at`, audit `MEDDATA_IMPORTED` (platform chain), outbox `MedicationDatasetImported`.
8. **Failure:** status `FAILED` with `error_class` and checkpoint. Re-running the same version resumes from the checkpoint; batches are idempotent upserts.

**Memory and time:**
- no whole-file loads; a readline stream plus one batch in memory;
- `ImportMedicationDataset` is long-running, so it runs only in `worker` runner mode (never in cron batches) and renews its lease every 30 s;
- on idle-stop or restart it resumes from the checkpoint.

**Expected counts for `medicine-dataset-20260917-4`:** 50,946 read, 732 excluded as veterinary, 50,214 imported on a clean database; 1,852 generics; 401 manufacturers; 1,389 aliases; 58 prices.

### 5.4 Execution

| Where | Command / route |
|---|---|
| local/dev | `pnpm meddata:import --dir tools/medicine-data/dist/medicine-dataset-20260917-4 [--dry-run]` (reads files only; no `tools/` code import; refuses `APP_ENV=production`) |
| staging/production | stage files (`pnpm meddata:stage --dir … --env staging` for `s3`; SFTP to `<STORAGE_DISK_ROOT>/platform/medicine-datasets/<version>/` for `disk`), then `POST /admin/medications/imports {datasetVersion}` (platform `medication.import`) |
| production gates | `POST /admin/medications/datasets/{version}/gate-attestations` × 4, plus `MEDICATION_IMPORT_PRODUCTION_ALLOWED=true` |

### 5.5 Tests

- **Fixture dataset:** `packages/prescriptions/test/fixtures/meddata-mini/` holds ~30 synthetic JSONL records conforming to the pinned schemas: veterinary rows, an `unmapped` form, a generic alias, a price with 3 decimals, and a changed record in a second version. It has its own `checksums.sha256`. **No real dataset rows are committed to the repository.**
- **Cases:**
  - checksum mismatch and schema hash mismatch refuse the import;
  - veterinary exclusion counts;
  - price precision rejection;
  - the upsert is idempotent (running the same version twice changes nothing);
  - version 2 updates changed rows and deactivates removed rows, and a referenced medication stays and is not deleted;
  - resume after a simulated crash at batch 2;
  - production refusal without all four attestations, and with the flag off;
  - only one active import at a time.
- **Optional local smoke** (not CI): import the real `medicine-dataset-20260917-4` into local MariaDB and compare counts with §5.3.
