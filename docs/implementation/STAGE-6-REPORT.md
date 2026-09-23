# Stage 6 — Consultation & Encounter (Checkpoints 6–8)

**STATUS: COMPLETE WITH BLOCKED ITEMS**

Stage 6 turned the queue into clinical work. A called serial becomes a consultation, the consultation
becomes a record, and the record cannot be quietly changed afterwards. This is the first stage that stores
anything a doctor would recognise as a medical note, so most of what follows is about immutability,
attribution and refusing to lose text — not about throughput.

## Checkpoints

| Checkpoint | Commit | Gate | Tag |
|---|---|---|---|
| CP6 Encounter core | `5135a91` | `checkpoint-verify.mjs` **20/20** | `stage6-cp6-encounter` |
| CP7 Notes & diagnoses | `5b36412` | `checkpoint-verify.mjs` **20/20** | `stage6-cp7-notes` |
| CP8 Consultation workspace | `54b087d` | `checkpoint-verify.mjs` **20/20** | `stage6-cp8-workspace` |

All three are verified trees, not scope markers. Each tag was created by the gate itself, which refuses to
tag unless every check passes on a clean tree — it declined once during CP8 when Docker Desktop was paused
and the integration runs could not start. CI was green on every push.

## Deploy

| | |
|---|---|
| **Single-app profile** | **Live.** `hmedicare.hakeemify.com` serves the client at `/` and the API under `/api/v1` from one Node process (ADR-023). SPA deep links return the shell; the API's own 404s still answer JSON, because the fallback declines any request that did not ask for `text/html`. |
| **Pre-migration dump** | **Automated and proven.** The CP6 deploy took one before migrating: 44 tables, 178 rows, gzip + sha256, with a manifest naming the migrations it guarded. Replaces the manual gate that caused the Stage 5 outage (D-01). |
| **`sql_mode` guarantee** | **Live.** `/health/ready` reports `sessionMode: ok` on every check. |

## Tasks

- **Done** — DEPLOY-001…004, TEST-001, CLIN-001…004, WEB-002, MOB-004, the ADR-021 retirement and its
  backfill, the §5 metrics, the §7 seed.
- **Deferred** — the medication catalog and `patient_medications` to migration section 0019 (C-52,
  Stage 7); a route exposing the acting doctor's own profile (C-56, Stage 7); deleting the two retired
  ADR-021 routes one release after this one (H-9).
- **Blocked** — the end-to-end walkthrough on the deployed site (H-10). It is scripted in
  `scripts/ops/verify-clinical-loop.mjs` and needs a login the build agent does not hold. The same path is
  covered locally by the Playwright and integration suites.

## Concurrency suite

Mandatory tests 1–3: **10 runs on mariadb:10.6 and 10 on mariadb:11.8. Zero failures, zero flakes.**

## Tests

| Suite | Result |
|---|---|
| unit | 324 |
| architecture | 40 |
| security | 10 |
| integration | **365 per series**, on 10.6 and 11.8 |
| HTTP coverage | every one of the 111 operations has a route test or is a documented 410 |
| e2e (Playwright) | 19, of which 8 are new for the workspace |
| mobile (Flutter) | `analyze --fatal-infos` and `test` clean on both apps |

## ADR-021 retirement

**Route decision.** Retired, not aliased, following the ADR's own exit clause rather than the prompt's
alias option — an ADR outranks a prompt. Both interim routes answer `410 ENDPOINT_RETIRED` with
`details.replacement` and `details.adr`. The code is new because `FEATURE_DISABLED` is **409** and means
*not available yet* — prepaid booking answers it while payments are unbuilt, and it will start working.
Reusing it would have told every Stage 5 client to retry forever. The routes are deleted one release
later (H-9).

**Legacy migration.** `202609230900_0007_adr021_backfill`. Every `IN_CONSULTATION` or `COMPLETED` Stage 5
serial gets an encounter marked `legacy_interim` with no note. Idempotent: re-running leaves rows
byte-identical, which the suite asserts rather than assumes.

This **reverses ADR-021 decision 4**, which promised Stage 6 would never backfill and would leave
`encounter_id` NULL forever. Leaving them would have put a permanent exception into every clinical query,
for rows nobody could identify by looking at them. The backfilled encounters are marked, not disguised:
no note, no participants, timestamps copied from the serial. A doctor opening one sees a consultation with
no record, because that is exactly what Stage 5 produced. Recorded in the ADR's Outcome section and in
audit row C-51.

## Clinical-policy decisions taken as defaults — owner review

None of these were specified. Each is a documented default, not a silent invention.

1. **Note sections** are fixed to the five the domain model defines. **No vitals**: the model defines none
   as structured data, so none were invented.
2. **20,000 characters per section**, counted in characters rather than bytes. A byte limit would give a
   doctor writing in Bangla a third of the room for the same note.
3. **An empty note cannot be signed.**
4. **The first signature refuses a correction reason**; every revision after it requires one. A reason on
   revision 1 would put a sentence in the record implying an earlier version existed.
5. **A replacement diagnosis may only point at a voided one**, so there are never two current answers with
   one claiming to supersede the other.
6. **Scoped clinical content is limited to `tenant_owner`, `clinic_admin` and `nurse`.** Receptionists get
   nothing clinical despite holding `encounter.read`, which the matrix grants them for queue status only.
7. **The draft stays readable after completion** (`SIGNED_LOCKED`) rather than being cleared. The last
   signed revision is the record; the draft beside it shows what was in the editor when the door closed.
8. **Coverage is evaluated at action time.** An expired window is refused even mid-consultation.
9. **Autosave writes no audit row and no version row.** Audit covers create, sign, amend and view — a row
   per keystroke would bury the entries that matter and turn the audit chain into a transcript of typing.
10. **Legacy encounters are marked, not disguised** (see above).

## Events and timeline-type gaps

**Emitted:** `EncounterStarted`, `EncounterInterrupted`, `EncounterResumed`, `EncounterCompleted`,
`EncounterEnteredInError`, `EncounterNoteDraftSaved` (explicitly not projected), `EncounterNoteSigned`,
`SymptomRecorded`, `DiagnosisRecorded`, `DiagnosisStatusChanged`.

**Gap (C-53).** The brief asked for `EncounterNoteAmended`, `DiagnosisAdded` and `DiagnosisVoided`.
EVENT-ARCHITECTURE §3's catalogue contains none of them. The documented names are emitted and carry
`revision`, `amended` and `voided` in the payload, so the future projector can tell the cases apart without
a name that does not exist. Recorded rather than invented.

**Payloads** carry identifiers, enums and counts only. The outbox deny-list refuses any key matching
`/note/i` or `/diagnos/i`, so `noteId` and `diagnosisId` were **dropped rather than the control weakened** —
the envelope already carries `aggregateType` and `aggregateId`.

## Deviations, ADRs and audit rows

- **D-27** — The deploy host unpacks packages `0644` and the exec-bit fixer did not cover
  `@prisma/engines`. The first deploy with a migration to apply died on `EACCES` spawning the schema
  engine, and production served 503. It hid for so long because the schema engine is only spawned when
  something is pending, so every earlier deploy looked healthy. The predicate is now extracted and tested
  by filename. The guarded migration also reported `unexpected error (see stderr)` while discarding the
  real message in the exception it had just caught; it now prints the child's stderr, scrubbed.
- **ADR-021** — Superseded, with an Outcome section recording both departures from its exit plan.
- **ADR-023** — The single-app deployment profile (written in CP6).
- **C-51** — ADR-021 decision 4 reversed (the backfill).
- **C-52** — Migration section 0008 split; the medication catalog moves to a new section 0019.
- **C-53** — The event-name gap above.
- **C-54** — Two authorization holes, both found by mandatory test 9 **before release**: a receptionist
  could read consultation notes through `encounter.read`, and an unassigned doctor passed the nurse scope
  fallback because an empty scope list means "everywhere" — which is how most small clinics are
  configured. Both closed; the HTTP suite asserts them on every clinical route.
- **C-55** — `GET /patients/{id}/encounters` is new and undocumented; the spec reaches patient history
  through the Stage 11 timeline. Authorized at *patient* level, deliberately: a doctor treating this
  patient today needs the last visit even when a colleague ran it, while signing and amending stay at
  encounter level because those attach a name to one consultation.
- **C-56** — No route tells a signed-in doctor their own `doctorProfileId`.

## Open HOST items

- **HOST-005** — 24 h of cron-pinged observation plus a 2 h idle window. Elapsed time; not started.
- **HOST-006…013** — Backup, restore, storage and egress behaviour on the plan, unverified.

## Real-data gate

`REAL_PATIENT_DATA_ALLOWED` is **false** and `/health/ready` reports it. It is false because the variable
is absent and the schema defaults it so; turning it on is refused outside production and refused while
`SMS_PROVIDER=mock`. Outstanding conditions:

- **G-1** — No password recovery path. **Sharpened by this stage:** production has exactly one user, so if
  that password is lost nobody can sign in at all (H-11).
- **G-2** — HOST-005 unrecorded.
- **G-3** — HOST-006…013 unrecorded.
- **G-4** — No restore drill. DEPLOY-002 automates the dump; nobody has read one back.
- **G-5** — The single-app profile was deployed on 2026-09-23. The observation window is what remains.

## Human queue

| # | Action |
|---|---|
| H-2 | Remaining HOST runbook items, from HOST-005 onward |
| H-3 | Pin the gitleaks tarball SHA-256 |
| H-4 | SMS-002 capture on staging with the owner's Zaman IT key |
| H-5 | SMS-008: one live SMS by the account owner |
| H-6 | Staging environment |
| H-7 | Native-speaker review of the Bangla UI strings, now including the workspace |
| H-9 | Delete the retired ADR-021 routes one release after this one |
| H-10 | Run `scripts/ops/verify-clinical-loop.mjs` against production to close CP8's walkthrough |
| H-11 | Record the production owner password durably, or build `ops:reset-owner-password` |

## Next stage

**Stage 7 — Prescriptions & Medication Catalog** (medicine dataset import, fast Rx editor, approval,
immutable versions, PDF).

Start with migration section **0019**, which C-52 reserved for the catalog and `patient_medications`, and
settle **C-56** before the chamber-creation UI needs it.
