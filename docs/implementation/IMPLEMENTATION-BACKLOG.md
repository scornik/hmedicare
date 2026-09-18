# Implementation Backlog

**Stage 3.2 additions (2026-09-17):**
- Phase 2b adds SMS-001…005, SMS-008 and ID-007, **before real OTP go-live**.
- Phase 4b adds PAY-001…012 and PAY-014, **after scheduling/queue**.
- Phase 7 adds MEDDATA-001…005 **alongside RX-001**.
- Phase 9 adds SMS-006, SMS-007 and PAY-013.
- Phase 11 adds WEB-004 and MOB-005.
- Phase 12 adds SMS-009, PAY-015 and MEDDATA-006.
- Existing tasks are amended: ID-003, CLIN-004, RX-001, COM-002, SEC-001, OPS-001, RELEASE-001.

**Stage 3.1 re-sequence (2026-09-17).**
- **Removed:** the Redis/BullMQ tasks (Stage 3 FOUND-003 "BullMQ ports", FOUND-005 "Redis infrastructure").
- **Added:** HOST, JOB, AICRED, AIPOL, ADAPT, and PAT-006 onwards.

Each task lists: **ID · Phase · Module · Dependencies · Files/packages · DB changes · API changes · UI changes · Tests · Acceptance · Risk**. "—" means none.

**Ordering rule:**
- Phase 0 HOST tasks start in the first week of Stage 4, in parallel with Foundation.
- **Database-dependent Foundation work (FOUND-004, JOB-002) may proceed on the documented defaults, but is not "final" until HOST-001, HOST-003 and HOST-005 pass.** If a result differs, an audit row and follow-up tasks are created before later phases continue.

---

## Phase 0 — Hosting verification (real Hostinger plan, staging, synthetic data)

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| HOST-001 | 0 | ops | FOUND-007, FOUND-011 | `apps/worker` diagnostics, `tests/hosting/host-001.md` | reads only | `GET /internal/diagnostics/db` | — | engine version, limits, collation, 30-connection probe | Result row appended to HOSTING-VERIFICATION §5; DB image pin updated to the reported series | **High**: <10.6 blocks SKIP LOCKED |
| HOST-002 | 0 | ops | FOUND-007, FOUND-011 | diagnostics runtime | — | `GET /internal/diagnostics/runtime` | — | Node version, heap limit vs `NODE_OPTIONS`, argon2/sharp load, pnpm subfolder build | Node 24 + heap limits honored; native modules load (or fallbacks recorded) | Med |
| HOST-003 | 0 | database | FOUND-004, HOST-001 | `packages/database/test/engine-contract` | scratch tables (dropped) | diagnostics runner | — | engine-contract suite against staging DB | All pass or `JOB_CLAIM_STRATEGY` switched + audit row | **High** |
| HOST-004 | 0 | database | HOST-003 | engine-contract | — | — | — | GET_LOCK two connections; ALTER DATABASE charset; trigger attempt (informational) | Lock exclusivity confirmed or `singleton_locks` fallback enabled | Low |
| HOST-005 | 0 | jobs | JOB-005, FOUND-011 | worker `/health/live` bootId, `tests/hosting/host-005.md` | — | — | — | 24 h keep-alive observation; cron disabled 2 h idle-stop measurement; crash restart | Runner mode decided (worker vs cron) and recorded | **High**: worker lifecycle |
| HOST-006 | 0 | ops | FOUND-011 | hPanel cron config, `infrastructure/hostinger/cron/*.sh` | — | `/internal/jobs/run` | — | interval verification; `curl`/`node` availability | 1-min interval confirmed or latency documented | Med |
| HOST-007 | 0 | storage | DOC-003, FOUND-011 | disk probe | — | diagnostics storage | — | persistence across 2 redeploys; web reachability probes (T12) | Disk adapter approved or production S3 mandated | Med |
| HOST-008 | 0 | ops | FOUND-011, FOUND-004 | `hostinger:build:*`, migrate-guarded | migration probe table | — | — | DB reachable at build; failing migration keeps live version; concurrent deploy lock | Migration path decided (build vs startup fallback) | **High** |
| HOST-009 | 0 | ops | FOUND-011 | `tests/hosting/host-009.md` | — | — | — | RTT from Dhaka broadband/4G; egress to AI/S3/SMS sandbox hosts | Region confirmed (India) or changed | Low |
| HOST-010 | 0 | ops | OPS-002 | restore compose | restore into local Docker | — | — | download plan DB backup + restore; check storage dir inclusion | Restore verified; backup layers confirmed | Med |
| HOST-011 | 0 | observability | FOUND-008 | — | — | — | — | JSON logs visible; redaction visible; OTLP egress | Logging approach confirmed | Low |
| HOST-012 | 0 | web | WEB-001, FOUND-011 | `infrastructure/hostinger/web.htaccess` | — | — | static site | deep-link reload, headers, SSL, app count | SPA fallback works or hash routing adopted | Low |
| HOST-013 | 0 | api | DOC-005, FOUND-011 | — | — | uploads/downloads | — | 8 MiB part, 50 MiB stream, 25 s request, CORS preflight, forwarded headers | Limits confirmed or chunk size lowered | Med |

## Phase 1 — Foundation

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| FOUND-001 | 1 | repo | — | root `package.json` (pnpm 12.4.2, engines Node 24), `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `eslint.config.mjs`, `prettier.config.mjs`, `.dependency-cruiser.cjs`, `tsconfig.base.json`, empty context packages with `src/{domain,application,infrastructure,public,nest}` | — | — | — | depcruise rule fixtures (each rule fires) | Structure matches REPOSITORY-STRUCTURE; CI-ready scripts | Low |
| FOUND-002 | 1 | config | FOUND-001 | `packages/config` | — | — | — | env schema tests; production fail-closed; `VITE_*` secret-name check | ENVIRONMENT-CONTRACT enforced | Low |
| FOUND-003 | 1 | kernel | FOUND-001 | `packages/kernel` | — | — | — | UUIDv7, Result, error codes table test vs API-IMPLEMENTATION §4 | Kernel leaf-only (depcruise) | Low |
| FOUND-004 | 1 | database | FOUND-002, FOUND-005 | `packages/database` (Prisma 7.10.0, `@prisma/adapter-mariadb`, `prisma.config.ts`, tx/locks/claims/errors, `db:migration:normalize`/`lint`, migrate-guarded, engine-contract suite) | charset/collation baseline | — | — | engine-contract (EXPLAIN, CHECK==Zod harness, generated unique harness, lock-wait, deadlock, Bangla, Dhaka boundary), migrate from clean, lint rejects triggers | Contract suite green on pinned `mariadb:10.6` | **High** (final after HOST-001/003) |
| FOUND-005 | 1 | infra | FOUND-001 | `infrastructure/docker/compose.yaml`, mariadb conf, MinIO, `mock-providers` service | local DBs | — | — | compose healthchecks | `pnpm infra:up` works without paid providers | Low |
| FOUND-006 | 1 | api | FOUND-002, FOUND-003, FOUND-008 | `apps/api` (Nest 11.2.5 + Fastify, nestjs-zod 5.5.0, ProblemDetails, request ID, CORS, security headers, health) | — | `/health/live`, `/health/ready` | — | Supertest health/error/CORS | API shell runs locally and in CI | Low |
| FOUND-007 | 1 | worker | FOUND-006 | `apps/worker` (HTTP shell, token-protected internal endpoints, diagnostics controller behind flag) | — | `/health/*`, `/internal/*` | — | token tests (T10 subset) | Deployable worker shell for HOST tasks | Low |
| FOUND-008 | 1 | observability | FOUND-002 | `packages/observability` (pino, redaction incl. provider key patterns, metrics registry, OTLP optional) | — | `/internal/metrics` | — | redaction suite (T1 patterns) | No secret/PHI in logs | Med |
| FOUND-009 | 1 | ci | FOUND-001…008 | `.github/workflows/ci.yml` (SHA-pinned actions) | — | — | — | CI jobs static/unit/db/api | CI blocks failures | Low |
| FOUND-010 | 1 | contracts | FOUND-003, FOUND-006 | `packages/contracts` (zod 3.25.76, zod-to-openapi 7.3.4 V31 + V3, TS client), dart smoke job | — | OpenAPI artifacts | — | generation diff; Dart generation 3.0 + 3.1 + analyze | Contract pipeline green | Med (frozen lib) |
| FOUND-011 | 1 | deploy | FOUND-006, FOUND-007, FOUND-009 | `hostinger:build:*` scripts, `infrastructure/hostinger/*`, `promote-staging.yml` | staging DB created (manual hPanel step documented) | — | — | build rehearsal job | Staging api/worker deployed from `staging` branch | **High** |
| FOUND-012 | 1 | audit | FOUND-004, JOB-001 | `packages/audit` (AuditPort, ChainAppender, VerifyAppendOnlyChains) | `audit_logs`, `integrity_chain_checkpoints` (via 0002/0014) | — | — | chain append/verify, tamper detection (T15) | Hash chains verified | Med |
| FOUND-013 | 1 | jobs | JOB-001 | `packages/jobs` Idempotency + RateLimiter ports | `idempotency_records`, `rate_limit_counters` | idempotency interceptor | — | replay / in-progress / reused / TTL; rate-limit window | DB-backed idempotency and rate limits work | Med |

## Phase 1b — Database job queue (ADR-015)

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| JOB-001 | 1b | jobs | FOUND-004 | migration 0001 | `singleton_locks`, `jobs`, `dead_letters`, `job_concurrency_leases`, `rate_limit_counters` | — | — | migration lint; EXPLAIN claim index | Tables match DATABASE-IMPLEMENTATION §3.1 | Low |
| JOB-002 | 1b | jobs | JOB-001 | `packages/jobs` JobPort, `SkipLockedClaimer`, `ConditionalUpdateClaimer` | — | — | — | two-connection claim tests both strategies; no filesort | Both strategies pass same contract | **High** (final after HOST-003) |
| JOB-003 | 1b | jobs | JOB-002 | runner loop, leases, heartbeat, reclaim, backoff, dead letters, payload schema registry | — | — | — | lease expiry, lost-lease completion rejected, dead-letter after max attempts, non-retryable class | Runner semantics per ADR-015 §3 | Med |
| JOB-004 | 1b | jobs | JOB-003 | concurrency leases | `job_concurrency_leases` | — | — | per-key limit 1 with two runners | Never two concurrent jobs per key | Med |
| JOB-005 | 1b | jobs | JOB-003, FOUND-007 | runner modes `worker`/`embedded`/`cron`, GET_LOCK singleton + `singleton_locks` fallback, `/internal/jobs/run` | — | `POST /internal/jobs/run` | — | two processes singleton; cron batch budget; T10 | Mode selectable by env | **High** (HOST-005) |
| JOB-006 | 1b | jobs | JOB-003, FOUND-012 | outbox publisher, subscriptions registry | `outbox_events` (0002) | — | — | at-least-once, duplicate suppression, ordered handler concurrency key | Outbox → jobs in one store | Med |
| JOB-007 | 1b | jobs | JOB-003 | `MaintenanceScheduler`, `MaintenanceTtlCleanup` | — | — | — | batch deletes, time budget, metrics | TTL tables cleaned | Low |
| JOB-008 | 1b | ops | JOB-003, ID-005 | dead-letter replay | — | `POST /internal/ops/dead-letters/{id}/replay` | — | authz + audit | Replay audited | Low |

## Phase 2 — Identity and tenant

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| ID-001 | 2 | identity/tenant | FOUND-004, JOB-001 | migration 0002 | tenants, users, memberships, clinics, doctor/staff profiles, doctor_coverages, audit_logs, outbox_events, idempotency_records | — | — | constraints, composite FKs, generated uniques | Tables per §3.2 | Low |
| ID-002 | 2 | identity | ID-001 | migration 0003; SessionService, TokenService (jose EdDSA), Argon2idHasher | sessions, refresh_tokens, password_reset_tokens, email_verification_tokens, push_devices | password login, refresh, logout, logout-all, reset | — | rotation, reuse detection, token_version revoke, no secrets in logs | Auth core works | Med |
| ID-003 | 2 | identity | ID-002, FOUND-013 | OtpService, `OtpDeliveryPort` + `MockOtpDelivery` (renamed from `MockOtpProvider`, Stage 3.2) | otp_challenges | `/auth/otp/request`, `/verify` | — | expiry, attempts, supersede, enumeration-safe, rate limits | OTP locally without paid provider | Med |
| ID-004 | 2 | identity | ID-002 | CsrfService, cookie transport | — | `/auth/session/csrf`, cookie flows | — | T17; SameSite/`__Host-` attributes | Web transport per ADR-013 §2 | Med |
| ID-005 | 2 | identity | ID-002 | PolicyEngine, ROLE_PERMISSIONS v1, ActorContext/TenantContext, route metadata guards | — | `/me` | — | authorization-matrix.spec (doc parse ↔ fixture ↔ engine) | Matrix enforced | **High** |
| ID-006 | 2 | tenant | ID-005 | membership mgmt, coverage mgmt | — | `/memberships`, `/doctor-coverages` | admin settings | coverage window, non-transitive | Coverage grants work | Low |

## Phase 2b — Provider credentials, SMS and OTP delivery (Stage 3.2, ADR-018) — before real OTP go-live

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| SMS-001 | 2b | secrets / provider-credentials | ID-002, JOB-001 | `packages/secrets` (`SecretEnvelopePort` moved from `ai`, `GateDecisionReader`), `packages/provider-credentials` (`ProviderCredentialVault`), `scripts/ops/record-risk-decision.ts`, `ReencryptProviderCredentials` job | migration 0015: `platform_operators`, `platform_gate_decisions`, `provider_credentials` | — | — | AAD mismatch, KEK rotation (T14 pattern), fingerprint duplicate, tombstone on revoke, gate decision expiry/revocation, chain verification | Secrets stored encrypted only; gate reader returns closed only for a valid unexpired decision | **High** |
| SMS-002 | 2b | ops / communication | FOUND-007, FOUND-011, HOST-009 | worker diagnostics `GET /internal/diagnostics/sms-balance` (token, `DIAGNOSTICS_ENABLED`), capture script redacting key/phone, `ZAMANIT-VERIFICATION.md` §3 | — | diagnostics route (staging only) | — | free `checkbalance` probes: POST form, HTTPS attempt, wrong key (1001 format), 20× latency; **no send** | ZAMANIT-VER-01/02/13/14 recorded; redacted fixtures committed under `fixtures/verified/` | **High** (HTTP transport) |
| SMS-003 | 2b | communication / communication-adapters | FOUND-003, SMS-001 | `SmsProvider` port, `MockSmsAdapter`, `mock-providers` `/zamanit/api/*` routes with scenario control | — | — | — | every outcome/error-code scenario; balance shapes | Mock reproduces success, 1001–1007, timeout-after-send, 5xx, unparseable, low balance | Low |
| SMS-004 | 2b | communication-adapters | SMS-003, SMS-002 | `packages/communication-adapters/zamanit` (POST form client, phone conversion, GSM-7/UCS-2 detection + segment estimate, response parser from SMS-002 fixtures, error mapping, HTTP gate check, ESLint rules `no-get-provider-call`/no TLS disable) | — | — | — | contract vs mock; T27, T28; key never in URL/logs | Adapter passes contract; production refuses `http://` without gate + flag | **High** |
| SMS-005 | 2b | identity-access / communication | ID-003, SMS-004 | `OtpDeliveryPort` rename, `SmsOtpDelivery`, templates `otp_login`/`otp_phone_verify` (bn-BD/en-BD) + template lint, `OTP_TTL_SECONDS`=180 | — | `/auth/otp/request` outcome handling (no auto-resend) | OTP resend UX (web login, patient app) | T30; template 1-segment check; enumeration-safe responses unchanged | OTP login works end-to-end with the Zaman IT adapter against mock-providers | Med |
| SMS-008 | 2b | ops | SMS-005, SMS-002 | `tests/live-smoke/zamanit.live.test.ts` (aborts on `CI=true`; 10-min lock file) | — | — | — | **one** live SMS to `ZAMANIT_LIVE_SMOKE_TO` | Message received; charge observed; ZAMANIT-VER-03/07/17 recorded; no key in captured logs | Med |
| ID-007 | 2b | identity-access | ID-005, SMS-001 | `PlatformOperatorResolver`, `X-Platform-Context` guard, `pnpm ops:platform-operator grant\|revoke`, OTP step-up for operators, `POST /tenants` moved behind `platform.tenants.bootstrap` | `platform_operators` (0015) | platform route guard; `PLATFORM_CONTEXT_REQUIRED` | operator login (web `/platform`) | T31; platform permission rejected in memberships | Minimal audited operator role usable by later tasks | Med |

## Phase 3 — Patient, accounts, guardianship

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| PAT-001 | 3 | patient | ID-001 | migration 0004 (patients, contacts, identifiers, consents, merge cases) | as listed | — | — | generated uniques, encryption of identifier values | Tables per §3.4 | Low |
| PAT-002 | 3 | localization | FOUND-003 | phone normalization (libphonenumber-js) | — | — | — | local/international/invalid, Bangla digits | E.164 + display | Low |
| PAT-003 | 3 | patient | PAT-001, ID-005 | create/search/update | — | `/patients` | web search/create | duplicate scoring, min fields, audit, rate limit | Patient persists across visits | Med |
| PAT-004 | 3 | patient | PAT-003 | merge workflow | — | merge-case routes | merge review | no silent merge | Review + audit | Low |
| PAT-005 | 3 | patient | PAT-003 | consents API | — | consent routes | consent UI | guardian GIVE_CONSENT scope | Consent rows versioned | Low |
| PAT-006 | 3 | patient | PAT-001, ID-003 | `patient_accounts`, auto-link on OTP verify, staff verify | patient_accounts | `/patient-accounts/*`, `/me/patient-contexts` | patient app contexts | unique match only; multi-match pending; multi-tenant picker | One user sees multiple clinics | Med |
| PAT-007 | 3 | patient/identity | PAT-006 | `patient_guardianships`, PatientContextResolver, `X-Patient-Context` guard | patient_guardianships | guardianship routes | profile switcher | scope, PENDING denied, expiry, on-behalf audit | Dependents usable safely | **High** |
| PAT-008 | 3 | patient/identity | PAT-001, ID-006 | care_team_members, AssignmentPolicy (5 rules) | care_team_members | care-team routes | care team panel | each rule, solo tenant, coverage | Assignment defined once and tested | **High** |

## Phase 4 — Chamber, scheduling, serial engine

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| QUEUE-001 | 4 | scheduling | PAT-001 | migration 0005 | chambers, schedule rules, chamber_days (next_serial_number, queue_order_version, row_version), slots, appointments | — | — | timezone/unique/check tests | Chamber days by local date + tz | Low |
| QUEUE-002 | 4 | queue | QUEUE-001 | migration 0006 | serials (active_patient_day_key), check_ins, queue_events (chain) | — | — | duplicate active serial DB rejection | Constraints per §3.6 | Med |
| QUEUE-003 | 4 | scheduling | QUEUE-001 | chamber-day materialization, open/pause/close | — | chamber-day routes | — | recurrence/exception, Dhaka boundary | Days materialize safely | Low |
| QUEUE-004 | 4 | queue | QUEUE-002, ID-005, FOUND-013 | serial allocation (walk-in + appointment) | — | walk-ins, appointment serial | — | multi-process allocation, idempotency replay/reused, lock-wait → QUEUE_BUSY | Distinct gap-free serials | **High** |
| QUEUE-005 | 4 | queue | QUEUE-004 | transition engine `SERIAL_TRANSITIONS` + confirm/check-in/remote-ready/mark-waiting/call/skip/recall/no-show/cancel | — | serial routes | — | full transition table; call/skip race; IN_CONSULTATION cancel interrupts encounter (with CLIN-002) | Invalid transitions rejected | **High** |
| QUEUE-006 | 4 | queue | QUEUE-005 | reschedule (two-day lock) | — | `/serials/{id}/reschedule` | — | terminal old serial, linked new serial, idempotent | Reschedule chain correct | Med |
| QUEUE-007 | 4 | queue | QUEUE-005 | reorder, delay, policy (`queue_order_version`) | — | reorder/delay/policy routes | — | reorder vs walk-in, stale reorder | Conflict-safe reorder | Med |
| QUEUE-008 | 4 | queue | QUEUE-005, JOB-007 | `ExpireRecallDeadlines`, `ApplyNoShowPolicy` jobs | — | — | — | local-time cut-offs across UTC midnight | Policy jobs correct | Med |
| QUEUE-009 | 4 | queue | QUEUE-005 | patient-facing serial view (estimated position / people ahead), ETag polling | — | `GET /serials/{id}`, `/me/serials`, queue ETag | patient serial screen | no other-patient data | Minimized patient view | Med |

## Phase 4b — Payments (Stage 3.2, ADR-019) — after scheduling/queue

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| PAY-001 | 4b | payments / kernel / scheduling | QUEUE-001, SMS-001 | kernel `Money`; migrations 0017, 0018; 0005 amendments (chamber payment modes, appointment `PENDING_PAYMENT` + payment columns); lint `no-float-money`, OpenAPI money lint | all payment/subscription tables | — | — | generated uniques (§4.1 Stage 3.2 rows), CHECKs, no FLOAT/DOUBLE, Money parse/round | Schema per DATABASE §3.15–3.18 | Med |
| PAY-002 | 4b | payments | PAY-001, ID-005 | `FeeResolver`, `FeeQuotePort`, `SetFeeSchedules` | `fee_schedules` | `GET/PUT /tenant/fee-schedules` | (web in WEB-004) | precedence chamber→doctor→tenant, overlap rejection, `STALE_VERSION`, 0.00 → not required | Fees resolved server-side | Low |
| PAY-003 | 4b | payments / provider-credentials | PAY-001, SMS-001 | `MerchantResolver`, merchant account + payment settings use cases, `ValidateMerchantCredential` job, platform collection gate | `payment_merchant_accounts`, `tenant_payment_settings`, `provider_credentials` (PAYMENT) | `/tenant/payment-merchant-accounts*`, `/tenant/payment-settings` | — | T23, T26; environment mismatch; ownership | Doctor/clinic merchant accounts and platform opt-in resolve per ADR-019 §2 | **High** |
| PAY-004 | 4b | payment-adapters | FOUND-003 | `PaymentGatewayPort`, `MockPaymentGateway`, `mock-providers` `/aamarpay/*` (jsonpost, trxcheck GET, fake payment page, IPN sender, scenario control) | — | — | fake payment page | all PAYMENT §10 scenarios | Mock usable end-to-end locally | Low |
| PAY-005 | 4b | payment-adapters | PAY-004 | `packages/payment-adapters/aamarpay` (JSON initiate, GET search with URL redaction and no request logging, parsers for JSON-as-text/html and plain-text mismatch, credential check) | — | — | — | contract vs mock with production parsers; redaction test (no `signature_key` anywhere) | Adapter passes contract | Med |
| PAY-006 | 4b | payments | PAY-002, PAY-003, PAY-005, FOUND-013 | `CreatePaymentIntent` (+ supersede), attempts, customer field rules (`cus_email` fallback) | `payment_intents`, `payment_attempts` | `POST/GET /payments/intents`, `GET /payments/intents/{id}` | — | T24; idempotent replay without `paymentUrl`; one open intent | Server-computed intents with gateway URL | **High** |
| PAY-007 | 4b | payments | PAY-006, JOB-006, FOUND-012 | return + IPN handlers, `PaymentVerificationService`, `LedgerPoster` | `payment_gateway_events`, `payment_verifications`, `ledger_entries` | `/payments/aamarpay/return/*`, `/payments/aamarpay/ipn` | web `/payments/result/:id` (WEB-004) | T18–T21; concurrent return+IPN; posting sums; chain verify | No client input or callback alone marks `PAID` | **High** |
| PAY-008 | 4b | payments / scheduling / queue | PAY-007, QUEUE-004 | prepaid booking holds, `ConfirmPaidAppointment`, `ReleasePaymentHolds`, `WaiveAppointmentPayment`, facade methods (audit C-24) | appointment payment columns | booking response `paymentRequired`/`quote`; `POST /appointments/{id}/payment-override` | — | no serial while `PENDING_PAYMENT`; one serial after PAID; hold release frees capacity; waiver audited | Prepaid booking flow works with mock gateway | **High** |
| PAY-009 | 4b | payments | PAY-007, JOB-007 | `ReconcilePaymentIntents`, late payment handling, `ResolvePaymentReview` | — | `POST /payments/intents/{id}/review` | — | T25; expiry; reconciliation backoff | Stuck intents resolve; late payments reviewed | Med |
| PAY-010 | 4b | payments | PAY-007 | manual refunds (request/complete/cancel), ledger reversal | `refunds` | refund routes | — | `REFUND_NOT_ALLOWED` matrix; reversal sums | Refunds recorded with evidence | Med |
| PAY-011 | 4b | payments | PAY-010, ID-007 | payouts preview/create/mark-paid, platform commission | `payouts`, `payout_items` | `/platform/payouts*`, `/platform/tenants/{id}/payment-commission` | operator console (WEB-004) | each payable entry paid once; operator-only | Manual payout records for platform-merchant fees | Med |
| PAY-012 | 4b | payments | PAY-007 | subscription plans (synthetic seed), `GenerateSubscriptionInvoices`, subscription payment consumer | subscriptions tables | `/tenant/subscription*` | `/subscription` (WEB-004) | invoice generation, `PAST_DUE` informational only | Tenants can pay platform subscriptions (platform merchant) | Low |
| PAY-014 | 4b | ops | PAY-008, FOUND-011 | staging sandbox runbook: sandbox payments with ≥ 2 methods (success, fail, cancel, expire), IPN setup request, support questions, Hakeemify live store credential lookup (random id; **no payment**) | — | — | — | PAY-AAM-01…16 | `AAMARPAY-VERIFICATION.md` §3 statuses updated; differing defaults → audit rows | **High** |

## Phase 5 — Consultation and clinical records

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| CLIN-001 | 5 | clinical | QUEUE-005 | migration 0007 | encounters (serial_encounter_key), participants, encounter_notes (draft), encounter_note_versions (chain) | — | — | one encounter per serial; one open draft | Tables per §3.7 | Low |
| CLIN-002 | 5 | clinical | CLIN-001, PAT-008 | start/interrupt/resume/complete/entered-in-error + SerialLifecyclePort | — | encounter routes | — | state, assignment, atomic serial transitions | Completed serial links one encounter | **High** |
| CLIN-003 | 5 | clinical | CLIN-002 | note draft autosave (row_version), sign, correction revisions | — | note routes | workspace note editor | autosave conflict; revision+reason | Notes per C-10 | Med |
| CLIN-004 | 5 | clinical | CLIN-002 | migration 0008 (symptoms, diagnoses, patient_medications; catalog tables defined by MEDDATA-001 in the same migration file set); symptoms/diagnoses API | as listed | symptom/diagnosis routes | workspace panels | source=`doctor`, catalog no invented seed | Structured clinical records | Low |

## Phase 6 — Documents and labs

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| DOC-001 | 6 | laboratory-documents | FOUND-004 | migration 0010 | documents, document_versions, upload_sessions, parts, lab_reports, lab_results | — | — | constraints | Tables per §3.10 | Low |
| DOC-002 | 6 | storage-adapters | FOUND-005 | `storage-adapters/s3` + shared contract suite | — | — | — | contract suite on MinIO | S3 adapter passes contract | Med |
| DOC-003 | 6 | storage-adapters | DOC-002 | `storage-adapters/disk` | — | — | — | contract suite + traversal (T11) + startup root checks | Disk adapter passes contract | Med |
| DOC-004 | 6 | storage-adapters | DOC-002 | `scanner-mock`, `scanner-baseline` (file-type, sharp, pdf-lib) | — | — | — | MIME spoof, PDF JS reject, EXIF strip, documented limits | Scanning per ADR-016 | Med |
| DOC-005 | 6 | laboratory-documents | DOC-001, DOC-003, JOB-003, PAT-007 | upload sessions, parts, finalize, scan job, download tokens/stream | — | `/documents/upload-sessions*`, `/documents/{id}/download-token`, `/download` | upload manager (web) | FILE-STORAGE §6 API tests | Unauthorized users cannot download | **High** |
| DOC-006 | 6 | laboratory-documents | DOC-005, CLIN-002 | lab reports/results/review; disk usage job | — | `/lab-reports*` | labs views | requires AVAILABLE document | Raw report authoritative | Low |

## Phase 7 — Prescription

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| RX-001 | 7 | prescriptions | CLIN-004, MEDDATA-001 | `MedicationSearchPort` + free-text fallback (works with a catalog holding only synthetic rows, and in production with no rows until MEDDATA-006) | — | `/medications/search` (implemented in MEDDATA-004) | — | no invented data; free-text path without catalog | Prescribing works with or without imported catalog | Low |
| MEDDATA-001 | 7 | prescriptions / localization | CLIN-004, FOUND-004 | catalog schema per DATABASE §3.8 (Stage 3.2), search-key normalizer in `packages/localization`, synthetic catalog seed rows | `medications` (redesigned), `medication_generics`, `medication_generic_links`, `medication_manufacturers`, `medication_aliases`, `medication_price_observations`, `medication_usage_stats`, `medication_dataset_imports`, `medication_dataset_gate_attestations` | — | — | generated uniques; normalizer (Bangla digits, NFKC, punctuation) | Catalog tables ready; seed rows `is_synthetic=1` | Low |
| MEDDATA-002 | 7 | prescriptions | MEDDATA-001 | importer core + `pnpm meddata:import` CLI (`ajv@8.20.0`, `ajv-formats@3.0.1`, checksums, pinned schema set `stage-m-v1`, upserts, deactivation, veterinary exclusion, price precision, checkpoints), `meddata-mini` synthetic fixture | import rows | — | — | PRESCRIPTION §5.5; T32 | Real `medicine-dataset-20260917-4` imports locally with the expected counts (50,214 medications) | Med |
| MEDDATA-003 | 7 | prescriptions | MEDDATA-002, DOC-003, JOB-003, ID-007 | `ImportMedicationDataset` job (worker mode, lease renewal), `pnpm meddata:stage`, admin import and attestation use cases, production refusal | `medication_dataset_gate_attestations` | `/admin/medications/imports*`, `/admin/medications/datasets/{version}/gate-attestations`, `/gates` | operator console imports (WEB-004) | production gate refusal; one active import; resume after worker restart; SFTP-staged disk path readable (staging) | Staging import succeeds with provenance; production refuses without gates | Med |
| MEDDATA-004 | 7 | prescriptions | MEDDATA-001, RX-001 | `SearchMedications` ranking tiers, tenant boost, `RecordMedicationUsage` consumer | `medication_usage_stats` | `GET /medications/search`, `GET /medications/{id}` | — | ranking (generated aliases lowest; boost never crosses tiers), tenant isolation of boost, p95 < 150 ms on the imported 50k catalog (staging) | Search per ADR-020 §4 | Med |
| MEDDATA-005 | 7 | web / mobile | MEDDATA-004, RX-003 | editor catalog source indicator, "form not mapped" badge, free-text marked, optional observed price label, snapshot on selection | `prescription_items.catalog_snapshot` | — | prescription editor (web + doctor app) | no dose prefill; badge visible; price label text | Import safeguards verifiable for gate `IMPORT_SAFEGUARDS_VERIFIED` | Low |
| RX-002 | 7 | prescriptions | CLIN-002 | migration 0009 | prescriptions (revision, row_version, generated uniques), items | — | — | one approved/one open draft per encounter | Tables per §3.9 | Med |
| RX-003 | 7 | prescriptions | RX-002, RX-001 | draft create/edit, review | — | create/patch/review routes | editor | REVIEWED → DRAFT on edit; nurse review grant | Editor contract | Med |
| RX-004 | 7 | prescriptions | RX-003, PAT-008 | approve, void, correction | — | approve/void/corrections | approval screen | assignment, stale version, atomic correction | Only assigned doctor approves | **High** |
| RX-005 | 7 | prescriptions | RX-004, DOC-002, JOB-003 | render worker (pdfmake, Bangla font reviewed) | — | render route | PDF view | snapshot hash, retry, idempotent | Render ≠ approval | Med |

## Phase 8 — Timeline and follow-up

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| TL-001 | 8 | timeline | JOB-006, FOUND-012 | migration 0011 (timeline_events, projection_checkpoints) | as listed | — | — | append-only + chain | Tables per §3.11 | Low |
| TL-002 | 8 | timeline | TL-001 | projector, redaction markers, rebuild | — | — | — | idempotent projection, marker insert, rebuild compare | Timeline rebuildable | Med |
| TL-003 | 8 | timeline | TL-002, ID-005, PAT-007 | timeline API (doctor/patient views) | — | `/patients/{id}/timeline` | timeline views | source resolution, redaction hidden | Views correct | Med |
| FUP-001 | 8 | follow-up | CLIN-002, QUEUE-004 | follow-up plans/tasks + booking facade | follow_up_plans/tasks (0011) | follow-up routes | follow-up UI | linked future serial, Dhaka due dates | Follow-up creates linked serial | Low |

## Phase 9 — Communication and telemedicine

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| COM-001 | 9 | communication | JOB-006 | migration 0012 (communication tables, webhook events) | as listed | — | — | idempotency, consent | Intent vs attempt | Low |
| COM-002 | 9 | communication-adapters | COM-001, SMS-003 | mock email/WhatsApp/push (SMS mock from SMS-003) | — | webhook route | — | success/retry/webhook dup | No paid credentials | Low |
| COM-003 | 9 | communication | COM-002 | delivery job, fallback, queue notifications | — | communication routes | delivery status | retry no duplicate | Delivery works on mocks | Med |
| SMS-006 | 9 | communication | COM-003, SMS-004 | transactional SMS templates (serial/appointment/payment), template lint (no PHI), `communication_short_links`, credential selection, outcome mapping and duplicate-safe retry (COMMUNICATION §6.2) | 0012 attempt SMS columns, `communication_short_links` | — | delivery status incl. `possible_duplicate` | T29; retry at most once after `UNKNOWN_OUTCOME`; `INSUFFICIENT_BALANCE` reschedule | Transactional SMS on mock and Zaman IT adapter (mock server) | Med |
| SMS-007 | 9 | communication | SMS-006, SMS-001, ID-007 | tenant SMS credentials, `ValidateSmsCredential`, `CheckSmsBalance`, snapshots, platform balance and spend estimate, balance/key-age alerts | 0016 `sms_balance_snapshots` | `/tenant/sms-credentials*`, `/platform/sms/balance` | `/settings/sms`, operator SMS balance (WEB-004) | T22 (SMS keys), suspension/reactivation, `UNPARSED` alert | Balance monitored; tenant accounts optional | Med |
| PAY-013 | 9 | payments / communication | PAY-007, SMS-006 | `payment_received`, `payment_link` notifications (consented channels), staff-assisted payment short link/QR | — | — | payment link display | template lint; short link login required | Payers notified without PHI | Low |
| TELE-001 | 9 | telemedicine | CLIN-002 | session tables/API (0012) | telemedicine tables | session routes | join UI | token scope/expiry | Session tied to remote encounter | Med |
| TELE-002 | 9 | telemedicine-adapters | TELE-001 | mock video provider | — | — | — | reconnect/failure | Mock join works | Low |

## Phase 10 — AI credentials, policy, adapters, drafts

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| AICRED-001 | 10 | ai | CLIN-004, PAT-005, JOB-004 | migration 0013 | all AI tables + `diagnoses.ai_approval_id` | — | — | constraints, uniques, composite FKs | Tables per §3.13 | Med |
| AICRED-002 | 10 | ai | AICRED-001 | `SecretEnvelopePort` + AES-GCM adapter, fingerprint, `ReencryptAICredentials` | — | — | — | AAD mismatch, rotation (T14), no plaintext persisted | Envelope encryption per ADR-017 §4 | **High** |
| AICRED-003 | 10 | ai | AICRED-002, ID-005 | credential lifecycle use cases + DTOs without secrets | — | `/doctors/me/ai/credentials*`, `/doctors/{id}/ai/credentials*` | web + doctor app credential screens | T1–T7 secret leakage, A vs B, admin cannot read, duplicate, PLATFORM_MANAGED → FEATURE_DISABLED | Add/revoke safely | **High** |
| AICRED-004 | 10 | ai | AICRED-003, ADAPT-001 | `ValidateAICredential` job | — | `…/{id}/validate` | status chips | status mapping incl. rate-limit reschedule | Validation sets status | Med |
| AICRED-005 | 10 | ai | AICRED-003 | fallback order, usage counters/ledger, usage API | — | fallback-order, usage | usage screen | estimates labeled; fallback eligibility truth table | Usage visible as estimate | Med |
| AIPOL-001 | 10 | ai | AICRED-001 | tenant AI policy + events (chain) + production gate enforcement | tenant_ai_policies/events | `/tenant/ai-policy` | tenant owner settings | default false; production gate forces false (T16) | Opt-in recorded with version/actor | **High** |
| AIPOL-002 | 10 | ai | AIPOL-001 | acknowledgement texts (bn/en, versioned, sha256), record API, version invalidation job | ai_data_use_acknowledgements | ack routes | ack screen | outdated version rejected; credential back to PENDING on new version | Ack required before activation | Med |
| AIPOL-003 | 10 | ai | AIPOL-001, PAT-005 | effective policy engine, consent check, raw-media block | — | — | data-use chips | truth table; POLICY_BLOCKED paths with zero provider calls | Policy encoded, not documented only | **High** |
| AIPOL-004 | 10 | ai | AIPOL-003 | `PhiMinimizationService` (detectors, token map, restore, residual scan, report) | — | — | — | T8 (Latin/Bangla/Banglish names, phones, NID, dates), fail-closed, restore | Nothing identifying reaches may-train mock | **High** |
| ADAPT-001 | 10 | ai-adapters | FOUND-003 | `AIProvider` port, error taxonomy, `MockAIProvider` + all fixtures, metadata format, register parser test | — | — | — | every error class fixture; register ↔ metadata | Mock usable end-to-end | Low |
| ADAPT-002 | 10 | ai | ADAPT-001, JOB-007 | model catalog + `RefreshAIModelCatalog` | ai_model_catalog | `/ai/models` | model picker | no hard-coded model ids (lint) | Catalog-driven models | Low |
| ADAPT-003 | 10 | ai-adapters | ADAPT-001 | `GeminiApiAdapter` (fetch, models.list, structured output, error mapping, tier-signal investigation) with recorded synthetic fixtures | — | — | — | MockAgent fixtures; no network | Adapter passes contract; `productionGate: OPEN` | Med (terms gates AIREG-002/003) |
| ADAPT-004 | 10 | ai-adapters | ADAPT-001 | `OpenAICompatibleAdapter` (base URL config, json_schema where supported, per-provider metadata rows) | — | — | — | contract via mock-providers service | Adapter passes contract | Med |
| AI-001 | 10 | ai | AICRED-004, AIPOL-004, ADAPT-002, TL-003 | AI jobs, `RunAIJob`, retrieval (source resolution, stale fallback), raw output storage + purge | — | note-draft, history-summary, jobs, cancel; transcription → FEATURE_DISABLED | trigger buttons | rate-limit wait, quota, revoked mid-job, deprecated model, fallback rules | Jobs run safely on mock | **High** |
| AI-002 | 10 | ai | AI-001 | drafts/suggestions review states, expiry job | — | drafts/suggestions review routes | review UI | state machines, closed draft rejects | Review flow | Med |
| AI-003 | 10 | clinical | AI-002, CLIN-003, CLIN-004 | `ApproveAISuggestion` (note section, diagnosis), worker DI container tests, depcruise rules | — | approve route | per-item approve | nurse denied; atomic approval; unique per row_version; PRESCRIPTION_ITEM → FEATURE_DISABLED | No AI final write without doctor | **High** |

## Phase 11 — Clients

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| WEB-001 | 11 | web | FOUND-010, ID-004 | `apps/web` shell (Vite, React Router, TanStack Query, generated client, in-memory token, CSRF refresh, `.htaccess`) | — | — | login, tenant select | Playwright auth, no web storage tokens | Web shell deployed to staging | Low |
| WEB-002 | 11 | web | WEB-001, QUEUE-009, CLIN-003, RX-004, TL-003 | queue (polling) + consultation workspace | — | — | queue, workspace | Playwright critical flows | Doctor completes manual consultation | Med |
| WEB-003 | 11 | web | WEB-002, AI-003, AICRED-005, AIPOL-002 | AI settings/review UI | — | — | AI screens | data-use chips, no bulk approve | AI UI per contract | Med |
| WEB-004 | 11 | web | WEB-002, PAY-009, PAY-011, PAY-012, SMS-007, MEDDATA-003, ID-007 | `/settings/payments`, `/settings/fees`, `/settings/sms`, `/payments`, `/payments/result/:intentId`, `/subscription`, `/platform/*` operator console; `.well-known` App/Universal Link files | — | — | listed routes | WEB-IMPLEMENTATION §7 Stage 3.2 flows; bundle secret scan | Staff manage fees/merchants/SMS; patients see results; operators run imports/payouts | Med |
| MOB-001 | 11 | mobile | FOUND-010 | `mobile/` Melos workspace, FVM pin, hm_* packages, swagger_parser generation | — | — | shells | analyze/widget | Workspace builds | Low |
| MOB-002 | 11 | mobile | MOB-001, DOC-005 | auth/API/offline/upload managers (proxied + direct), polling | — | — | — | idempotency reuse, upload resume, process death | No duplicate mutation offline | Med |
| MOB-003 | 11 | mobile | MOB-002, PAT-007, QUEUE-009 | patient app (contexts, dependents, booking, serial polling, records) | — | — | patient flows | guardian scope, multi-tenant | Patient MVP flows | Med |
| MOB-005 | 11 | mobile | MOB-003, PAY-008 | patient pay-for-appointment flow (`flutter_custom_tabs` exact version pinned here), App Links/Universal Links result route, payment history | — | — | `/booking/:id/pay`, `/payments/result/:intentId`, `/payments` | MOBILE §9 Stage 3.2 integration; build output secret scan | Patient pays via external browser tab; app never holds gateway credentials | Med |
| MOB-004 | 11 | mobile | MOB-002, CLIN-003, RX-004, AI-003 | doctor app (queue, encounter, prescription, AI review, credentials) | — | — | doctor flows | secret field cleared; review per item | Doctor MVP flows | Med |

## Phase 12 — Security, operations, release

| ID | Phase | Module | Deps | Files/packages | DB | API | UI | Tests | Acceptance | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| SEC-001 | 12 | security | all MVP backend | `tests/security` T1–T32 + carried list | — | — | — | blocking in CI | Critical threats covered | Med |
| OPS-001 | 12 | ops | FOUND-008 | alert definitions (incl. Stage 3.2 SMS balance/key age/HTTP gate expiry, payment mismatch/forgery/stuck intents), external monitor wiring (decision), runbooks (incl. `zamanit-key-rotation.md`, payment manual review, refund procedure) | — | — | — | alert fire drills (staging) | Alerts tested | Med |
| OPS-002 | 12 | backup-adapters | JOB-007 | `EncryptedDatabaseDump`, file backup, `BackupDestinationPort` (mock + S3-compatible), retention | migration 0014 (backup_runs, restore_drills) | restore-drill record endpoint | — | streaming memory bound, manifest, encryption | Off-site encrypted backups | **High** |
| OPS-003 | 12 | ops | OPS-002, HOST-010 | restore drill tooling + first drill | restore_drills | — | — | ops:verify-restore | Drill passed and audited | **High** |
| OPS-004 | 12 | ops | OPS-001 | load tests on staging (k6) within ADR-013 ceiling | — | — | — | p95 thresholds | Scale ceiling validated | Med |
| SMS-009 | 12 | ops / release | SMS-008, SMS-002 | send `zamanit-provider-request.md`; record answers; switch to HTTPS if offered; otherwise the accountable owner records or declines `GATE-SMS-HTTP` (expiring) via `ops:record-risk-decision`; first scheduled key rotation rehearsal | `platform_gate_decisions` row (or none) | — | — | T28 against production-like config | Production SMS either HTTPS, or HTTP with a valid owner decision, or disabled | **High** |
| PAY-015 | 12 | release | PAY-014, PAY-003 | legal/financial research record for platform collection of patient fees (aggregation/facilitation, tax, accounting, payouts); decision to keep `PAYMENTS_PLATFORM_COLLECTION_ENABLED=false` or record `GATE-PAY-PLATFORM-COLLECTION`; `PAYMENTS_ENABLED` production decision after PAY-014 | gate decision row (optional) | — | — | T26 | Doctor-merchant payments may go live; platform collection only with a recorded gate | **High** |
| MEDDATA-006 | 12 | release / prescriptions | MEDDATA-003, MEDDATA-005 | evidence for the four dataset gates: source legal review, clinician/pharmacist sample review (size, error rate), DGDA cross-reference completion, safeguards verification; attestations recorded per version | `medication_dataset_gate_attestations` | — | — | production refusal until complete | Production catalog imported only with all four attestations; otherwise stays empty and free-text prescribing is used | **High** |
| RELEASE-001 | 12 | release | all | production readiness checklist: HOST results, gates (legal AIREG-001…, clinician sample review, DGDA cross-reference, import safeguards), Stage 3.2 gates (`GATE-SMS-HTTP`, `GATE-PAY-PLATFORM-COLLECTION`, `GATE-MEDDATA-PROD`, PAY-014, ZAMANIT-VER results), promotion workflow | — | — | — | promote-production dry run | Stage 4 exit criteria met; no compliance claim | **High** |
