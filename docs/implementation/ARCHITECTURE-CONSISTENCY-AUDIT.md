# Architecture Consistency Audit

**Scope:** all documents under `docs/architecture/` (ADR-001…ADR-017), `docs/implementation/`, and `teardown/COMBINED-TECHNICAL-TEARDOWN.md`.
**Audit dates:** Stage 3 on 2026-09-17; Stage 3.1 revision on 2026-09-17; **Stage 3.2 revision on 2026-09-17** (ADR-018…ADR-020; rows C-21…C-34).

**Precedence** when documents disagree:
1. Stage 3.2 prompt (for SMS/OTP, payments and medicine import), then the Stage 3.1 prompt
2. ADR-018…ADR-020, ADR-013…ADR-017
3. this audit
4. other implementation documents
5. architecture specifications

Architecture specifications are not silently edited. Each affected spec carries a dated change-log entry pointing at the ADR that supersedes part of it.

## Summary

- **Stage 3** resolved naming, lifecycle and permission ambiguities (rows S3-01…S3-13).
- **Stage 3.1** re-targets hosting to Hostinger Cloud Startup, which forces:
  - a MariaDB engine;
  - a database-backed job queue;
  - pluggable object storage;
  - no inbound WebSockets;
  - idle-stopping Node apps.
- Stage 3.1 also replaces the single platform AI provider with per-doctor, multi-provider credentials.
- It further resolves implementation-level contradictions found in the Stage 3 blueprint (rows C-01…C-20).
- **Stage 3.2** selects Zaman IT (SMS/OTP), aamarPay (payments, now MVP) and the Stage M medicine dataset import, and resolves the resulting contradictions (rows C-21…C-34). New production gates: `GATE-SMS-HTTP`, `GATE-PAY-PLATFORM-COLLECTION`, `GATE-MEDDATA-PROD`.
- **Result: PASS WITH OPEN QUESTIONS.** The open questions are external (legal, provider terms, Hostinger runtime facts) and each has a documented default, fallback and Stage 4 verification task.

## Stage 3.1 resolutions

| ID | Issue | Sources | Impact | Resolution |
|---|---|---|---|---|
| C-01 | The Stage 3.1 brief assumed "Hostinger MySQL 8.0+". Hostinger Cloud hosting provides **MariaDB** (version not published for the plan). | Stage 3.1 brief; `HOSTING-VERIFICATION.md` #9–#12 | MySQL-8-only SQL (`utf8mb4_0900_ai_ci`, `CHECK` inline column syntax, functional indexes, `SKIP LOCKED` availability, JSON type) could fail in production. | ADR-014: target **MariaDB 10.6 feature set** as the floor, via Prisma's `mysql` provider + `@prisma/adapter-mariadb`. Collation `utf8mb4_unicode_520_ci`; table-level CHECKs; generated columns from VARCHAR sources; JSON as LONGTEXT + `JSON_VALID`. Local/CI image `mariadb:10.6` moves to the reported series after **HOST-001**. Engine-contract suite (**HOST-003**) proves each construct. |
| C-02 | The default AI mode is a doctor's own Gemini key (free tier). Gemini API terms restrict use in **clinical practice** on every tier and allow free-tier content to be used for improvement. | ADR-017 §7; `AI-PROVIDER-REGISTER.md` | Shipping the default in production could conflict with provider terms, independently of our minimization. | Every provider row carries `productionGate: OPEN`. An OPEN gate blocks activation of that provider's credentials in `APP_ENV=production` (`POLICY_BLOCKED`, reason `PROVIDER_PRODUCTION_GATE_OPEN`); while `AI_FREE_TIER_PRODUCTION_GATE_CLOSED` is not `true`, the tenant may-train opt-in is rejected. Gates close only through AIREG-001…009 review records. Local/staging use mock and synthetic data. **No compliance claim is made.** |
| C-03 | Redis/BullMQ were the queue, rate-limit, OTP and idempotency store; Hostinger Cloud has no Redis service and the plan cannot run a persistent Redis. | ADR-010, Stage 3 `TECHNOLOGY-STACK.md`, `QUEUE-IMPLEMENTATION.md` | Foundation would require an unavailable dependency. | ADR-015: `jobs`, `dead_letters`, `job_concurrency_leases`, `singleton_locks`, `rate_limit_counters`, `idempotency_records`, `otp_challenges` in MariaDB; outbox → jobs; TTL cleanup job. Redis/BullMQ removed from stack and backlog. ADR-010 partially superseded (async workers remain; transport changes). |
| C-04 | `chamber_days.version` was used both as serial allocation counter and as reorder conflict token, so every walk-in invalidated an in-flight reorder. | Stage 3 `QUEUE-IMPLEMENTATION.md` | Spurious conflicts during busy chambers. | Split into `next_serial_number` (counter), `queue_order_version` (reorder/delay/policy token) and `row_version` (generic optimistic lock). Reorder permutes only listed serials. Tests in `QUEUE-CONCURRENCY-DESIGN.md`. |
| C-05 | Timeline declared append-only, but Stage 3 redaction wording implied updating rows. | `DOMAIN-MODEL.md`, S3-10 | Hash chain would break; audit trail unclear. | A redaction **inserts** a `REDACTED` marker row referencing the original; read models hide marked originals. No updates. `DATABASE-IMPLEMENTATION.md` §3.11. Supersedes S3-10 wording. |
| C-06 | A bare `version` column meant both optimistic lock and clinical revision. | Stage 3 DB/API docs | Clients could send a clinical revision as a concurrency token and vice versa. | `row_version` (+ `expectedRowVersion` in APIs) is optimistic locking only; `revision` is the business version. No bare `version` columns (lint rule). |
| C-07 | The serial state machine was incomplete (walk-in entry state, confirmation policy, reschedule semantics, cancel during consultation). | `DOMAIN-MODEL.md`, S3-01 | Divergent transition logic. | Complete `SERIAL_TRANSITIONS` table in `QUEUE-IMPLEMENTATION.md`: walk-in → `CHECKED_IN` → `WAITING` (policy `waitingRequiresConfirmation`); `RESCHEDULED` terminal + new linked serial; `IN_CONSULTATION → CANCELLED` interrupts the encounter in the same transaction. |
| C-08 | "One active serial per patient per chamber day" was enforced only in application code; PostgreSQL partial unique index is unavailable. | Stage 3 DB doc | Race produced duplicates. | Persistent generated `active_patient_day_key` + UNIQUE; `duplicate_override` flag for authorized exceptions. Probe evidence `HOSTING-VERIFICATION.md` §3.1. |
| C-09 | Queue live updates assumed WebSockets/SSE; Hostinger Node apps do not accept inbound WebSockets. | `API-SPEC.md`, `MOBILE-SPEC.md`, Stage 3 web doc | Live queue screens would not work. | ETag-conditional **polling** (`GET …/queue` with `If-None-Match`, 5 s staff queue; patient 15 s while WAITING/CALLED, 60 s otherwise; backoff when hidden). Push notifications for patient events remain via providers. Video signaling is provider-hosted (not our origin). |
| C-10 | `encounter_notes` both mutable (autosave) and immutable (signed record). | `DOMAIN-MODEL.md`, S3-09 | Signed notes could be overwritten. | One mutable `DRAFT` row per encounter (generated-unique `open_draft_key`) + append-only hash-chained `encounter_note_versions`; correction = new revision with reason. |
| C-11 | Prescription `REVIEWED` status existed without semantics. | S3-02 | Undefined permission and edit behavior. | `REVIEWED` = checked by a user with `prescription.review` (nurse via grant or doctor); any edit returns it to `DRAFT`; only the assigned encounter doctor can move to `APPROVED`. |
| C-12 | Error codes and endpoints drifted between API spec, Stage 3 API doc and client docs (`lab-reports/upload-session`, `download-url`, missing conflict codes). | `API-SPEC.md`, Stage 3 impl docs | Generated clients would disagree with server. | `API-IMPLEMENTATION.md` is the build contract for routes, permissions and error codes; unified `/documents/upload-sessions` and `download-token`; canonical codes incl. `QUEUE_VERSION_CONFLICT`, `QUEUE_BUSY`, `IDEMPOTENCY_KEY_REUSED`, `FEATURE_DISABLED`, AI classes. |
| C-13 | Repository structure: broken indentation, global `domain/`/`application/` packages contradicting bounded contexts, `packages/shared` catch-all, unclear adapter placement. | Stage 3 `REPOSITORY-STRUCTURE.md`, ADR-002 | Boundary erosion. | Per-context `src/{domain,application,infrastructure,public,nest}` layers; `packages/kernel` leaf; `*-adapters` packages; separate `mobile/` Melos workspace; exact dependency-cruiser config. |
| C-14 | "Assigned doctor" used everywhere but never defined. | `SECURITY-SPEC.md`, `API-SPEC.md` | Inconsistent approval authorization. | Five rules (encounter, serial/chamber, care team, coverage, solo tenant) in one `AssignmentPolicy`; approvals require assignment to the **encounter**. |
| C-15 | Patients had no account/guardian model; patient sessions assumed a single tenant. | `DOMAIN-MODEL.md`, S3-05 | Families and multi-clinic patients unsupported; unsafe on-behalf access. | `patient_accounts`, `patient_guardianships`, `GET /me/patient-contexts`, `X-Patient-Context` header, scoped guardian authority, on-behalf audit. Supersedes S3-05 patient clause. |
| C-16 | Role → permission mapping existed only as prose; AI credential/policy permissions missing. | `SECURITY-SPEC.md`, S3-03 | Guards and docs drift. | Versioned `ROLE_PERMISSIONS` constant + grants/denials; permission catalog incl. `ai.credentials.manage`, `ai.policy.*`, `ai.usage.read`; matrix test parses the document. |
| C-17 | ADR-009 assumed managed object storage with presigned URLs only; the host may only offer local disk. | ADR-009 | Uploads blocked if no S3 provider is chosen. | ADR-016: `ObjectStoragePort` with S3-compatible and private-disk adapters; HMAC download tokens streamed through the API; disk adapter gated on **HOST-007**; `MalwareScanPort` with honest baseline limits. |
| C-18 | ADR-008 assumed one platform-managed AI provider billed by the platform. | ADR-008, `AI-SPEC.md` | Wrong ownership, billing, and data-use model. | ADR-017: per-doctor encrypted credentials, billing modes (`PLATFORM_MANAGED` disabled), data-use policy from adapter metadata (`UNKNOWN` = may-train), fail-closed minimization, fallback only to equal-or-stricter policy. The approval architecture of ADR-008 is retained. |
| C-19 | Node apps idle-stop on Hostinger; an in-process worker loop cannot be relied on. | `HOSTING-VERIFICATION.md` #4 | Jobs stall silently. | 1-minute hPanel cron POSTs `/internal/jobs/run` (token), keeping the worker warm and running a bounded batch; runner modes `worker`/`embedded`/`cron`; **HOST-005** decides. Job-lag readiness + alerts. |
| C-20 | Stage 3 pinned Node 22 and allowed "Vitest/Jest", "Biome or ESLint", "or equivalent" choices. | Stage 3 `TECHNOLOGY-STACK.md` | Foundation would begin with open tool decisions. | Exact pins in `TECHNOLOGY-STACK.md` (Node 24.21.0, pnpm 12.4.2, NestJS 11.2.5 — legacy line because `nestjs-zod` peers `^10 \|\| ^11` — Vitest 5.0.1, ESLint 10 + Prettier, Prisma 7.10.0, …). |

## Stage 3.2 resolutions

| ID | Issue | Sources | Impact | Resolution |
|---|---|---|---|---|
| C-21 | "Billing is Future; no MVP billing tables or endpoints" (S3-13) conflicts with the decision that payments enter MVP. | S3-13, `DATABASE-SPEC.md`, `PRODUCT-ARCHITECTURE-SPEC.md`, Stage 3.1 `MODULE-BOUNDARIES.md`/`AUTHORIZATION-MATRIX.md` | No home for payments | **ADR-019** supersedes S3-13. `payments` context, migrations 0017/0018, `PAYMENT-IMPLEMENTATION.md`. Insurance, claims and invoicing complexity remain Future. |
| C-22 | The OTP/SMS provider was an external decision; the selected provider (Zaman IT) publishes a plain-HTTP bare-IP API whose sample uses GET and disables TLS verification. | Stage 3.1 audit external decisions; provider dashboard | Key, phone and OTP in plaintext; key in URLs/logs | **ADR-018**: POST form bodies only, TLS verification never disabled, HTTPS mandatory when available, production HTTP use behind the expiring owner gate `GATE-SMS-HTTP`, OTP TTL 180 s, rotation and balance-drop alerts, provider request template. Unknowns in `ZAMANIT-VERIFICATION.md`. |
| C-23 | Stage 3.1 `medications` had UNIQUE `(dataset_version, record_key)` and "empty catalog valid / import separate", which conflicts with upsert-by-key, never-delete and cross-version prescription references. | `DATABASE-IMPLEMENTATION.md` §3.8, RX-001 | Each import would duplicate the catalog; old prescriptions would point at stale copies | **ADR-020**: global catalog keyed by `canonical_key_sha256` (dataset `record_key`), deactivation instead of deletion, `dataset_version` = last writer, `prescription_items.catalog_snapshot`. Route `GET /medications?query=` renamed `GET /medications/search`. |
| C-24 | Payments must confirm or release appointments atomically, but cross-context transactional facades are an exhaustive list. | `MODULE-BOUNDARIES.md` §2 | An undeclared cross-context write | `scheduling.AppointmentCommandFacade` gains `confirmPaidBooking`, `releasePaymentHold` and `waivePayment`, used by payments handlers. Listed in MODULE-BOUNDARIES §2 (this row is the required audit record). Payments never reach clinical packages (rule `payments-no-clinical`). |
| C-25 | "Platform operator" was referenced (`POST /tenants`, ops replay) without a data model, authentication or permission set. | Stage 3.1 `AUTHORIZATION-MATRIX.md`, `API-IMPLEMENTATION.md` | Implicit superuser risk | Explicit `platform_operators` table, a disjoint platform permission catalog, password + OTP per session, `X-Platform-Context`, platform-chain audit (AUTH §2.6, AUTHORIZATION-MATRIX §1.1/§5.1). |
| C-26 | The Stage 3.2 brief asks for a generalized `provider_credentials` table, while ADR-017 already defines `ai_provider_credentials` with AI-specific policy columns; envelope encryption lived inside `packages/ai`. | ADR-017, Stage 3.2 brief | Duplicate crypto code or an AI table migration | `provider_credentials` covers SMS and payment secrets; AI keeps `ai_provider_credentials` (no migration churn). Both use the shared `packages/secrets` `SecretEnvelopePort`, with **separate KEKs** (`AI_CREDENTIAL_KEK`, `PROVIDER_CREDENTIAL_KEK`). |
| C-27 | `API-IMPLEMENTATION.md` §3.2 said OTP request uses "job → OTP adapter" while AUTH-IMPLEMENTATION specifies synchronous delivery. | Stage 3.1 docs | Codes could be placed in job payloads | Fixed: synchronous `OtpDeliveryPort` after commit, no job (AUTH §2.1). |
| C-28 | The brief derives the gateway fee from `store_amount` vs `amount`; aamarPay's Search Transaction (the trusted source) exposes `processing_charge`/`rec_amount`, and `store_amount` appears only in the untrusted redirect body. | Stage 3.2 brief; AAMARPAY-VERIFICATION §2 | Fee derived from forgeable data | Fee = Search `processing_charge`, else `amount − rec_amount`, else `fee_unverified`. The redirect `store_amount` is stored redacted for reference only. PAY-AAM-02/10 verify in the sandbox. |
| C-29 | aamarPay says IPN messages are signed, but documents no scheme; Search Transaction is GET-only with `signature_key` in the query string (sandbox-observed: POST rejected). | AAMARPAY-VERIFICATION §2.3–§2.4 | False sense of IPN authenticity; key exposure in URLs | The IPN is an untrusted trigger and every transition is verified by Search Transaction. The URL is built only inside the adapter, never logged, and redacted by pattern. PAY-AAM-03/06 ask support. |
| C-30 | Stage M dataset card reports "fuzzy auto-merged: 1987", while `reports/merge-stats.json` reports `fuzzyAutoMerges: 1946`. | `tools/medicine-data/dist/medicine-dataset-20260917-4/` | Apparent statistic mismatch (informational; import unaffected) | Checked 2026-09-17: 1,987 = `provenance.jsonl` links with a fuzzy `match_method`; 1,946 = merge operations in `merge-stats.json`. They are different measures but neither file labels them, so this is recorded as a card clarity item for the next Stage M build. The importer reports its own counts; reference data is not edited. |
| C-31 | The brief allows the aamarPay Flutter package only if it needs no client-side credentials. | aamarPay Flutter/Android docs | Signature key in APK | Verified: both mobile SDKs take store ID and signature key in app code, so they are **not used**. External browser tab + App/Universal Links instead (MOBILE §10). |
| C-32 | The brief lists `refund.manage` as one permission for both tenant (doctor-merchant) and platform (platform-merchant) refunds, and lists `medication.import`/`payout.manage` as platform-only. | Stage 3.2 brief | One name across two catalogs would let a tenant grant elevate | Tenant `refund.manage` (doctor-merchant intents) plus platform `platform.refund.manage`; `medication.import`, `payout.manage` and `ops.sms.read` are platform catalog only and rejected in memberships. |
| C-33 | The brief asks for `payment_gateway_events` with a verified flag while also storing callbacks append-only. | Stage 3.2 brief | Append-only rule violated | Insert-mostly: only `verification_id`/`verified_at` may be set once (`WHERE verification_id IS NULL`). Verification results live in append-only `payment_verifications`. |
| C-34 | `OTP_TTL_SECONDS` default 300 (Stage 3.1) vs the brief's "keep OTP TTL short" under HTTP transport. | AUTH-IMPLEMENTATION, ENVIRONMENT-CONTRACT | Longer interception window | Default 180 s (max 300); attempts 5; resend limits unchanged. |

## Stage 4 resolutions

| ID | Issue | Sources | Impact | Resolution |
|---|---|---|---|---|
| C-35 | `MOBILE-IMPLEMENTATION.md` and `AUTH-IMPLEMENTATION.md` §2.4 use a `401 SESSION_REVOKED` code that is missing from the canonical error table. | API-IMPLEMENTATION §4, MOBILE §2 | Clients could not distinguish a revoked session (clear local data) from an expired token (refresh) | `SESSION_REVOKED` (401) added to API-IMPLEMENTATION §4 and `packages/kernel` error codes (Stage 4, FOUND-003). |

## Stage 3 resolutions (retained, with Stage 3.1 amendments)

| ID | Issue | Resolution (current) |
|---|---|---|
| S3-01 | `RECALLED` as serial state vs event | `RECALLED` is a `queue_events.event_type` (`SKIPPED → CALLED`); `recall_count`, `recall_deadline_at` on `serials`. Complete machine: C-07. |
| S3-02 | Prescription clinical vs render status mixed | `clinical_status` `DRAFT/REVIEWED/APPROVED/VOID`; `render_status` `NOT_REQUESTED/QUEUED/RENDERING/AVAILABLE/FAILED`. `REVIEWED`: C-11. |
| S3-03 | AI permission aliases | Canonical `ai.use`, `ai.review`, `ai.approve` (+ C-16 additions); aliases removed. |
| S3-04 | Render endpoint used read permission | `prescription.render`. |
| S3-05 | Tenant context transport | `X-Tenant-ID`, validated server-side. **Amended:** patients select a context via `X-Patient-Context` (C-15) and also send `X-Tenant-ID`. |
| S3-06 | `platform/admin` permission | `platform_operator` outside tenant roles; bootstrap and `ops.*` only. |
| S3-07 | Singular domain vs plural tables | Singular PascalCase domain/Prisma models with `@@map` to plural snake_case **MariaDB** tables; JSON camelCase. |
| S3-08 | Slotless walk-ins | `appointments.slot_id` nullable; `chamber_day_id` mandatory; every walk-in creates a serial. |
| S3-09 | Encounter note JSON blob | Fixed section columns + bounded `extensions` JSON with `schema_version`. Draft/versions: C-10. |
| S3-10 | Timeline redaction | **Superseded by C-05** (insert marker, never update). |
| S3-11 | `READ` receipts | `READ` only with provider evidence, else `DELIVERED`. |
| S3-12 | Auth implementation | Dedicated auth module: Argon2id, **MariaDB** sessions + refresh rotation, EdDSA JWT access tokens, OTP port with mock. **Amended:** web uses in-memory access token + `__Host-hm_rt` cookie + CSRF (ADR-013 §2); OTP/rate limits in DB (C-03). |
| S3-13 | Billing tables | **Superseded by ADR-019 (C-21):** payments and platform subscriptions are MVP; insurance/claims/complex invoicing remain Future. |

## Deliberately unresolved external decisions

Each has a default and fallback so Stage 4 is not blocked.

| Decision | Default until decided | Proven/closed by |
|---|---|---|
| Exact MariaDB version and limits on the plan | 10.6 feature floor | HOST-001, HOST-003, HOST-004 |
| Worker lifecycle under idle-stop | cron keep-alive + worker runner | HOST-005, HOST-006 |
| Disk persistence / web isolation for private storage | S3-compatible in production; disk in staging | HOST-007 |
| DB reachability during build | migrate in api build | HOST-008 (fallback worker startup migration) |
| Production object storage / backup destination provider | none selected; S3-compatible adapter | RELEASE-001 decision record |
| AI provider terms for clinical use; data location | all `productionGate: OPEN` | AIREG-001…009 |
| ~~Production OTP/SMS provider~~ | **Decided in Stage 3.2: Zaman IT (ADR-018)**. Remaining: HTTPS/IP allow-list/DLR/format unknowns and owner decision `GATE-SMS-HTTP` | ZAMANIT-VER-01…17 (SMS-002, SMS-008, SMS-009) |
| ~~Payment provider~~ | **Decided in Stage 3.2: aamarPay (ADR-019)**. Remaining: PAY-AAM-01…16 and legal/financial research for platform collection (`GATE-PAY-PLATFORM-COLLECTION`) | PAY-014, PAY-015 |
| Production WhatsApp, email, push, video providers | mocks | provider selection records |
| ~~Verified Bangladesh medicine dataset~~ | **Import mechanism decided in Stage 3.2 (ADR-020)**; dataset `medicine-dataset-20260917-4` is `UNVERIFIED`; dev/staging only | MEDDATA-006 (four gate attestations) |
| Retention, residency, telemedicine consent, prescription and AI governance rules | conservative defaults, no compliance claim | legal research register |
| Queue fairness (late arrivals, overbooking) | `QueuePolicy` defaults | clinic pilot feedback |
