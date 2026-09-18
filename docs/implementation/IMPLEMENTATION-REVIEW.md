# Implementation Review

**Stage 3.1 rewrite (2026-09-17); Stage 3.2 update (2026-09-17)** for Zaman IT SMS/OTP (ADR-018), aamarPay payments (ADR-019) and the medicine dataset import (ADR-020): §2.1, §3.1, §4, §5, §6. This document reviews whether Stage 4 (Foundation Implementation) can start without inventing decisions. It makes no legal, financial or regulatory compliance claim.

## 1. Verdict

| Dimension | Result |
|---|---|
| Consistency | **PASS WITH OPEN QUESTIONS.** The open questions are external and each has a default, a fallback and a Stage 4 task (`ARCHITECTURE-CONSISTENCY-AUDIT.md`). |
| Implementation readiness | **READY** for Stage 4 starting with HOST-001 and FOUND-001. Production release is **NOT READY** until the production gates in §4 close. |

## 2. Readiness gate

| # | Question | Answer | Reasons |
|---|---|---|---|
| 1 | Can Foundation start without major decisions? | **YES** | Every tool is pinned to one choice and version (`TECHNOLOGY-STACK.md`). The layout and dependency rules are exact (`REPOSITORY-STRUCTURE.md`). Environment variables, scripts, CI jobs and build commands are specified (`ENVIRONMENT-CONTRACT.md`, `LOCAL-DEVELOPMENT.md`, `CI-CD.md`, `DEPLOYMENT.md`). FOUND-001…013 carry files, tests and acceptance. |
| 2 | Can the database be implemented on the Hostinger engine without inventing schema? | **YES** | `DATABASE-IMPLEMENTATION.md` covers every table in migrations 0001–0018 (0015–0018 and the 0005/0008/0012 amendments added in Stage 3.2): columns, types, CHECKs, generated-column uniques, composite tenant FKs, indexes and append-only chains. It targets the MariaDB 10.6 feature floor, proven on 10.6.28 and 11.4.13 images. The exact Hostinger version is UNVERIFIED (HOST-001), but that changes only the image pin. |
| 3 | Are PostgreSQL constructs translated? | **YES** | ADR-014's normative translation table covers `timestamptz`, `jsonb`, `citext`, UUID generation, partial uniques, enums, RLS, triggers, advisory locks and `text[]`. The sweep (`STAGE-3.1-CHANGELOG.md` §4) finds no untranslated construct in implementation documents. Remaining mentions are in original architecture text that carries change logs, or in translation and rejection records. |
| 4 | Is the serial engine implementable? | **YES** | The inputs are complete: the transition table, `QueuePolicy` defaults, the split chamber-day versions, the generated unique for active serials, the lock order and `lockRow`, and MariaDB sequence diagrams. Mandatory concurrency tests (two API processes, lock-wait → `QUEUE_BUSY`, reorder vs walk-in, deadlock retry, Asia/Dhaka boundary) are in `QUEUE-IMPLEMENTATION.md` and `QUEUE-CONCURRENCY-DESIGN.md`. |
| 5 | Do jobs, OTP and rate limits run without Redis? | **YES** | ADR-015 defines the job tables, both claim strategies, leases, concurrency leases, outbox, runner modes and TTL cleanup. OTP challenges, rate-limit counters and idempotency records are MariaDB tables. OTP delivery is synchronous, so it does not depend on the worker. The worker lifecycle under idle-stop is UNVERIFIED (HOST-005/006), with cron-mode fallback. |
| 6 | Do uploads work with an adapter and fallback? | **YES** | ADR-016 and `FILE-STORAGE-IMPLEMENTATION.md` define the `ObjectStoragePort` with S3-compatible (MinIO locally and in CI) and private-disk adapters behind one contract suite. Download tokens stream through the API, and a `MalwareScanPort` (mock and baseline) is defined. Disk storage in production is gated on HOST-007; the fallback is S3-compatible storage. |
| 7 | Can a doctor add, validate, use and revoke keys safely? | **YES** (design) | Credentials use envelope encryption (`AI_CREDENTIAL_KEK`, AAD-bound) and are write-only in DTOs. Validation jobs map status. Revocation stops in-flight jobs. A per-credential concurrency of 1 applies. Security tests T1–T7 and T14 cover leakage, cross-doctor access, admin read attempts and KEK rotation. Backlog: AICRED-001…005. |
| 8 | Is patient data kept from providers that may train on it? | **YES** (by encoded policy) | Data-use policy comes only from adapter metadata, and `UNKNOWN` is treated as may-train. A may-train provider requires four things: tenant opt-in (default false), doctor acknowledgement, patient `ai_assistance` consent, and fail-closed `PhiMinimizationService`. Raw media is never sent. Fallback goes only to an equal or stricter policy. In production, provider gates block activation (T16). Minimization is best-effort detection, not a guarantee (T8 residual risk is recorded). |
| 9 | Can AI bypass approval? | **NO** | AI writes only `ai_drafts` and `ai_suggestions`. Clinical records change only through `ApproveAISuggestion` in the `clinical` context, which requires `ai.approve`, assignment to the encounter, and a matching `row_version` in one transaction. Worker DI and dependency-cruiser rules keep clinical write services out of the worker's AI modules. `PRESCRIPTION_ITEM` and `FOLLOW_UP` targets return `FEATURE_DISABLED`. |
| 10 | Does everything run locally and in CI without paid providers? | **YES** | Docker Compose provides MariaDB, MinIO and a mock-providers service. Mock adapters exist for OTP/SMS, email, WhatsApp, push, video, AI (two register rows), the scanner and the backup destination. CI uses undici `MockAgent.disableNetConnect()` and generates test secrets per run. |
| 11 | Is staging deployable? | **YES, with UNVERIFIED items** | Unverified before or at the first staging deploy: Node monorepo subfolder build with pnpm (HOST-002/008), DB reachability at build time (HOST-008), idle-stop duration and worker keep-alive (HOST-005), minimum cron interval and tools on the cron PATH (HOST-006), disk persistence across redeploys (HOST-007, needed for the staging disk adapter), SPA fallback and whether static sites count toward the app limit (HOST-012), request/body limits (HOST-013), exact MariaDB version and `GET_LOCK` privileges (HOST-001/004). A documented fallback exists for each. |
| 12 | Which Hostinger facts remain UNVERIFIED, and which Stage 4 task proves each? | See §3 | — |

### 2.1 Stage 3.2 readiness gate

| # | Question | Answer | Reasons |
|---|---|---|---|
| 1 | Can SMS/OTP be implemented and fully tested with mocks, with one gated live smoke test? | **YES** | `SmsProvider` port, `OtpDeliveryPort`, mock adapter and `mock-providers` Zaman IT routes reproduce success, 1001–1007, timeout-after-send, 5xx, unparseable and balance cases (ADR-018 §9, COMMUNICATION §6.5). CI uses mocks only. SMS-008 sends exactly one live SMS, gated by `ZAMANIT_LIVE_SMOKE=true`, and aborts under `CI=true`. The success format is UNVERIFIED; the tolerant parser plus SMS-002 fixtures cover this before production. |
| 2 | Is the HTTP-only transport risk documented with mitigations and an owner decision gate? | **YES** | ADR-018 §2: POST-only (no key in URLs), TLS never disabled, HTTPS mandatory once available, OTP TTL 180 s, rotation ≤ 90 days, balance-drop alert, no PHI in SMS, provider request template. **`GATE-SMS-HTTP`** is an expiring owner decision in `platform_gate_decisions`, enforced at runtime (T28) and listed in §4. |
| 3 | Can payments be implemented so that no client input or callback alone marks an intent paid? | **YES** | Amount computed server-side (a client amount is rejected, T24). Return/IPN bodies are untrusted and stored redacted. `PAID` only after a Search Transaction fetched with the intent's own merchant credentials matches status, `mer_txnid`, store, amount and currency (PAYMENT §5.3). Generated uniques and row locks give one `PAID` and one ledger posting (T18–T21, T25). |
| 4 | Are platform-merchant and doctor-merchant modes both fully specified? | **YES** | ADR-019 §2 and PAYMENT §3.2: resolution order, per-fee-type enablement, credential storage and validation (sandbox-observed check with an `UNVERIFIED_UNTIL_FIRST_PAYMENT` fallback), environment separation, ledger postings for both modes (§6), refunds by merchant mode, manual payouts and commission for platform mode. |
| 5 | Is platform collection of patient fees blocked behind a legal/financial gate? | **YES** | `PAYMENTS_PLATFORM_COLLECTION_ENABLED=false` by default. In production it requires `GATE-PAY-PLATFORM-COLLECTION` (legal/financial research record) or accounts stay `BLOCKED_BY_GATE` / intents `POLICY_BLOCKED` (T26). Subscriptions and doctor-merchant fees are unaffected. PAY-015 owns the research. |
| 6 | Can the medicine dataset be imported to dev/staging with provenance, and blocked from production until gates pass? | **YES** | ADR-020 and PRESCRIPTION §5: Stage M schemas are the pinned import contract (hashes recorded). Checksums, veterinary exclusion (732 rows), per-field provenance, `dataset_version`, `review_status`, source and DGDA badges. The dev CLI and staging job are both defined. Production is refused without `MEDICATION_IMPORT_PRODUCTION_ALLOWED=true` **and** four attestations (T32); `GATE-MEDDATA-PROD` is OPEN. |
| 7 | Are all new secrets server-side only, encrypted where per-tenant, and redacted from logs? | **YES** | Platform keys live in hPanel env only. Tenant/doctor SMS and merchant keys sit in `provider_credentials` under the envelope KEK with AAD, write-only DTOs and last-4 display. Redaction covers `api_key=`, `signature_key=`, `store_id=` and aamarPay payment URLs. Leak scans cover logs, errors, jobs, audit, idempotency snapshots, OpenAPI, web and mobile builds (T22–T23). No mobile SDK carries the key (C-31). |
| 8 | Which items remain UNVERIFIED and which Stage 4 task proves each? | See §3.1 | — |

## 3. UNVERIFIED Hostinger facts → proving task

| Fact (HOSTING-VERIFICATION row) | Default | Fallback | Task |
|---|---|---|---|
| MariaDB version (#2), collation availability (#9), size scope (#11), per-hour connection limit (#10) | 10.6 feature floor; `utf8mb4_unicode_520_ci`; ≤ 40 connections | re-pin image; reduce pools | HOST-001 |
| Node 24 runtime, heap flags, native modules, pnpm subfolder build (#12, #13, #24) | Node 24.21.0; argon2 prebuilt | Node 22; fallback hashing lib ADR | HOST-002 |
| SKIP LOCKED / CHECK / generated columns / JSON on the instance (#3–#6) | `JOB_CLAIM_STRATEGY=skip_locked` | `conditional_update` | HOST-003 |
| Trigger/procedure privileges (#7), `GET_LOCK` on the instance (#8) | no triggers; GET_LOCK | `singleton_locks` lease | HOST-004 |
| Idle-stop duration, memory limits (#14, #15, #26) | cron keep-alive + worker runner; heap budgets | pure cron batches | HOST-005 |
| Cron minimum interval, `curl`/`node` on PATH (#16) | 1 min, curl | 5 min with documented latency | HOST-006 |
| Persistent private directory outside `hbuilds`/`public_html` (#17) | disk only in staging | S3-compatible in production | HOST-007 |
| DB reachability during build, concurrent builds (#18) | guarded migration in api build | worker startup migration | HOST-008 |
| Latency from Bangladesh, egress to providers (#19, #21) | India region | Malaysia/Indonesia | HOST-009 |
| Plan backup contents and restore into Docker (#20, #28) | plan backups + app encrypted dumps | app dumps only | HOST-010 |
| Runtime log visibility and retention (#23) | stdout JSON | OTLP export | HOST-011 |
| SPA fallback, static site app count (#22) | `.htaccess` rewrite | hash routing | HOST-012 |
| Request timeout, body size, forwarded headers, CORS preflight (#25) | 8 MiB parts, < 25 s requests | smaller chunks | HOST-013 |

### 3.1 Stage 3.2 UNVERIFIED items → proving task

| Item | Default | Task |
|---|---|---|
| Zaman IT HTTPS endpoint (ZAMANIT-VER-01) | none; HTTP with `GATE-SMS-HTTP` | SMS-002 (probe), SMS-009 (provider answer, gate) |
| Zaman IT success/balance response formats; POST form acceptance; latency (VER-02, 13, 14) | tolerant parser; form POST; 10 s | SMS-002 |
| Message ID; segment billing; delivered-only charging (VER-03, 07, 17) | none; per segment | SMS-008 |
| DLR/callbacks; rate limits; max recipients; masking rules; OTP route; IP allow-list; idempotency; mixed recipients; key in provider logs (VER-04–06, 08–12, 15) | no DLR; 30/min; single recipient; non-masking; transactional; no allow-list; none | SMS-009 (provider request) |
| Hostinger egress IP stability (VER-16) | stable unless region changes | HOST-009 |
| aamarPay redirect content type and cancel body (PAY-AAM-01) | form or JSON; cancel may be GET | PAY-014 |
| Amount field semantics incl. customer-borne charges (PAY-AAM-02) | Search `amount` = requested | PAY-014 |
| IPN signature, retries, acknowledgement (PAY-AAM-03/04) | untrusted trigger; `200 OK` | PAY-014 |
| Duplicate `tran_id`; POST Search alternative; page expiry; tab-close behavior; Search rate limits (PAY-AAM-05/06/12/15/16) | never reuse; GET + redaction; 30 min TTL; reconciliation; ≤ 60/min | PAY-014 |
| Refund API; settlement reports (PAY-AAM-07/08) | manual; none | PAY-010 (manual flow), PAY-014 (support answer) |
| Supported payment methods; fee fields (PAY-AAM-09/10) | generic copy; `processing_charge` | PAY-014 |
| Live credential check behavior (PAY-AAM-11) | as sandbox; `UNVERIFIED_UNTIL_FIRST_PAYMENT` fallback | PAY-014 |
| Platform collection legality (payment aggregation, tax, accounting) | disabled in production | PAY-015 |
| Medicine dataset legal/clinical/DGDA/safeguard gates | production import refused | MEDDATA-006 (safeguards via MEDDATA-005) |
| SFTP write access to the disk storage prefix for dataset staging | S3 staging or SFTP | MEDDATA-003 / HOST-007 |
| Catalog search p95 on 50k rows under the Hostinger DB | < 150 ms target | MEDDATA-004 (staging) |

## 4. Production gates (not blocking Stage 4)

**Risk and gate register (Stage 3.2).** A gate is closed only by the named mechanism; engineering cannot close owner, legal or clinical gates.

| Gate | Risk | Closed by | Enforcement | Status |
|---|---|---|---|---|
| **GATE-SMS-HTTP** | Zaman IT API over plain HTTP: API key, phone numbers and OTP codes readable/tamperable on the network path | provider HTTPS (then N/A), **or** an explicit, expiring owner decision recorded with `ops:record-risk-decision` | adapter refuses `http://` in production without `ZAMANIT_ALLOW_INSECURE_HTTP=true` + a valid decision (T28) | **OPEN** |
| **GATE-PAY-PLATFORM-COLLECTION** | Hakeemify holding patient fees owed to doctors may be regulated (aggregation/facilitation), with tax/accounting duties | legal/financial research record (PAY-015) + owner decision | `PLATFORM_MERCHANT` patient-fee accounts `BLOCKED_BY_GATE`; intents `POLICY_BLOCKED` (T26) | **OPEN** |
| **GATE-MEDDATA-PROD** | Unverified medicine data (source terms UNCLEAR, no clinical sample review) in production prescribing | four attestations per dataset version (MEDDATA-006) + `MEDICATION_IMPORT_PRODUCTION_ALLOWED=true` | import refused (T32) | **OPEN** for `medicine-dataset-20260917-4` |
| PAY-014 sandbox verification | undocumented gateway behavior | recorded results | `PAYMENTS_ENABLED=false` in production until done (deployment gate) | OPEN |
| AIREG-001…009 | AI provider terms / patient data | register reviews | ADR-017 production gates | OPEN |

- **HOST-001…013** recorded; any differing result goes through an audit row.
- **Production object storage and backup destination provider** selected; alternatively, disk storage approved via HOST-007.
- **AI provider gates** AIREG-001…009 reviewed. All provider rows stay `productionGate: OPEN` until then, which means no production AI credential activation.
- **Legal and research register items:** data residency and cross-border hosting (India region), telemedicine consent, prescription and doctor credential rules, retention, and AI governance.
- **Production providers selected** for email, push, WhatsApp and video. OTP/SMS (Zaman IT) and payments (aamarPay) are selected (Stage 3.2), subject to the gates above.
- **Medicine catalog:** `GATE-MEDDATA-PROD` closed per dataset version. Until then production has no catalog rows and prescribing uses free text (fully supported).
- **Operations:** restore drill passed; load test within the ADR-013 scale ceiling (OPS-004).

## 5. Technology decisions (final)

- **Runtime and build:** Node 24.21.0 · pnpm 12.4.2 · turbo 2.10.13 · TypeScript 5.9.3.
- **API:** NestJS 11.2.5 + Fastify · zod 3.25.76 + nestjs-zod 5.5.0 · zod-to-openapi 7.3.4 (OpenAPI 3.1 + 3.0).
- **Database:** Prisma 7.10.0 + `@prisma/adapter-mariadb` 7.10.0 + mariadb 3.5.4 on **MariaDB**. Jobs use the **DB queue** (ADR-015).
- **Storage:** S3-compatible and private-disk adapters (ADR-016).
- **Testing:** Vitest 5.0.1 · Supertest 7.2.2 · Testcontainers (MariaDB image) · Playwright 1.63.0.
- **Lint and architecture checks:** ESLint 10.10.0 + typescript-eslint 8.70.0 · Prettier 3.9.7 · dependency-cruiser 18.3.1.
- **Web:** React 19.3.0 · Vite 8.3.0 · react-router 7.18.4 · TanStack Query 5.103.1.
- **Mobile:** Flutter/Melos 8.7.0 on pub workspaces · swagger_parser 1.44.3.
- **Security and utilities:** argon2 0.45.1 · jose 6.2.12 · uuidv7 1.2.1 · pino 10.3.1.
- **CI/CD:** GitHub Actions pinned by SHA · Hostinger GitHub deploy.
- **Stage 3.2 providers:**
  - Zaman IT SMS and aamarPay use `fetch` adapters with no SDKs;
  - JSON Schema import validation uses `ajv@8.20.0` + `ajv-formats@3.0.1`;
  - money uses kernel `Money` (integer paisa) with `DECIMAL` storage;
  - mobile payments use `flutter_custom_tabs` (pinned at MOB-005);
  - envelope encryption is shared in `packages/secrets`.

## 6. Residual risks

| Risk | Mitigation |
|---|---|
| Shared plan resources (4 CPU / 4 GB across 10 apps) | Memory and connection budgets, scale ceiling, migration signals (ADR-013 §6–§7) |
| No DB triggers; a privileged operator could alter append-only rows | Hash chains + scheduled verification (detection, not prevention) |
| MariaDB DDL is non-transactional | Expand-only, one change per file, pre-migration dump |
| PHI minimization misses identifiers in free text | Fail-closed detectors, residual scan, provider policy gates, no raw media; clinician review |
| Provider terms change | Register re-verification cadence; metadata-driven policy; gates |
| Bangla PDF rendering quality | RX-005 font review; render ≠ approval |
| SMS over plain HTTP (Stage 3.2) | `GATE-SMS-HTTP`; POST-only; short OTP TTL; rotation; balance-drop alert; no PHI in SMS |
| SMS duplicate after timeout (no provider idempotency) | no OTP auto-resend; transactional retry at most once with `possible_duplicate` |
| aamarPay `signature_key` in Search Transaction query string | adapter-only URL building, no request logging, redaction pattern, support request for POST |
| Undocumented IPN signature / refund API / settlement reports | verification by Search Transaction; manual refunds; reconciliation job |
| Late or duplicate payments after holds expire | `late_payment` + manual review; `paid_business_key` excludes late rows |
| Unverified medicine catalog | badges, free-text fallback, no dose prefill, production gate |
