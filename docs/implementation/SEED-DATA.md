# Synthetic Seed Data Contract

**Stage 3.1 rewrite (2026-09-17).** **Stage 3.2 update (2026-09-17):** synthetic catalog rows, fee schedules, merchant accounts, intents in every state, SMS credentials and balance snapshots, platform operator (§2.5). The real medicine dataset is **not** part of the seed.

## 1. Rules

- Every row is synthetic and visibly marked: tenant names prefixed `DEMO`, and a `seed_marker` in JSON metadata where a column exists.
- No real patient names, phone numbers, emails, national IDs, prescriptions, documents, audio, transcripts or provider credentials.
- **Phones** use the reserved synthetic range `+8801700000000`–`+8801700000999`. **Emails** use `@example.test`.
- **No real AI keys.** Mock-provider credentials use secrets generated at seed time (`fake_mock_<32 random hex>`). They are encrypted with the local development KEK and never printed.
- Demo passwords and OTP mock codes are generated at seed time and printed **only** to the local terminal. They are never written to tracked files.
- The seed is deterministic by `SEED_VERSION` + `SEED_RANDOM_SEED`, resettable (`pnpm db:reset && pnpm db:seed`), and refuses to run when `APP_ENV=production`.
- Seed data goes through application use cases where practical, so invariants, events, audit chains and timeline projection are exercised. Bulk rows use repositories inside transactions.

## 2. Dataset

### 2.1 Tenants and organization

| Item | Contents |
|---|---|
| `DEMO Chamber Group` (tenant A, `GROUP`) | 2 clinics, 3 chambers, doctors Dr. A1 and Dr. A2, nurse, receptionist, clinic admin, tenant owner, billing manager |
| `DEMO Solo Practice` (tenant B, `SOLO`) | 1 clinic, 1 chamber, owner doctor Dr. B1 (assigned to all tenant patients) |
| Coverage | Dr. A2 covers Dr. A1 from seed-date to seed-date + 3 days, plus an expired coverage from last week |
| Schedules | Weekly rules and exceptions across the Asia/Dhaka date boundary (a chamber day starting 23:30 local is **not** allowed; edge cases use 00:00–00:30 local instants for timezone tests) |

### 2.2 Patients, accounts and guardianship

| Item | Contents |
|---|---|
| Patients (tenant A) | 40 patients with Latin and Bangla names (Bangla NFC), mixed contact verification states, 2 duplicate-review candidates, 1 merge case OPEN |
| Patient accounts | P1 `SELF` ACTIVE via `OTP_PHONE_MATCH` in tenant A **and** tenant B (same user, two tenants → exercises the tenant picker); P2 PENDING (phone matches two patients → staff verification required); P3 SUSPENDED |
| Guardian with two dependents | User G (also patient P4 `SELF`) with ACTIVE guardianships over dependents D1 (child, scope `VIEW_RECORDS`, `BOOK_APPOINTMENTS`, `MANAGE_SERIALS`, `JOIN_TELEMEDICINE`, `GIVE_CONSENT`) and D2 (elderly parent, scope `VIEW_RECORDS`, `MANAGE_COMMUNICATION_PREFERENCES`), plus one PENDING self-requested guardianship and one ENDED guardianship |
| Care team | Nurse N1 as `NURSE` care-team member for 5 patients (one ended membership); Dr. A2 as `DOCTOR` care-team member for patient P5 (not otherwise assigned) |
| Consents | `care` for all; `ai_assistance` GRANTED for 10 patients, WITHDRAWN for 1, absent for others |

### 2.3 Queue and clinical

| Item | Contents |
|---|---|
| Chamber days | Today (OPEN) and tomorrow (SCHEDULED) per chamber |
| Serials | Mixed physical/remote: BOOKED, CONFIRMED, CHECKED_IN (with `waitingRequiresConfirmation` chamber), WAITING, CALLED with recall deadline, SKIPPED with recall count 1, IN_CONSULTATION, COMPLETED, NO_SHOW (auto policy), CANCELLED, RESCHEDULED → new BOOKED serial on tomorrow, one duplicate-override serial with reason |
| Encounters | Completed encounters with signed note revisions (one with a correction revision), symptoms, diagnoses (doctor and `ai_approved`), prescriptions (DRAFT, REVIEWED, APPROVED, a VOID+corrected pair), lab reports with placeholder PDFs, follow-ups |
| Documents | Generated placeholder PDFs/PNGs (text "SYNTHETIC DEMO DOCUMENT") stored via the configured adapter: MinIO (`s3`) or the temp dir (`disk`); one REJECTED fixture (PNG bytes declared as PDF) |
| Timeline | Projected via jobs; one `REDACTED` marker example |
| Communication and telemedicine | Mock delivery attempts (sent, delivered, failed with fallback); mock sessions |

### 2.4 AI

| Item | Contents |
|---|---|
| Tenant policies | **Tenant A: free-tier AI disallowed** (`ai_enabled=true`, `free_tier_ai_allowed=false`, `allowed_provider_codes=["mock"]`). **Tenant B: free-tier AI allowed** (`free_tier_ai_allowed=true`, policy event history with actor and version) |
| Acknowledgements | Tenant B Dr. B1: current acknowledgement for `mock`/FREE (synthetic text version `v1`); one superseded acknowledgement (older text version, revoked `TEXT_VERSION_SUPERSEDED`) |
| Credentials (mock provider only; all statuses) | Dr. A1: `PENDING_VALIDATION`, `ACTIVE` (PAID declared → `NO_TRAINING_CONTRACTUAL` via mock metadata), `INVALID`, `DISABLED`, `REVOKED` (tombstoned). Dr. B1: `ACTIVE` FREE (`MAY_TRAIN_OR_REVIEW` via mock-free metadata entry used for tests), `QUOTA_EXHAUSTED` FREE, and a fallback order [paid-active, free-active] demonstrating that fallback may-train → no-train is allowed but not the reverse |
| Usage counters near quota | Dr. B1 active FREE credential: `DAY` window at `quota_hint.requestsPerDay − 2` (the hint is a synthetic seed value, not a provider number), a `MINUTE` window with `last_429_at` 30 s ago and `retry_after_until` 30 s ahead; ledger rows for the last 7 days |
| Model catalog | `mock` provider models: `mock-text-v1` (text + json_schema), `mock-audio-v1` (audio; for disabled transcription tests), `mock-deprecated-v0` (`deprecated_at` set) |
| AI jobs/drafts | SUCCEEDED with draft `READY_FOR_REVIEW`; draft `IN_REVIEW` with suggestions ACCEPTED, EDITED, REJECTED and APPROVED (linked `ai_approvals` → note section and diagnosis); FAILED `PHI_MINIMIZATION_FAILED`; `WAITING_RATE_LIMIT`; CANCELLED `AI_CREDENTIAL_REVOKED`; EXPIRED draft; prompt-injection fixture draft with a dropped unsourced suggestion count |

**Mock metadata note.** The `mock` adapter has two register rows (`AI-PROVIDER-REGISTER.md` §2): `mock`/FREE → `MAY_TRAIN_OR_REVIEW` and `mock`/PAID → `NO_TRAINING_CONTRACTUAL`. Both policy paths are therefore exercisable without real providers, with no special flags.

### 2.5 Payments, SMS, catalog, platform (Stage 3.2)

| Item | Contents |
|---|---|
| Medication catalog | 25 synthetic rows (`is_synthetic=1`, brands `DEMO-Paracet 500`, generics like "Demo-generic A", manufacturer "DEMO Pharma Ltd", `canonical_key` prefixed `synthetic:`, `dataset_version=synthetic-seed-v1`, `review_status=UNVERIFIED`), 5 aliases (1 `generated`), 2 observed prices labelled "observed price, may differ". **No rows from the real Stage M dataset**; that is the opt-in `pnpm meddata:import` step |
| Fee schedules | Tenant A: tenant `CHAMBER_CONSULTATION` 500.00, chamber-specific override 700.00 for one chamber, doctor-level `TELEMEDICINE_CONSULTATION` 400.00, `FOLLOW_UP` 300.00, a retired schedule; tenant B: tenant `CHAMBER_CONSULTATION` 0.00 (payment not required) |
| Chamber payment modes | one `PREPAID_REQUIRED`, one `OPTIONAL_ONLINE`, one `PAY_AT_CHAMBER` |
| Merchant accounts | Dr. A1 `DOCTOR_MERCHANT` `mock` sandbox `ACTIVE` (fake credentials), clinic-owned `UNVERIFIED_UNTIL_FIRST_PAYMENT`, an `INVALID` one, tenant A platform opt-in row `BLOCKED_BY_GATE` (demonstrates the gate), tenant B platform opt-in `ACTIVE` (development environment only) |
| Payment intents | one per status (`CREATED`, `REDIRECTED`, `PENDING_VERIFICATION`, `PAID` with ledger, `FAILED`, `CANCELLED` superseded, `EXPIRED`, `REFUND_PENDING`, `REFUNDED`), one late payment with `manual_review_status=OPEN`, one verification `MISMATCH`, one unmatched IPN event |
| Appointments | `PENDING_PAYMENT` with a live hold (no serial), one released (`CANCELLED`, `PAYMENT_NOT_COMPLETED`), one `WAIVED` with reason |
| Payouts, subscriptions | synthetic plans `DEMO-Basic` / `DEMO-Pro`; tenant A `ACTIVE` subscription with one `PAID` and one `OPEN` invoice; tenant B `PAST_DUE`; one `DRAFT` payout for tenant B platform-merchant payable entries |
| SMS | tenant A `TENANT_ACCOUNT` credential (`mock`, fake key) `ACTIVE`, one `SUSPENDED_BALANCE`; balance snapshots for 30 days (platform + tenant) including one `UNPARSED`; communication attempts with `ACCEPTED`, `INSUFFICIENT_BALANCE`, `UNKNOWN_OUTCOME` + `possible_duplicate` retry |
| Platform | one platform operator (`ops` + `catalog` permission sets) for the demo operator user; `platform_gate_decisions` empty (all gates OPEN); one medicine gate attestation for `synthetic-seed-v1` (`IMPORT_SAFEGUARDS_VERIFIED`, evidence `DEMO`) |

## 3. Demo accounts

Identifiers use `*.example.test` emails and synthetic phones. The seed command prints generated credentials to the local terminal only.

## 4. Seed assertions (`pnpm db:seed --verify`)

- Tenant boundaries (no cross-tenant FK), and one shared physical/remote queue per chamber day.
- Every serial status present; the reschedule chain is linked.
- Approved vs draft prescriptions; `REVIEWED` not renderable.
- Timeline projection coverage, including the redaction marker, and all hash chains verifying.
- Guardian contexts: G sees self plus D1 plus D2 with the correct scopes; P1 sees two tenants.
- AI: tenant A blocks free-tier activation; tenant B allows it with an acknowledgement; every credential status is present; no credential DTO exposes secret fields; usage near quota is reported as an estimate.
- Payments: every intent status present; every `PAID` intent has a balanced posting and a `MATCHED_SUCCESS` verification; `PENDING_PAYMENT` appointments have no serial; no merchant/SMS DTO exposes a secret; all amounts are 2-decimal strings.
- Catalog: every seeded medication `is_synthetic=1`; no real dataset `canonical_key` present.
