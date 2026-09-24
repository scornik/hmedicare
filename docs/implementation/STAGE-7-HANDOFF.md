# Stage 6 → Stage 7 handoff

Written to be read while authoring the Stage 7 prompt. It says what Stage 7 inherits, what it must not
re-specify, what is already half-built, and which decisions only the owner can make.

The full Stage 6 account is in `STAGE-6-REPORT.md`; this does not repeat it.

---

## 1. Where the tree actually is

`main` is at **`74c66e5`**, pushed, CI green. Three Stage 6 tags, all verified trees:
`stage6-cp6-encounter`, `stage6-cp7-notes`, `stage6-cp8-workspace`.

**There is uncommitted Stage 7 work in the working tree.** The prompt should not ask for it again:

| Already done, uncommitted | What it is |
|---|---|
| **C-56 settled** | `Membership` now carries `doctorProfileId`, so a chamber picker binds to a doctor's profile. This was the gap that left a fresh tenant unable to create its first chamber. |
| **Migration 0019 `medication_catalog`** | The ten catalog tables plus `patient_medications`, in the section C-52 reserved. Applied cleanly against MariaDB; 15 CHECKs and both generated uniqueness columns verified present. |
| **10 catalog schema tests** | `packages/database/test/integration/catalog-schema.test.ts`, green. Asserts the invariants against the engine, not the service. |
| **Migration lint exemption** | `FOREIGN_ID_COLUMNS` in `packages/database/scripts/lib/lint.mjs`. `dataset_record_id` and `source_id` end in `_id` but hold the dataset's identifiers, not our UUIDs. |

One lint error is outstanding in the new test file. Everything else in that set passes.

So **MEDDATA-001's schema half is done**. Stage 7's prompt should start from the importer, not the tables.

---

## 2. What Stage 7 inherits and must not re-litigate

**Migration sections are fixed and non-sequential.** 0008 is `clinical_observations`, 0009 is
`prescriptions`, 0019 is `medication_catalog`. One section is one migration, and a migration is immutable
once applied — this is why 0008 had to be split (C-52). If Stage 7 needs a table nobody reserved a section
for, it takes the next free number and the map is amended in the same commit.

**The clinical record is immutable once signed.** Prescriptions inherit this shape directly: the
prescription equivalent of "amend a signed note" is "a new approved version with a reason", and the one it
replaces stays readable. Stage 7 should not invent a different correction model.

**Two authorization footings, not one flag.** `ClinicalAccessPolicy` decides assignment (the doctor
footing — the only one that permits signing or an attributed clinical judgement) separately from scope
(the non-doctor footing, limited to `tenant_owner`, `clinic_admin`, `nurse`). Prescription approval is an
assignment-footing action. Mandatory test 9's table-driven style found two real holes in Stage 6; Stage 7
should demand the same table.

**Events carry identifiers only.** The outbox deny-list refuses any payload key matching `/note/i`,
`/diagnos/i`, `/prescri/i` — which means `prescriptionId` will be refused the same way `noteId` was. Drop
the key rather than weaken the control: the envelope already carries `aggregateType` and `aggregateId`.
Worth stating in the prompt so it is not discovered mid-build.

**The deployed profile is one Node app.** `WEB_DIST_DIR` must be absolute. Migrations run at startup, and
DEPLOY-002 takes a verified dump first.

---

## 3. Traps Stage 6 hit that Stage 7 will hit again

1. **Native binaries lose their execute bit on the deploy host.** `scripts/host/native-binaries.mjs` names
   the ones we know about. Stage 7 adds `pdfmake` and fonts — if anything ships a compiled binary, it
   belongs in that predicate with a test, before the first deploy that needs it. This cost a production
   outage (D-27).
2. **The Dart client drifts silently.** Adding a route without regenerating it fails CI, correctly. Stage 7
   adds many routes; regenerate as part of each contract change rather than at the end.
3. **Lock ordering is enforced at runtime.** Prescriptions will sit near encounters in the ranking. Adding
   ranks is not optional — `lockRow` throws `LOCK_ORDER_VIOLATION` and it will find you in a concurrency
   test rather than in review.
4. **Character limits, not byte limits.** Bangla is three bytes per character in utf8mb4. A byte limit
   quietly gives a Bangla-writing doctor a third of the room.
5. **The docs outrank the prompt.** Stage 6's prompt offered an aliasing option that ADR-021's own exit
   clause contradicted; the ADR won. Where Stage 7's prompt and a written ADR disagree, say which governs.

---

## 4. What the Stage 7 prompt has to decide (nobody else can)

**Checkpoint boundaries and tags.** Stage 6 used three (CP6/CP7/CP8) with a tag each and a rule that a tag
means a verified tree, never a scope marker. Stage 7's natural seams look like: catalog import → Rx editor
and approval → render and clients. But the split is the prompt's call.

**The mandatory test list.** This is the highest-value part of the Stage 6 prompt. Its numbered tests found
real defects before release — a receptionist reading notes, an unassigned doctor passing a scope check, a
stale autosave being accepted. Stage 7 candidates worth naming explicitly:

- two doctors approving the same prescription concurrently;
- a prescription approved while its encounter is being completed;
- the importer interrupted mid-run and resumed from its checkpoint;
- the importer refusing to run twice concurrently (already enforced by a generated key — the test proves
  the service honours it too);
- re-import of the same dataset version leaving rows byte-identical;
- a medication deactivated by an import that is still referenced by an approved prescription;
- free-text prescribing with an empty catalog, and with a catalog holding only synthetic rows;
- `source = ai_approved` unreachable, as in Stage 6;
- render ≠ approval: a rendered PDF of an unapproved prescription must be impossible;
- Bangla round-trip through the PDF, with the font actually embedded.

**The dataset decision.** `medicine-dataset-20260917-4` is `UNVERIFIED` and dev/staging only. The four
gates (`LEGAL_SOURCE_REVIEW`, `CLINICAL_SAMPLE_REVIEW`, `DGDA_CROSS_REFERENCE`,
`IMPORT_SAFEGUARDS_VERIFIED`) have a table and no attestations. The prompt must say whether Stage 7 ships
the import *mechanism* only, or also attempts any gate. ADR-020 says production refuses an import without
attestations — that refusal is testable now; the attestations themselves are a human act.

**Prescription rendering.** `pdfmake` is named in the backlog. A Bangla-capable font must be chosen,
licensed and reviewed — that is a licence decision and a legibility judgement, not an engineering one.
Whether Stage 7 ships a reviewed font or a placeholder with a gate is the prompt's call.

**Clinical safety scope.** Interaction checking, allergy checking, dose-range warnings: the backlog does
not promise them and the catalog has no data to support them. The prompt should state plainly that Stage 7
does **not** do clinical decision support, so nobody infers it from a medication database being present.

---

## 5. Carried-forward constraints worth repeating verbatim

These were in the Stage 5 and 6 prompts and should stay:

- No real patient data, phone numbers, keys, store IDs or passwords anywhere — including tests, fixtures,
  docs and commit messages.
- PHI-like fields and secrets never appear in logs, errors, job payloads, metrics labels or audit metadata.
- No GET requests carrying secrets. No disabled TLS verification. No public file URLs.
- No client-side authorization decisions treated as security.
- Dependencies only from the pinned stack; a new one needs a line in `TECHNOLOGY-STACK.md` with purpose,
  version and licence, plus a passing licence scan. **Stage 7 will add at least `ajv`, `ajv-formats` and
  `pdfmake`** — say so, so the additions are expected rather than argued.
- Never weaken a security control to make a test pass.
- Never run tests against mid-edit code. Never re-point a pushed tag.
- Bangla strings live only in localization files.
- Clinical-policy gaps become owner-review defaults, never silent inventions. Stage 6 produced ten; the
  §10 report lists them and they are still unreviewed.

---

## 6. Outstanding from Stage 6 that Stage 7 inherits

| # | Item | Why it matters to Stage 7 |
|---|---|---|
| H-10 | CP8's end-to-end walkthrough on the deployed site, scripted in `scripts/ops/verify-clinical-loop.mjs` | Extend it rather than write a second one |
| H-11 | Production has one user and no recovery path | Blocks gate G-1; a prescribing system with no way back in is worse than a note-taking one |
| H-9 | Delete the two retired ADR-021 routes one release after Stage 6 | Cheap; Stage 7 is the release that should do it |
| G-4 | No restore drill | Prescriptions are the first thing a clinic would litigate over |
| C-53 | The event catalogue has no amend/void names | Prescriptions will hit the same gap; decide once |
| — | Ten unreviewed clinical-policy defaults | §10 report, section "Clinical-policy decisions taken as defaults" |

---

## 7. Numbers, for the prompt's "current state" paragraph

- **111 API operations**, zero client drift.
- **54 tables** across 13 migrations, all applying cleanly on MariaDB 10.6 and 11.8.
- Tests: **365 integration per series**, 324 unit, 40 architecture, 10 security, 19 Playwright, Flutter
  analyze and test clean.
- Production: `hmedicare.hakeemify.com`, single-app profile, `REAL_PATIENT_DATA_ALLOWED=false`,
  readiness reporting `db: ok` and `sessionMode: ok`.
