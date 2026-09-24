# Implementation Status — Stages 4 (Foundation + Tenant/Identity), 5 (Patient, Scheduling, Queue) and 6 (Consultation & Encounter)

Living document (BUILD-CONTRACT; Stage 4 prompt §8, Stage 5 prompt §10, Stage 6 prompt §10). Updated after every merged task.
Legend:
- **DONE:** merged to `main` with tests.
- **PROVISIONAL:** merged with tests; final only after the listed HOST items or human actions pass.
- **DEFERRED:** out of phase (reason given).
- **BLOCKED:** a human action is required.

## 1. Checkpoint status

| Checkpoint | Scope | Status | Tag |
|---|---|---|---|
| CP1 Foundation | FOUND-*, JOB-*, HOST harness, CI, api/worker shells, SEC suite, seed | PASS (local gates; CI evidence pending H-1, HOST evidence pending H-2) | `stage4-cp1-foundation` |
| CP2 Tenant/Identity | ID-001…ID-007, SMS-001…005/008, web + mobile shells | PASS (local gates; SMS-002 capture and SMS-008 live send are human-run) | `stage4-cp2-identity` |
| CP3 Patient registry (Stage 5) | CI-000, PAT-001…PAT-007: migration 0004, search normalization, lock ranking, patient/merge/consent/access services, HTTP routes + patient context, seed, web staff screens, mobile profile switcher | **PASS as part of the CP5 tree.** At the boundary commit itself 18 of 20 gates pass; integration fails only on the argon2 `timeCost` rebase artefact (see the tag note) | `stage5-cp3-patient` — scope marker on `fcbad0b`, annotated |
| CP4 Chamber & scheduling (Stage 5) | CHAM-000…004, SCHED-001, APPT-001/002: migrations 0005/0006, clinics, chambers, schedule rules, chamber days, appointments, the serial lifecycle they reach and the no-show job | **PASS as part of the CP5 tree.** At the boundary commit itself 18 of 20 gates pass; integration fails only on the same argon2 artefact plus the worker-shell flake, both fixed in `7cf4d53` | `stage5-cp4-scheduling` — scope marker on `fa7a8a4`, annotated |
| CP5 Serial/queue engine (Stage 5) | SERIAL-*, QUEUE-*, LOC-*: the queue-active lifecycle, reorder, the ETagged snapshot and the patient view, the queue HTTP endpoint matrix, the web board, the doctor and patient app screens and the queue-active seed | **PASS** — `checkpoint-verify.mjs` 20/20 at `4456a36`, both MariaDB series; HOST-001/002/003/004 recorded, HOST-005 still open | `stage5-cp5-queue` |
| CP6 Encounter core (Stage 6) | DEPLOY-001…004, TEST-001, CLIN-001/002: the single-app profile, the automated verified pre-migration dump, the `sql_mode` guarantee, the real-data gate, HTTP coverage for the 19 uncovered routes, migration 0007, the encounter lifecycle and the ADR-021 retirement with its backfill | **PASS** — `checkpoint-verify.mjs` 20/20 at `5135a91`, both MariaDB series. Mandatory tests 1–3 flake-free over 10 runs per series | `stage6-cp6-encounter` |
| CP7 Notes & diagnoses (Stage 6) | CLIN-003/004: migration 0008, the note draft with autosave, signing into a hash-chained revision, amendments with a mandatory reason, diagnoses and symptoms, the clinical access policy, the §5 metrics and the clinical seed | **PASS** — `checkpoint-verify.mjs` 20/20 at `5b36412`, both series. Mandatory tests 4–7, 9, 10, 11, 13, 14 and 15 green | `stage6-cp7-notes` |
| CP8 Consultation workspace (Stage 6) | WEB-002, MOB-004 and `GET /patients/{id}/encounters`: the web workspace, the doctor app's encounter screen and the history panel behind them, plus the deployed single-app build | **PASS** — `checkpoint-verify.mjs` 20/20 at `54b087d`, both series. The deployed end-to-end walkthrough is scripted and outstanding (H-10) | `stage6-cp8-workspace` |

### Why CP3 and CP4 are scope markers

The Stage 5 branch was rebased onto a `main` that had moved on — argon2 pinned to 0.41.1 for the host's
glibc, and Prisma 6 for the query engine. Rebasing replays the old commits onto that new base, so every
intermediate commit becomes a combination that never existed while the work was done. `fcbad0b` and
`fa7a8a4` are exactly that: CP3 and CP4 code, whose tests ask argon2 for `timeCost: 1`, sitting on a base
whose argon2 refuses anything below 2. The value was raised in `7cf4d53`, which belongs to CP5.

Only the tip of a rebased branch is a tree that ever really existed, and only the tip was verified as a
whole (`checkpoint-verify.mjs` 20/20 at `4456a36`). The two earlier tags therefore mark where each
checkpoint's scope ends; `git tag -n99 stage5-cp3-patient` states what was and was not verified. The
lesson for Stage 6 is to tag a checkpoint when it is reached, not retroactively after a rebase.

## 2. Tasks

| Task | Status | Commit(s) | Tests added | Notes |
|---|---|---|---|---|
| FOUND-001 repo + tooling | DONE | `3c015b7` | architecture: depcruise fixtures, ESLint rule tests | pnpm 12.4.2, turbo, ESLint flat + `eslint-plugin-hmedic`, Prettier, pre-commit hook |
| FOUND-002 config | DONE | `fc4b451` (+ SEC, SMS-002) | unit 11 | fail-closed Zod env; refuses `NODE_TLS_REJECT_UNAUTHORIZED=0`; diagnostics refused in production |
| FOUND-003 kernel | DONE | `6a10339` | unit 74 | `SESSION_REVOKED` (C-35) |
| FOUND-004 database | PROVISIONAL (HOST-001/003/005) | `0fbd5b5` | unit 13, integration 22 × 10.6/11.4 | Prisma 7.10.0 + MariaDB adapter |
| FOUND-005 local infra | DONE | `0fbd5b5` | compose healthchecks | MariaDB 10.6 by digest, mock-providers |
| FOUND-006 api shell | DONE | `5a1de2d`, `b83c3e3` | integration 21 | `packages/http-kit` (C-36); no `nestjs-pino` (C-37) |
| FOUND-007 worker shell | DONE | `dd0c7f0` | integration 7 | + SMS-002 diagnostic route (D-17) |
| FOUND-008 observability | DONE | `900363f`, `733e72f` | unit 19 | pino + prom-client |
| FOUND-009 CI | PROVISIONAL (H-1: no GitHub remote yet) | `f5ed321`, `fa6dfb5` | — | SHA-pinned actions, MariaDB 10.6/11.4 matrix by digest, gitleaks, OSV, SBOM, license scans, web + Playwright, mobile analyze/test/drift |
| FOUND-010 contracts | DONE | `b9f4f98`, `e43719f` | unit (contracts) | OpenAPI 3.1 + 3.0, 25 operations, `openapi:check`, TS client (`credentials: 'omit'` default) |
| FOUND-011 deploy scripts | PROVISIONAL (H-1, H-2, H-6) | `2dae83c`, `f90f878`, `1a390d2` | unit (build-info) | `hostinger:build:*`, `infrastructure/hostinger/*`, `promote-staging.yml`, `dist/build-info.json` version, `pnpm dev` full stack |
| FOUND-012 audit chain | DONE | `4d0bff5` | unit 5, integration 10 | `pnpm verify-audit-chain [--full]` |
| FOUND-013 idempotency + rate limits | DONE | `991cf0a`, `5a1de2d` | integration 12 | credential routes non-replayable (C-40) |
| Seed (SEED-DATA) | DONE | `b3cdef0` | integration 3 | idempotent, `--verify`, `--rotate-passwords`; commit message mislabels it FOUND-010 |
| SEC suite | DONE | `0fd93e0` | security 10 | tenant isolation over HTTP, composite tenant FKs, internal endpoints (T10/T27), secret leakage (T1/T2/T22) |
| JOB-001…JOB-007 | PROVISIONAL (HOST-003/005) | `991cf0a`, `a441fb8`, `dd0c7f0` | unit 14, integration 32 | two runners, crash reclaim, dead letter, outbox, TTL cleanup, runner modes |
| HOST-001…013 harness | DONE (harness) / verification BLOCKED (H-2) | `0bab249` | integration 4 (host-probe), unit 2 (record-results) | `apps/host-probe`, `pnpm host:record-results`, runbooks; engine probe falls back to `@@tx_isolation` on 10.6 |
| ID-001 tenants/memberships schema | PROVISIONAL (HOST-001/003) | `149f50d` | integration | |
| ID-002 sessions/tokens/password | PROVISIONAL (HOST-001/003) | `8cf7130`, `928c58a` | unit + integration | Argon2id, EdDSA (jose), rotation + reuse detection |
| ID-003 OTP login | PROVISIONAL (HOST-001/003) | `a220a23` | integration | HMAC codes, 180 s TTL, 5 attempts, resend supersedes |
| ID-003a localization | DONE | `96fe04f` | unit 33 | |
| ID-004 CSRF + cookie transport | PROVISIONAL (HOST-012/013) | `8cf7130`, `928c58a` | integration | signed double-submit + Origin; `__Host-` cookies when Secure |
| ID-005 authorization | DONE (5a) / PROVISIONAL (5b) | `b3cdb13`, `928c58a` | unit matrix, integration | `ROLE_PERMISSIONS_VERSION` 2 (C-39) |
| ID-006 memberships/coverages | PROVISIONAL (HOST-001/003) | `149f50d` | integration | |
| ID-007 platform operators | PROVISIONAL (HOST-001/003) | `149f50d` | integration | pwd + OTP step-up, `X-Platform-Context` |
| SMS-001 envelope + vault + gates | PROVISIONAL (HOST-001/003) | `ea8b1dd` | unit + integration | AES-256-GCM, KEK ring, GATE-SMS-HTTP chain |
| SMS-002 free provider probe | PROVISIONAL (H-4: staging capture) | `f4e4f4b` | unit 5, integration 2 | worker `GET /internal/diagnostics/sms-balance` + `pnpm ops:capture-sms-probe` |
| SMS-003 port + mock adapter | DONE | `f0d999a` | unit contract | |
| SMS-004 Zaman IT adapter | PROVISIONAL (parser until SMS-002 fixtures) | `f0d999a` | unit contract 17 | |
| SMS-005 OTP over SMS | PROVISIONAL (HOST-001/003) | `b612e4c` | integration | CheckSmsBalance, ReencryptProviderCredentials |
| SMS-008 live smoke | BLOCKED (H-5, account owner only) | `b612e4c` | aborts on `CI=true` | never run by the agent (no real SMS) |
| WEB-001 web shell | PROVISIONAL (HOST-012, staging deploy) | `79994a4`, `ffa92c4` | unit 4, e2e 4 | in-memory tokens, CSRF refresh, bn/en + Noto Sans Bengali |
| MOB-001 mobile workspace + shells | DONE | `12c6fe6`, `615088c`, `47bcfb7`, `fa6dfb5` | Flutter 13 | Melos 8.7.0, generated Dart client, secure storage, OTP mock login |

### Stage 5

| Task | Status | Commit(s) | Tests added | Notes |
|---|---|---|---|---|
| CI-000 CI on GitHub (H-1) | DONE | PR #1 (`33cb023` … `a497860`) | — | self-hosted runner `hmedic-local` via repository variable `CI_RUNS_ON`; pinned gitleaks/osv binaries with checksums; mobile job uses the machine Flutter pinned to `.fvmrc`; pnpm overrides for fastify/mariadb/mysql2/deepmerge-ts advisories; `TRUST_PROXY` replaces `TRUST_PROXY_HOPS` (C-48); `scripts/checkpoint-verify.mjs` |
| PAT-001 migration 0004 + search normalization + lock ranking | PROVISIONAL (HOST-001/003) | `b00299a` | unit (localization 14, database 5), integration engine-contract 28 | 9 tables, 6 generated unique keys, `patient_search_tokens` (C-41), transliteration v1, runtime lock-order enforcement (C-46), migration tooling diffs against migrated sections only |
| PAT-002 registry services | PROVISIONAL (HOST-001/003) | `a9d2806`, `3b0e7a5` | unit 6, integration 10 | create/search/duplicate review, merge (C-47, repointer registry), consents, accounts (OTP auto-link), guardianships, care team, PatientContextResolver |
| PAT-003 contracts + HTTP routes | PROVISIONAL (HOST-001/003) | `3c67674`, `99fcbba` | integration 3 (HTTP) | 50 operations; `@PatientContextRoute`, `@OptionalTenant`, `@TenantMembershipOptional` (D-24); `/me/patient-contexts` live |
| PAT-004 patient context + auto-link on OTP verify | PROVISIONAL (HOST-001/003) | `99fcbba` | integration (in PAT-003 suite) | guard audits `AUTHZ_DENIED` with `patient_context` / `patient_scope:<scope>` |
| PAT-005 seed dataset | DONE | `66a40a0` | `seed:verify` assertions | 65 patients (D-26), duplicate pair + OPEN merge case, guardian with two dependents, accounts ACTIVE/PENDING/SUSPENDED, care team, consents |
| PAT-006 web staff screens | DONE | `621fe99`, `b5847e8` | e2e 4 | search, create with duplicate review, record, merge cases; tenant id persisted (D-22) |
| PAT-007 mobile profile switcher | DONE | `379fb63`, `512ece9` | Flutter 2 (+1 hm_core) | regenerated Dart client; `ReadCache` staleness indicator (D-23) |
| CHAM-000 clinic service | DONE | `05b0aa0` | covered by the scheduling suite | clinics become a managed resource (`clinic.manage`) |
| CHAM-001 migrations 0005/0006 | PROVISIONAL (HOST-001/003) | `64a739d` | integration engine-contract 2 | chambers, schedule rules, chamber days, slots, appointments; serials, check-ins, hash-chained queue events; both generated unique keys |
| CHAM-001 SCHED-001 APPT-001 scheduling services | PROVISIONAL (HOST-001/003) | `79ee67a`, `fa6702c` | unit 9, integration 15 | QueuePolicy defaults (C-44), day-window resolution, materialization, day transitions, booking rules (C-45) |
| SERIAL-001 serial engine (CP4 subset) | PROVISIONAL (HOST-001/003) | `a6948b5`, `fa6702c` | integration 11 | allocation, confirm/cancel/no-show, reschedule, close settlement, ApplyNoShowPolicy; the queue-active lifecycle (check-in → call → complete) is CP5 |
| CHAM-002 contracts | DONE | `456e689` | `openapi:check` | 25 operations (75 total) |
| CHAM-003 APPT-002 routes + composition | PROVISIONAL (HOST-001/003) | `688f904`, `c7b048b` | integration 7 (HTTP) | clinics, chambers, rules, chamber days, appointments, `/me/appointments`; ApplyNoShowPolicy registered in the api (embedded/cron) and the worker |
| CHAM-004 seed dataset | DONE | (CP4) | `seed:verify` assertions | 4 chambers incl. walk-in-only, booking-only and a slotted chamber, weekly rules + both exception kinds, yesterday closed, today open with a delay and a booking mix, a reschedule chain onto tomorrow |

| SERIAL-002 QUEUE-001 QUEUE-002 queue-active lifecycle | PROVISIONAL (HOST-005) | `404928c`, `eb4056b`, `bbf1d58`, `2a4ee0f`, `15179a4` | integration 25 (lifecycle 14, engine 11) | check-in with late-arrival placement, mark-waiting, call/skip/recall, remote-ready, the interim consultation transitions (ADR-021), reorder, the ETagged snapshot and the patient view. Serial numbers allocate through `LAST_INSERT_ID(col)+1` after duplicates appeared under load; the lock ranking exempts rows the transaction already holds |
| QUEUE-CONCURRENCY §4 suite | DONE | `913af0b` | integration 16 | the mandatory races and invariants, with real parallel connections. **10 runs on mariadb:10.6 and 10 on mariadb:11.8, zero failures, zero flakes** (§3a) |
| QUEUE-003 contracts + routes | PROVISIONAL (HOST-001/003) | `3e971ce` | integration 12 (HTTP) | 18 operations (93 total): the snapshot, walk-ins, reorder and the twelve serial transitions. `GET /serials/{id}` is staff-only and `/me/serials/{id}` is the patient view — API §3.5 describes one route for both, and the deviation is recorded there. The HTTP suite found four gaps against the published contract, all fixed: the snapshot never answered `304` to an `If-None-Match` poll (ADR-013/C-09), `GET /me/serials` returned a bare array instead of `SerialListResponse`, cancelling a serial left its appointment BOOKED and holding its slot, and serial transitions driven by a patient context recorded neither `acting_as` nor `on_behalf_of_patient_id` (AUTHORIZATION-MATRIX §3) |
| QUEUE-004 seed queue mix | DONE | `bc33b6e` | `seed:verify` assertions | walk-ins and desk arrivals carried through CHECKED_IN, WAITING, CALLED, SKIPPED, IN_CONSULTATION and COMPLETED; the verifier asserts no two serials on a day share a queue position |
| QUEUE-005 web queue board | DONE | `3e971ce`, `bc33b6e` | e2e 3 | five-second polling with optimistic reconcile, drag reorder carrying `queueOrderVersion`, and the conflict path when another desk wins the race. The poll is conditional on the snapshot's ETag, so a quiet chamber costs a 304 and no re-render |
| QUEUE-006 mobile queue screens | DONE | `3e971ce` | Flutter analyze | doctor board (call / start / complete) and the patient's own serial with people-ahead, estimates and remote-ready; both read through the session cache |

Still open in Stage 5: HOST-005. Out of scope: encounters, clinical, prescriptions, catalog, labs, documents, timeline, follow-ups, communications delivery, telemedicine, payments, AI.

### Stage 6

| Task | Status | Commit(s) | Tests added | Notes |
|---|---|---|---|---|
| DEPLOY-001 single-app deployment profile | DONE (deployed 2026-09-23) | `0b44b3b` (ADR-023) | integration 6 (static-web) | one Passenger app serves the API and the web bundle; `WEB_DIST_DIR` must be **absolute** — Passenger's cwd is the home directory, not the release. A missing bundle logs and continues rather than throwing, so a mis-set path cannot take the API down |
| DEPLOY-002 automated verified pre-migration dump | DONE | `0b44b3b` | integration 5 (`dump.ts`) | in-process dumper on the guard's existing connection; gzip + sha256, verified by reading it back. Replaces the manual `PRE_MIGRATION_DUMP_CONFIRMED` gate that caused the Stage 5 outage (D-01) |
| DEPLOY-003 `sql_mode` guarantee | DONE | `0b44b3b` | integration 3 | `assertStrictSession()` refuses a session without `STRICT_ALL_TABLES`; a permissive server truncates silently, which is how clinical data goes wrong quietly |
| DEPLOY-004 `REAL_PATIENT_DATA_ALLOWED` gate | DONE | `0b44b3b` | integration 2, unit 3 | five gates in §4a; readiness reports the flag |
| TEST-001 HTTP coverage for the 19 uncovered routes | DONE | `17efa77` | integration 19 | found C-49 (list shape) and C-50 (cross-tenant care team) |
| CLIN-001 migration 0007 + invariants | PROVISIONAL (HOST-001/003) | `82ad9f8` | integration engine-contract 4 | `encounters`, `encounter_participants`, `encounter_notes`, `encounter_note_versions`; generated-column unique keys for the one-encounter-per-serial and one-open-draft rules; lock ranks 50/52/54/56 |
| CLIN-002 encounter lifecycle + serial seam | PROVISIONAL (HOST-001/003) | `e6734ce`, `1653ac3`, `0b44b3b` | integration 17 (lifecycle 12, backfill 5) | start/interrupt/resume/complete/entered-in-error; cancelling a serial interrupts its encounter through `EncounterInterruptionPort`; the covering-doctor rule (AUTHORIZATION §3 rule 4) is non-transitive by construction |
| CLIN-002 ADR-021 retirement | PROVISIONAL (HOST-001/003) | `f3a4e35` | integration 10 (8 HTTP + 2 in the queue suite) | `POST /serials/{id}/encounter` and the five `/encounters/{id}/…` routes (99 operations); both interim routes answer `410 ENDPOINT_RETIRED` naming their replacement; web, doctor app and the Dart client moved over. Migration `202609230900_0007_adr021_backfill` backfills Stage 5 serials as `legacy_interim` encounters (C-51) |

| CLIN-003 notes (draft, sign, amend) | PROVISIONAL (HOST-001/003) | `37acac0` | integration 24 (note lifecycle) | one mutable draft per encounter under `row_version`; signing appends to a hash chain per encounter; an amendment is a new revision with a mandatory reason and the one it corrects stays readable. Section limits counted in characters, not bytes (Bangla) |
| CLIN-004 symptoms, diagnoses, migration 0008 | PROVISIONAL (HOST-001/003) | `37acac0` | integration (in the note suite) | `symptom_observations` + `diagnoses`; editable while unsigned, then voided with a reason and replaced. Catalog split to section 0019 (C-52). `ai_approved` unreachable from any path (test 13) |
| CLIN-003/004 routes + clinical access policy | PROVISIONAL (HOST-001/003) | `5a9f00c` | integration 11 (HTTP) | 11 operations (110 total). Two authorization footings: assignment for doctors, chamber scope for nurses. Test 9 found two holes before release — a receptionist reading notes via `encounter.read`, and an unassigned doctor passing the scope fallback (C-54) |
| Clinical metrics (§5) | DONE | `5a9f00c` | asserted by the redaction suite | encounter start latency, autosave and conflict counts, sign latency, active encounters, covering-doctor usage, PHI read volume. No label carries a patient, doctor or encounter id |
| Clinical seed (§7) | DONE | `5a9f00c` | `db:seed:verify` assertions | two completed consultations (one amended, with a voided and replaced diagnosis), one running with an unsigned draft, one interrupted, two legacy ADR-021 encounters. Verified idempotent against a live MariaDB |
| WEB-002 consultation workspace | DONE | `83c1e62` | e2e 8 | one screen: patient header, note editor with autosave and a visible save state, diagnoses, the patient's earlier consultations, sign and complete. A stale save stops and shows both versions rather than picking one. No clinical text in `localStorage` or `sessionStorage`, asserted by reading every key back after a save. Later-stage panels labelled and empty |
| MOB-004 doctor encounter screen | DONE | `83c1e62` | `flutter analyze` + existing suite | note editing, diagnoses with void-and-reason, sign, amend, complete. Same conflict rule as the web; nothing clinical written to device storage. Later-stage panels omitted rather than shown empty |
| `GET /patients/{id}/encounters` | DONE | `83c1e62` | integration 2 | 111 operations. A new route, not in the documented API (C-55): the spec reaches patient history through the Stage 11 timeline. Authorized at patient level so a doctor sees a colleague's earlier consultation; carries no note text |
## 3. Test summary (latest full run)

| Suite | Count | Notes |
|---|---|---|
| unit | 324 | Vitest `unit` project (packages, apps, tooling, scripts) |
| architecture | 40 | depcruise + ESLint rule fixtures |
| integration + security | 365 on mariadb:10.6 · 365 on mariadb:11.8 | Testcontainers, `node scripts/test/run-integration.mjs` |
| security | 10 | Vitest `security` project |
| e2e (Playwright) | 19 | built web app against a mocked API (smoke, patient, queue and consultation flows) |
| mobile (Flutter) | 15 | `dart run melos run test`; `flutter analyze --fatal-infos` clean |

## 3a. Stage 5 load measurements (prompt §4.13)

Recorded on the development machine (Docker Desktop testcontainer), one chamber day, on Prisma 6 with the
Rust query engine (ADR-022):

| Measurement | Result |
|---|---|
| Walk-in issuance, 1 concurrent desk | 65 ms/serial |
| Walk-in issuance, 2 concurrent desks | 54 ms/serial |
| Walk-in issuance, 4 concurrent desks | 50 ms/serial |
| Queue snapshot, 24 concurrent pollers, 72-serial queue | 293 ms total, 12 ms/poll |
| Baseline: raw 15-statement transaction on the same host | 35 ms |

### Mandatory concurrency suite (prompt §4)

`packages/queue/test/integration/queue-concurrency.test.ts`, 16 tests, real parallel connections:

| Series | Runs | Failures | Flakes |
|---|---|---|---|
| mariadb:10.6 | 10 | 0 | 0 |
| mariadb:11.8 | 10 | 0 | 0 |

### R-01 — resolved by the engine change, not by the optimisation

R-01 recorded a walk-in costing ~1.3 s against a 35 ms raw baseline, with concurrency buying nothing.
Profiling attributed it to statement count times round-trip latency: 26 ms of fixed transaction overhead
plus ~30 statements at 7.44 ms each. That was right about the shape and wrong about the cause.

**That 7.44 ms per statement was Prisma 7's WebAssembly query compiler.** Moving to Prisma 6's native Rust
engine — forced by the deployment target, not chosen for speed (ADR-022) — took a walk-in from 1027 ms to
65 ms at one desk, roughly fifteen times faster, with no change to the queue code. The raw-driver baseline
is now 35 ms against our 65 ms, so the remaining overhead is about one extra round trip's worth rather than
thirty.

What the earlier work contributed, and what it did not:

- `QueueEventWriter.appendMany` batches a walk-in's three-to-four queue events into one chain pass, taking
  the chain lock once instead of three times. It is still the right shape and is kept, but it accounted for
  a 24% improvement against a problem that was an order of magnitude larger.
- The per-tenant audit chain was **disproved** as the bottleneck, and that conclusion still holds.
- The remaining levers noted then (two redundant re-reads, one mergeable pair of queries, ~24 → 16
  statements) are no longer worth taking on these numbers. Revisit only if HOST-004 on the Hostinger plan
  shows per-statement latency far above the development host.

One property of the speedup is worth recording: it immediately exposed a race in the worker singleton test,
which had waited for *exactly* four succeeded jobs while asserting five. It passed for as long as runs were
slow enough for a poll to land mid-flight. Faster code finds tests that were only ever passing by timing.

Consequence today: the documented 5 s transaction budget is no longer close to binding at these latencies.
Re-measure on the Hostinger plan as part of HOST-004 before the first busy clinic goes live — the numbers
above are from a development container, and the plan has already shown a 6x spread against it.

## 4. Open HOST items

**HOST-001, HOST-003 and HOST-004 are PASS on the real plan** (2026-09-20, recorded in
`HOSTING-VERIFICATION.md` §5.1). They were run as SQL against the plan's MariaDB over SSH rather than
through the deployed probe app, because the probe deploy was blocked on an unrelated build failure; the
checks are the same ones `apps/host-probe/src/probes.ts` performs, and the scratch tables were dropped.

Two results change assumptions elsewhere:

- **The plan runs MariaDB 11.8.9**, not the 10.6 the design assumed (§5 row 2 said to re-pin to the real
  series once known). The CI matrix now tests `mariadb:10.6` (the documented floor) and `mariadb:11.8` (the
  deployed series); `mariadb:11.4` is dropped, because it is neither the floor nor production and testing
  three series costs CI time for no coverage the other two do not give.
- **The server's `sql_mode` is not strict** (`NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION`). The per-connection
  session init (ADR-014) sets `STRICT_TRANS_TABLES` and `+00:00`, and both were accepted — so the guarantee
  holds, but it rests entirely on that session init rather than on a server default.

`GET_LOCK` is exclusive across connections, so the singleton runner and migration lock work as designed and
the `singleton_locks` lease fallback is not needed.

**HOST-005 remains open** and cannot be shortened: it needs 24 h of observation under a 1-minute cron ping,
then 2 h with the cron off to measure the idle stop. Until it is recorded, `JOB_RUNNER_MODE` for a deployed
worker is a guess between `worker` and `cron`.

HOST-002 and HOST-006…013 are still pending the human run of
`docs/implementation/runbooks/HOST-VERIFICATION-RUNBOOK.md` (H-2). Record results with
`pnpm host:record-results`.

## 4a. Real patient data gate (DEPLOY-004)

`REAL_PATIENT_DATA_ALLOWED` is **false** in production, and `/health/ready` reports it. Until the owner
turns it on, the installation holds synthetic records only. Stage 6 does not change this: it builds the
clinical tables, it does not open them to real patients.

Conditions outstanding before it can be turned on:

| # | Condition | Why it blocks real data |
|---|---|---|
| G-1 | A password recovery path exists | D-18: the deployed reset notifier is a no-op, so the reset endpoint answers `202` and delivers nothing. **Partly addressed in Stage 7 (OPS-001):** `pnpm ops:reset-owner-password` is a break-glass CLI — two invocations with a confirmation token, refuses without a dump from the last 24 h, revokes every session, writes an audit row (runbook: `RUNBOOK-RECOVERY.md`). **The gate stays open.** It asks for a recovery path a *user* can reach; this one needs SSH and a person who already has database access. Whether that is sufficient for this installation is the owner's call, not the agent's |
| G-2 | HOST-005 recorded | `JOB_RUNNER_MODE` for a deployed worker is still a guess between `worker` and `cron`; reminders and no-show processing depend on it |
| G-3 | HOST-006…013 recorded | Backup, restore, storage and egress behaviour on the plan are unverified |
| G-4 | A restore drill completed | A backup nobody has restored is not a backup. DEPLOY-002 automates the dump; the drill proves it can be read back. **Mechanism built in Stage 7 (OPS-002):** `pnpm ops:restore-drill` restores into a throwaway database and checks tables, rows and migration state against the dump manifest, verified against a real dump. **The gate stays open:** a drill against a *production* dump is the evidence, and that is a human action (H-6) |
| G-5 | The single-app profile deployed and observed | DEPLOY-001 changes the process model; real data should not be the first traffic through it. **Deployed 2026-09-23** and serving the client at `/` with the API under `/api/v1`; the observation window is what remains |

The config refuses the flag outside production, and refuses it while `SMS_PROVIDER=mock`, because a
patient who cannot be reached is not a patient who can be treated.

## 5. Human action queue

| # | Action | Why | Blocking |
|---|---|---|---|
| H-1 | ~~Create the GitHub repository, push `main` and tags, protect `main`/`staging`~~ **DONE** (`scornik/hmedicare`, private; `main` requires linear history, so merges are `--rebase`) | CI now runs on every PR and on `main` | — |
| H-2 | Run the remaining HOST verification runbook items. **HOST-001, 002, 003 and 004 are PASS** (recorded 2026-09-20/22); HOST-005 needs 24 h of cron-pinged observation plus 2 h idle; HOST-006…013 are still pending | HOST evidence | HOST-005 blocks the deployed `JOB_RUNNER_MODE` choice |
| H-3 | Pin the gitleaks tarball SHA-256 in `ci.yml` (today it is checked against the release checksums file) | supply-chain hardening | — |
| H-4 | SMS-002 capture on staging (`pnpm ops:capture-sms-probe`, ZAMANIT-VERIFICATION §3.1) with the owner's Zaman IT key | fixtures for the adapter parser; ZAMANIT-VER-01/02 | SMS-004 final |
| H-5 | SMS-008: exactly one live SMS by the account owner (ZAMANIT-VERIFICATION §4) | charge/format evidence | SMS-008 |
| H-6 | Staging setup: DB, three Hostinger apps, env vars, repository variables `STAGING_API_URL`/`STAGING_WORKER_URL`/`STAGING_WEB_URL`, `staging` environment | first staging deploy via `promote-staging` | after H-1, H-2 |
| H-7 | Native-speaker review of the Bangla UI strings (web `messages.ts`, mobile `strings.dart`) | copy quality | — |
| H-8 | ~~Set `WEB_DIST_DIR` on the production app to the **absolute** release path~~ **DONE** (2026-09-23): set to the absolute release path (`/home/<user>/hbuilds/current/apps/web/dist`), not `apps/web/dist` | Passenger runs with the home directory as cwd, so a relative path finds nothing. DEPLOY-001 is built but not serving the web bundle until this is set | DEPLOY-001 deployment |
| H-10 | Run `scripts/ops/verify-clinical-loop.mjs` against production to close CP8's deployed-walkthrough condition. `HM_BASE_URL=https://hmedicare.hakeemify.com HM_EMAIL=<owner> HM_PASSWORD=<owner password> HM_DOCTOR_PROFILE_ID=<tenants.owner_doctor_profile_id> node scripts/ops/verify-clinical-loop.mjs` | the script walks queue → encounter → note → sign → diagnosis → amend → complete and checks the properties, not just the status codes. It needs a login, which this agent does not hold | CP8 acceptance |
| H-11 | ~~Production has one user and no recovery path~~ **TOOLING DONE** (2026-09-24, OPS-001): `pnpm ops:reset-owner-password` exists and is documented. What remains is a decision, not code — either record the owner password durably, or accept the CLI as the recovery path and close G-1 | the CLI needs SSH, so it is a break-glass path rather than a user-facing one | G-1 |
| H-9 | ~~Delete the two retired ADR-021 routes one release after Stage 6~~ **DONE** (2026-09-24, Stage 7): the routes, the `QueueService` methods behind them and the 410 tests are gone; 109 operations | — | — |

## 6. Deviations

| ID | Deviation | Reason | Follow-up |
|---|---|---|---|
| D-27 | The deploy host unpacks packages as `0644`, and `fix-native-exec-bits.mjs` did not cover `@prisma/engines`. The first deploy with a migration to apply died on `EACCES` spawning the schema engine, the API refused to boot behind it, and production served 503 (2026-09-23) | the schema engine is spawned **only when a migration is pending**, so every earlier deploy looked healthy and the gap stayed invisible until it mattered. The predicate now lives in `scripts/host/native-binaries.mjs` and is tested by filename (16 cases). The guarded migration also reported `unexpected error (see stderr)` while holding the real message in the exception it discarded, telling the operator nothing; it now prints the child's stderr with connection strings scrubbed | — |
| D-01 | ~~Pre-migration dump is a manual gate (`PRE_MIGRATION_DUMP_CONFIRMED=<APP_VERSION>`)~~ **RESOLVED** in Stage 6 (DEPLOY-002): the deploy takes the dump, verifies it and refuses to migrate if it fails | it cost a production outage — the Stage 5 merge added three migrations, the guard refused, and Passenger restart-looped on a 503 until someone set a variable by hand | — |
| D-02 | `MIGRATION_APPLIED` is written by api/worker on startup, not by migrate-guarded | avoids a `database → audit` cycle | — |
| D-03 | Migration 0014 creates only `integrity_chain_checkpoints` | `backup_runs`/`restore_drills` belong to OPS | later OPS migration |
| D-04 | `@testcontainers/mariadb` instead of `@testcontainers/mysql` | native MariaDB module | — |
| D-05 | `tooling/*` workspace for the ESLint plugin and the seed | keeps tools out of `packages/` | — |
| D-06 | `apps/host-probe` holds the HOST diagnostics (amended by D-17) | probes need scratch tables and a dedicated DB | — |
| D-07 | Runner mode names follow the docs (`worker`/`embedded`/`cron`/`off`) | BUILD-CONTRACT precedence | — |
| D-08 | MinIO runs under a compose profile | object storage is out of Stage 4 | — |
| D-09 | No git remote; tasks merged locally (fast-forward of task-scoped commits, split per the 600-line rule) | H-1 | squash policy applies once PRs exist |
| D-10 | `packages/http-kit` (C-36); no `nestjs-pino` (C-37); `TRUST_PROXY_HOPS` (C-38; replaced by `TRUST_PROXY` in Stage 5, C-48) | see audit rows | — |
| D-11 | The dev OTP inbox (`/internal/test/otp/:id`) is enabled in `development` as well as `test` | `pnpm dev` OTP login without SMS | never in staging/production (config-guarded) |
| D-12 | Seed uses `@example.invalid` (prompt) instead of `@example.test` (SEED-DATA) | Stage 4 prompt precedence | align SEED-DATA wording |
| D-13 | `ResponseMeta.replayed` is `boolean` (was literal `true`) | swagger_parser emits a broken enum for boolean enums | server behaviour unchanged |
| D-14 | Mobile pins below latest: `go_router` 17.5.0, `build_runner` 2.15.1, `retrofit_generator` 10.2.9 | newer versions need a Flutter newer than 3.44.8 (FVM pin) | revisit with the next Flutter pin |
| D-15 | `hm_offline` (Drift, outbox, uploads) not created | MOB-002 scope | MOB-002 |
| D-16 | Bangla font: web bundles `@fontsource/noto-sans-bengali` (OFL-1.1, font-only license exception); mobile uses the platform Noto Sans Bengali | no font CDN; mobile bundle size | bundle a font in mobile if iOS rendering needs it |
| D-17 | The worker exposes one diagnostic route (`/internal/diagnostics/sms-balance`, SMS-002), off by default and refused in production | the SMS-002 spec requires the probe from the staging worker (egress proof) | — |
| D-18 | Password reset uses a no-op notifier in deployed environments | the email adapter is out of Stage 4 | email adapter stage |
| D-19 | Local Playwright may use an installed browser (`PW_CHANNEL=msedge`); CI installs the pinned bundled Chromium | no browser download on the dev machine | — |
| D-20 | `/me/patient-contexts` returns `[]` until patients exist | Stage 5 | Stage 5 |
| D-21 | `apps/web` re-implements the `VITE_*` secret-name check instead of importing `packages/config` | dependency rule `web-only-contracts-and-ui` | — |
| D-22 | Web keeps the selected tenant id in `localStorage` (`hm.tenant`) | reloads and deep links lost the tenant; the id is a UI preference, not auth state (WEB §2) | — |
| D-23 | Mobile patient context is selected per launch; reads are cached in memory only (`hm_core` `ReadCache`) | `hm_offline` (Drift) is MOB-002; no new dependency added | MOB-002 |
| D-24 | `POST /patients/{id}/guardianships` is membership-optional (`@TenantMembershipOptional`) | a patient user has no membership and no context before the link exists (AUTHORIZATION-MATRIX §4) | — |
| D-25 | Merge review UI is gated on `patient.merge` (held by nurse/receptionist per the role catalog), not on admin roles | AUTHORIZATION-MATRIX is the source of truth | — |
| D-26 | Seed has 65 patients (prompt: ~60); generated namesakes are created with an acknowledged duplicate review | the duplicate scorer flags the generator's repeated names | — |
| D-27 | The seed books yesterday's chamber day through a second service instance whose clock sits at 18:00 local yesterday | booking a past date is refused by the booking rules, and the seed uses only real use cases | — |
| D-28 | The demo chambers that accept remote patients use `telemedicinePaymentMode: OPTIONAL_ONLINE` | the documented default `PREPAID_REQUIRED` answers `FEATURE_DISABLED` while payments are absent (C-45), so a remote demo booking would be impossible | revisit when payments land |
| D-29 | `queue_events.idempotency_key` is scoped by chamber day (`<requestId>:<eventType>:<chamberDayId>`) | one request may touch two chamber days (reschedule), and the request id alone collided on `uq_queue_events_idempotency` | — |
| D-30 | Scheduling and queue are composed together by `composeSchedulingAndQueue` behind a `SerialPortRef` | the two contexts are mutually dependent (a day settles serials, a serial reschedules through an appointment); the ref keeps the cycle explicit and bound exactly once | — |
| D-31 | The CP4 seed reaches BOOKED, CONFIRMED, CANCELLED, NO_SHOW and RESCHEDULED serials only | the queue-active states need the CP5 commands (check-in, call, skip, complete) | CP5 extends the same dataset |
| D-32 | Serial numbers are allocated with an atomic counter statement (LAST_INSERT_ID) rather than a read-then-write under the day lock | the concurrency suite produced duplicate serial numbers: the second statement carried its own snapshot | — |
| D-33 | Prisma P2028 (interactive-transaction timeout) is treated as a retryable lock error | it is what fires when a transaction spends its budget queued behind a hot row lock; without it a busy chamber day returned a raw Prisma error instead of QUEUE_BUSY | — |
