# Coding Agent Build Contract

**Stage 3.1 rewrite (2026-09-17).**

## MUST

- Read the relevant ADRs (001–017) and implementation documents before changing code. Follow `ARCHITECTURE-CONSISTENCY-AUDIT.md` resolutions.
- Preserve bounded-context ownership (`MODULE-BOUNDARIES.md`) and pass dependency-cruiser (`REPOSITORY-STRUCTURE.md` §4).
- Tenant-scope every sensitive operation in service **and** repository layers. Use composite tenant foreign keys for every tenant-owned relationship.
- Use migrations for schema changes, post-processed by `db:migration:normalize` and passing `db:migration:lint`: utf8mb4 / `utf8mb4_unicode_520_ci`, `VARCHAR(36)` ascii ids, table-level CHECKs, generated-column uniques, expand-only DDL.
- Use `withTransaction` + `lockRow` for row locks, in the documented lock order. Raw SQL only in `packages/database/src/{locks,claims,engine}` and migrations.
- Use `row_version`/`expectedRowVersion` for optimistic locking and `revision` only for business versions.
- Require `Idempotency-Key` on state-changing POSTs, with DB-backed idempotency records.
- Use provider ports and mock adapters. Vendor SDKs and provider HTTP calls live only in `packages/*-adapters/*`.
- Enqueue background work only through `JobPort`/outbox (DB queue, ADR-015). Keep job and event payloads PHI-free and secret-free.
- Preserve auditability and hash-chained append-only tables.
- Preserve AI safeguards (ADR-017):
  - per-doctor credentials;
  - secrets never readable, logged, queued or exported;
  - policy from adapter metadata only;
  - tenant opt-in + acknowledgement + consent + fail-closed minimization for may-train;
  - no raw media to may-train;
  - provider production gates;
  - AI drafts only; clinical records only via `ApproveAISuggestion` in `clinical`.
- Keep the manual workflow fully functional with AI, video, messaging, push, PDF **and payments** disabled; payment status never gates a clinical action.
- **(Stage 3.2)** Compute payment amounts on the server from fee schedules or invoices; mark an intent `PAID` only through `PaymentVerificationService` after a Search Transaction match (ADR-019 §3); keep money in `DECIMAL` columns, decimal-string DTOs and kernel `Money` (integer paisa).
- **(Stage 3.2)** Send SMS only through `SmsProvider` adapters with POST form bodies; keep OTP generation, hashing and verification in HMedic; follow the duplicate-safety rules (ADR-018 §4).
- **(Stage 3.2)** Import medicines only from a Stage M dataset through the importer (checksums, pinned schema hashes, upsert by `canonical_key`, never delete referenced rows); keep catalog data out of dosing fields.
- Maintain generated API contracts (OpenAPI 3.1 + 3.0) and generated clients. Never hand-write duplicate models.
- Use synthetic patient, clinical, payment and account data only in local, test, demo and staging environments. The non-patient reference medicine catalog may be imported in dev and staging (ADR-020); real dataset rows are never committed.
- Keep reference repositories and `tools/medicine-data` out of application imports.
- Before claiming completion, run focused tests, lint, typecheck, depcruise, migration lint and apply, engine-contract, authorization, tenant-isolation and relevant security tests.
- Record Hostinger smoke-test results in `HOSTING-VERIFICATION.md` (HOST-001…HOST-013) and update defaults through an audit row when a result differs.
- Update the backlog status, audit rows and ADRs when a documented decision changes.

## MUST NOT

- Fork or modify Medigo, OpenEMR, HCW@Home, TPT Doctor or DocPilot, or copy their source, assets, fonts, schemas or credentials.
- Introduce PostgreSQL, Redis, BullMQ, Docker-in-production, triggers, stored procedures, events or `DEFINER` clauses (ADR-013/014/015).
- Use `CHAR` for ids or generated-column sources; use `TIMESTAMP` columns; use `utf8mb4_0900_ai_ci`; or use MariaDB features newer than the verified production series.
- Depend on inbound WebSockets or SSE (host restriction); queue freshness uses polling.
- Bypass authorization or rely on frontend filtering.
- Access the database, object storage or AI providers from web or mobile clients.
- Put secrets in source, fixtures, mobile apps, web bundles, logs, job payloads, event payloads, audit metadata or committed env files.
- Put PHI in ordinary logs, traces, error payloads, job or event payloads, or provider requests beyond the minimized content permitted by policy.
- Hard-code AI model ids, provider rate limits (RPM/RPD) or free-tier quotas in code or docs.
- Enable `PLATFORM_MANAGED` AI, transcription, or `PRESCRIPTION_ITEM`/`FOLLOW_UP` approval targets in MVP.
- Close an AI provider production gate or set `AI_FREE_TIER_PRODUCTION_GATE_CLOSED=true` without the documented review record.
- Silently finalize AI output, diagnose, prescribe, overwrite notes or alter the patient record.
- **(Stage 3.2)** Call Zaman IT with `GET`, put `api_key` in a URL, disable TLS verification, or enable plain-HTTP SMS in production without the `GATE-SMS-HTTP` decision.
- **(Stage 3.2)** Trust gateway callback or IPN bodies, accept a client-supplied amount, send a signature key or store ID to web/mobile, use aamarPay's mobile SDKs, or enable platform collection of patient fees in production without `GATE-PAY-PLATFORM-COLLECTION`.
- **(Stage 3.2)** Use `FLOAT`/`DOUBLE`/JavaScript `number` for money; put PHI or clinical content in SMS, `desc` or `opt_*` fields; let a payment or SMS handler write clinical data.
- **(Stage 3.2)** Import an `UNVERIFIED` medicine dataset into production, commit real dataset rows or real provider credentials (including published sandbox values) to the repository, or suggest doses from catalog data.
- **(Stage 3.2)** Run the SMS live smoke or aamarPay sandbox payments in CI, or send more than the one gated live SMS during Stage 4 verification.
- Create public or permanent document URLs, or serve the disk storage root from a web root.
- Invent Bangladesh medicine data, provider credentials, regulatory requirements or compliance claims.
- Skip tests or weaken security controls to make a build pass, or modify unrelated modules to conceal a failing contract.

## Operating model

```text
Task (backlog ID)
 -> inspect relevant ADRs/specs and existing code
 -> implement smallest bounded change
 -> migration (normalize + lint) if required
 -> focused tests
 -> lint / typecheck / depcruise
 -> integration / engine-contract / security tests
 -> update docs / backlog status / audit rows
 -> checkpoint commit
```

If an architectural conflict is discovered:

```text
STOP FEATURE EXPANSION
DOCUMENT CONFLICT
CREATE/UPDATE ADR (or audit row)
UPDATE AFFECTED SPECIFICATIONS
THEN CONTINUE
```

## Checkpoints

A reviewable checkpoint follows each of:
1. Hosting verification (HOST-001…HOST-013 staging subset)
2. Foundation
3. Job queue
4. Tenant/Auth
5. Patient and accounts/guardianship
6. Chamber/Scheduling
7. Serial Engine
8. Consultation
9. Prescription
10. Timeline
11. Follow-up
12. Communication
13. Telemedicine
14. AI credentials and policy
15. AI adapters and drafts
16. Mobile
17. Security Hardening
18. Production Readiness

Each checkpoint requires build, tests, migrations, security checks and acceptance criteria to pass.
