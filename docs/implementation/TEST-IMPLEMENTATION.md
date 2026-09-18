# Test Implementation Contract

**Stage 3.1 rewrite (2026-09-17).** Tools: Vitest 5.0.1, Supertest 7.2.2, Testcontainers (`@testcontainers/mysql` 12.1.0 with the pinned `mariadb` image), Playwright 1.63.0, Flutter test / integration_test.

**Stage 3.2 update (2026-09-17):** SMS, payment and medicine-import suites; T18–T32; SMS live smoke (never in CI).

## 1. Pyramid and locations

| Layer | Scope | Location | Infra |
|---|---|---|---|
| Unit | Domain state machines (serial, encounter, prescription, AI job/draft/suggestion, credential), value objects, PolicyEngine and AssignmentPolicy, effective AI policy truth table, minimization detectors, redaction, DTO schemas | `packages/*/test/unit` | none |
| Engine contract | SKIP LOCKED/EXPLAIN, conditional claim, CHECK == Zod, every generated unique, JSON validity, lock-wait mapping, deadlock retry, GET_LOCK, Bangla round-trip, Asia/Dhaka boundary, composite tenant FKs | `packages/database/test/engine-contract` | MariaDB container |
| Integration | Repositories, transactions, append-only, hash chains, outbox → jobs, job runner (both claim strategies, leases, reclaim, concurrency leases, dead letters, rate-limit wait, GET_LOCK singleton with two processes), TTL cleanup, idempotency | `packages/*/test/integration` | MariaDB, MinIO, temp dir |
| Storage contract | Shared suite for `s3` (MinIO) and `disk` adapters + scanners | `packages/storage-adapters/test` | MinIO, temp dir |
| AI | Adapter contract tests with `MockAIProvider` fixtures (every error class); Gemini and OpenAI-compatible adapters against **recorded synthetic HTTP fixtures** (no network; `undici` MockAgent); provider-register ↔ metadata consistency; prompt/schema lock; minimization; worker DI container resolution | `packages/ai*/test` | MariaDB |
| API | Supertest: routes, auth, CSRF, patient context, idempotency (replay/in-progress/reused), pagination, error codes, OpenAPI response validation | `apps/api/test` | MariaDB, MinIO |
| Concurrency | Multi-process tests (QUEUE-CONCURRENCY-DESIGN §7) | `tests/concurrency` | MariaDB |
| Architecture | dependency-cruiser rule fixtures; lint rules (`no-raw-sql`, `no-append-only-mutation`, `lock-order`, `no-secret-logging`, `tenant-scoped-repo`) | `tests/architecture` | none |
| Contract (clients) | OpenAPI generation diff; TS client compile; Dart client generation from 3.0 **and** 3.1 + `dart analyze` | CI jobs | Dart SDK |
| Security | SECURITY-IMPLEMENTATION §2 (T1–T17 + carried-forward list) | `tests/security` | MariaDB, MinIO |
| Web | Playwright critical flows (WEB-IMPLEMENTATION §7) | `tests/e2e-web` | full local stack |
| Mobile | Unit/widget/integration (MOBILE-IMPLEMENTATION §9) | `mobile/**/test` | local API |
| Load (staging only) | Serial issuance/transitions p95 under the ADR-013 ceiling; polling load (250 sessions); job throughput | `tests/load` (k6 pinned at OPS-003) | staging, outside clinic hours |
| Hosting smoke | HOST-001…HOST-013 | `tests/hosting` + runbooks | real Hostinger staging |
| SMS adapter (Stage 3.2) | Zaman IT adapter contract against `mock-providers`: POST-only, form encoding, error codes 1001–1007, timeout-after-send, 5xx, unparseable, balance parsing, phone conversion, encoding and segments, key redaction | `packages/communication-adapters/zamanit/test` | mock-providers |
| Payments (Stage 3.2) | Unit (Money, fees, merchant resolution, state machine, ledger sums), integration (verification concurrency, reconciliation, holds, confirmation), gateway contract (aamarPay adapter vs mock scenarios, PAYMENT-IMPLEMENTATION §10) | `packages/payments/test`, `packages/payment-adapters/*/test` | MariaDB, mock-providers |
| Medicine import (Stage 3.2) | Synthetic `meddata-mini` fixture dataset: checksums, pinned schema hashes, upsert idempotency, deactivation, veterinary exclusion, price precision, resume, production gate | `packages/prescriptions/test/medication-import` | MariaDB, temp dir |
| **Live smoke (manual only)** | SMS-008 one live SMS (`ZAMANIT_LIVE_SMOKE=true`); PAY-014 aamarPay sandbox payments and live credential lookup | `tests/live-smoke` (excluded from every CI workflow by path filter and by `CI=true` abort) | developer machine / staging |

## 2. Mandatory cases (blocking)

- Tenant A cannot access Tenant B by UUID, cursor, upload session, download token, timeline source, provider callback or AI credential; the composite FK rejects cross-tenant children.
- Duplicate patient detection creates a review rather than a silent duplicate or merge.
- Two concurrent serial requests allocate distinct numbers; the same idempotency key returns one result; a different body returns `IDEMPOTENCY_KEY_REUSED`.
- **Two API processes allocating serials concurrently against the real MariaDB container** produce gap-free unique numbers.
- **Lock-wait timeout maps to `QUEUE_BUSY`.**
- **A reorder is not invalidated by a concurrent walk-in.**
- Concurrent call/skip commits one transition.
- The duplicate active serial is rejected by the database.
- The complete serial state machine table (QUEUE-IMPLEMENTATION §3.2).
- One non-error encounter per serial; `IN_CONSULTATION → CANCELLED` interrupts the encounter atomically.
- Draft note autosave conflict; signed note corrections create new revisions with a reason.
- Approved prescription immutable; draft render rejected; `REVIEWED` has no clinical effect; one approved per encounter.
- AI: worker container cannot resolve clinical write use cases; approval creates a record with `source=ai_approved` plus `ai_approvals` atomically; nurse cannot approve; `PRESCRIPTION_ITEM` target → `FEATURE_DISABLED`; transcription → `FEATURE_DISABLED`.
- AI data-use safeguards: zero provider calls when opt-in, ack, consent or minimization fails; no identifiers in may-train requests (T8).
- Secrets never leave the credential store (T1–T7).
- Unauthorized user cannot obtain a download token; path traversal (T11); cron without token (T10); concurrent migrations (T13).
- **Bangla patient name round-trip** (DB, API, PDF text extraction smoke).
- **Asia/Dhaka day boundary with UTC `DATETIME(3)` storage.**
- Communication retry does not duplicate intent; duplicate webhook is idempotent.
- Offline mobile retry does not duplicate a mutation.
- Timeline redaction inserts a marker; the original row is unchanged; the chain verifies.
- **Stage 3.2:**
  - payments: forged success, amount tamper, cross-tenant callback, replayed IPN, client amount, late success (T18–T21, T24, T25);
  - one `PAID` + one ledger posting under concurrent return/IPN;
  - no serial for `PENDING_PAYMENT`;
  - payment handlers cannot resolve clinical write use cases;
  - SMS: POST-only/no key in URL (T27); HTTP gate (T28); no PHI in templates (T29); OTP unknown outcome never auto-resends (T30); transactional retry at most once with `possible_duplicate`;
  - provider secrets never leak (T22, T23);
  - platform operator isolation (T31);
  - dataset tampering refused (T32); production import refused without attestations;
  - no `FLOAT`/`DOUBLE` money column or numeric money field in OpenAPI.

## 3. Test data rules

- All fixtures, seed data, recordings, transcripts, documents and snapshots are **synthetic**.
- **SMS and payment fixtures (Stage 3.2)** use generated fake credentials (`zit_fake_<32 hex>`, `store_fake_<8>`, `sigkey_fake_<32 hex>`). The published aamarPay sandbox credentials are **not** committed, even though they are public. No Zaman IT or aamarPay response fixture contains a real key, phone number or payer name (captured fixtures are redacted before commit; PR check).
- **AI fixtures and mock credentials use generated fake secrets** (`fake_<provider>_<random>` plus provider-shaped synthetic strings for redaction tests, generated at test runtime and never committed as real-looking keys).
- A CI test scans the repository for real-key patterns (gitleaks) and for PHI-like fixtures (Bangladesh phone numbers outside the reserved synthetic range `+8801700000000`–`+8801700000999`).
- Production data is never copied to development, test or staging.

## 4. Quality gates (per pull request)

Format, lint (ESLint 10 + custom rules), typecheck, dependency-cruiser, unit, engine contract, migration lint and apply-from-clean, integration, storage contract, API, concurrency, security, OpenAPI diff, TS client compile, Dart client generation (3.0 + 3.1) and analyze, Flutter analyze and test, Playwright (smoke subset on PR; full suite on `main`), secret scan, dependency audit.

These suites are **blocking**: queue concurrency, tenant isolation, prescription approval, document access, AI approval, AI data-use safeguards, secret leakage and (Stage 3.2) payment verification, SMS transport rules and medicine import integrity.
