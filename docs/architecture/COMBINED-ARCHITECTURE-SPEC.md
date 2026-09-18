# Combined Architecture Specification

**Generated:** 2026-09-17 (Stage 3.2)

This file consolidates every architecture document under `docs/architecture/`, including ADR-013…ADR-017. The individual source documents are authoritative; regenerate this file after any change.

## Source Documents

- ADR-013-hostinger-hosting.md
- ADR-014-mysql-engine.md
- ADR-015-database-job-queue.md
- ADR-016-object-storage-and-scanning.md
- ADR-017-per-doctor-multi-provider-ai.md
- ADR-018-zamanit-sms-otp.md
- ADR-019-aamarpay-payments-mvp.md
- ADR-020-medicine-dataset-import.md
- AI-SPEC.md
- API-SPEC.md
- ARCHITECTURE-DECISIONS.md
- ARCHITECTURE-REVIEW.md
- BANGLADESH-LOCALIZATION-SPEC.md
- COMMUNICATION-SPEC.md
- DATABASE-SPEC.md
- DOMAIN-MODEL.md
- IMPLEMENTATION-ROADMAP.md
- MOBILE-SPEC.md
- PRODUCT-ARCHITECTURE-SPEC.md
- README.md
- SECURITY-SPEC.md
- SYSTEM-ARCHITECTURE.md
- TRACEABILITY-MATRIX.md

---

# Source: ADR-013-hostinger-hosting.md

# ADR-013 — Production hosting target: Hostinger Cloud Startup

**Status:** Accepted (Stage 3.1, 2026-09-17)
**Refines:** `SYSTEM-ARCHITECTURE.md` §6 (deployment baseline) and `docs/implementation/DEPLOYMENT.md` (Stage 3 container/VM topology).
**Related:** ADR-002 (modular monolith), ADR-014 (engine), ADR-015 (jobs), ADR-016 (storage), ADR-017 (AI).
**Evidence:** `docs/implementation/HOSTING-VERIFICATION.md` (sources, engine probes, HOST-001…HOST-013).

## Context

- The product owner selected **Hostinger Cloud Startup** (managed Node.js web apps) as the production target.
- Verified plan facts:
  - 10 Node.js apps;
  - GitHub build-on-push;
  - environment variables in hPanel;
  - Node 18/20/22/24;
  - 4 CPU, 4 GB RAM and 100 GB NVMe **shared across the plan**;
  - **MariaDB** only (no PostgreSQL, Redis or MongoDB);
  - no Docker, root or system packages;
  - idle Node processes are stopped and restarted on the next request;
  - build and runtime directories are overwritten on deploy;
  - outbound ports open except 0 and 25;
  - inbound WebSockets not allowed;
  - daily (7 days) and weekly (6 weeks) backups;
  - data centers include India, the closest listed location to Bangladesh.
- The domain model (ADR-002 … ADR-012) must not change because of hosting. Hosting-specific choices must sit behind ports so a move to a VPS or managed platform is operational, not architectural.

## Decision

### 1. Topology

```text
Hostinger Cloud Startup (region: India — HOST-009)
  ├─ Node app  api.<domain>           apps/api     NestJS 11 + Fastify, HTTP API, JOB_RUNNER_MODE=off
  ├─ Node app  worker.<domain>        apps/worker  minimal HTTP app: /health/*, /internal/jobs/run, /internal/metrics
  │                                                 continuous job loop while warm (ADR-015 mode 1)
  ├─ Static    app.<domain>           apps/web     Vite build (static), SPA fallback via .htaccess (HOST-012)
  ├─ Node app  api-staging.<domain>   staging api  (synthetic data only)
  ├─ Node app  worker-staging.<domain> staging worker
  ├─ Static    app-staging.<domain>   staging web
  ├─ MariaDB   hmedic_prod            (DB user hmedic_prod_app)      localhost
  ├─ MariaDB   hmedic_staging         (DB user hmedic_staging_app)   localhost
  ├─ Private dir ~/hmedic-storage/staging   (PrivateDiskAdapter, staging; production only if HOST-007 passes)
  └─ hPanel cron (UTC, Custom command, every minute):
        curl -fsS -m 55 -X POST -H @~/.hmedic/cron-prod.hdr    https://worker.<domain>/internal/jobs/run
        curl -fsS -m 55 -X POST -H @~/.hmedic/cron-staging.hdr https://worker-staging.<domain>/internal/jobs/run
        (header files hold "Authorization: Bearer <INTERNAL_CRON_TOKEN>", chmod 600, outside web roots)

External (behind ports; provider = external decision):
  ├─ S3-compatible object storage (ObjectStoragePort; ADR-016)
  ├─ Off-site backup destination (BackupDestinationPort; DEPLOYMENT.md)
  ├─ AI providers (per-doctor credentials; ADR-017)
  ├─ OTP/SMS, email (HTTPS API or port 587; port 25 blocked), WhatsApp, push, video — mock until selected
  └─ Optional OTLP endpoint for logs/metrics/traces (OBSERVABILITY.md)
```

- **App count:** 6 of 10 (static sites may or may not count; HOST-012).
- **Git branches:** Hostinger deploys production apps **only** from the protected `production` branch, and staging apps from the protected `staging` branch (`CI-CD.md`).
- **One process type per app.** The API never runs the job loop in production (`JOB_RUNNER_MODE=off`). Mode 2 (embedded) is a documented fallback only.

### 2. Domains, CORS, cookies, CSRF

| Concern | Decision |
|---|---|
| Web origin | `https://app.<domain>` (staging `https://app-staging.<domain>`) |
| API origin | `https://api.<domain>` (staging `https://api-staging.<domain>`) |
| Worker origin | `https://worker.<domain>`. Not called by clients; CORS disabled (no `Access-Control-Allow-Origin`); every route except `/health/live` requires a bearer token |
| CORS (API) | Exact allow-list from `CORS_ALLOWED_ORIGINS` (production: `https://app.<domain>` only). `Access-Control-Allow-Credentials: true`. Allowed headers: `Authorization`, `Content-Type`, `Idempotency-Key`, `X-Tenant-ID`, `X-Patient-Context`, `X-CSRF-Token`, `X-Request-ID`. Preflight cache 600 s. Mobile apps send no `Origin` and are unaffected. No wildcard |
| Access token (web) | Short-lived JWT held **in memory only**, sent as `Authorization: Bearer`. Never in `localStorage`/`sessionStorage` |
| Refresh token (web) | Cookie `__Host-hm_rt`: `Secure; HttpOnly; SameSite=Lax; Path=/; no Domain attribute` (host-only on `api.<domain>`). `app.` and `api.` are same-site, so the cookie is sent on credentialed `fetch` from the web app. The `__Host-` prefix forbids `Domain`, which prevents subdomain injection |
| CSRF | Only cookie-authenticated endpoints need CSRF: `POST /auth/session/refresh`, `DELETE /auth/session`, `POST /auth/session/logout-all`. Bearer-authenticated endpoints are not CSRF-exposed. **Signed double-submit** (the CSRF token is in a response body because `app.` JavaScript cannot read `api.` host-only cookies): (1) login/OTP-verify and every refresh return `csrfToken` in the JSON body and set `__Host-hm_csrf` (`Secure; HttpOnly; SameSite=Strict; Path=/`) containing the same random value; (2) the web client keeps `csrfToken` in memory and sends `X-CSRF-Token`; (3) the server requires header == cookie, both HMAC-bound to the session id (`CSRF_SECRET`), **and** an `Origin` header in `CORS_ALLOWED_ORIGINS`. On page reload (memory lost), the client calls `POST /auth/session/csrf`, which is `SameSite=Strict`-cookie-authenticated plus `Origin`-checked and returns a fresh token without rotating the refresh token |
| Mobile | Bearer access token plus refresh token in platform secure storage; no cookies; CSRF not applicable |
| Security headers | API: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on authenticated responses. Web (`.htaccess` in `dist`): strict CSP (`default-src 'self'; connect-src 'self' https://api.<domain>; frame-ancestors 'none'; object-src 'none'`), HSTS, nosniff |
| Realtime | **No inbound WebSockets or SSE** (plan restriction). Queue views poll (doctor/staff 5 s while visible, patient 15 s while `WAITING`/`CALLED`, backing off when hidden). Push is an optimization only |

### 3. Runtime

- **Node.js 24.x** pinned in hPanel, `.nvmrc`, `package.json#engines` (`">=24.0.0 <25"`), CI and Docker images (HOST-002). Fallback: Node 22.
- Every Node app binds `process.env.PORT`, handles `SIGTERM` (stop claiming jobs, finish or release leases within 10 s, close pools) and tolerates cold starts. Readiness waits for the DB pool and configuration validation.
- There is no process manager of our own. Hostinger restarts crashed apps.

### 4. Memory budget (4 GB shared)

| Process | `NODE_OPTIONS` | Expected RSS ceiling | Notes |
|---|---|---|---|
| prod `api` | `--max-old-space-size=640` | ~850 MB | Streaming uploads/downloads (no buffering), 5 MiB chunks |
| prod `worker` | `--max-old-space-size=448` | ~600 MB | PDF rendering and image re-encode are the heaviest jobs; `JOB_RUNNER_MAX_CONCURRENCY=2` |
| staging `api` | `--max-old-space-size=256` | ~350 MB | synthetic data, low traffic |
| staging `worker` | `--max-old-space-size=192` | ~280 MB | `JOB_RUNNER_MAX_CONCURRENCY=1` |
| **Total Node** | | **~2.1 GB** | |
| Headroom | | **~1.9 GB** | MariaDB (if counted in plan RAM; UNVERIFIED), static serving, hPanel/PHP processes, other sites, native memory spikes (sharp, TLS) |

Rules:
- No other production workload (e.g. a WordPress site) is added to this plan without re-budgeting.
- Memory alarms: RSS > 85% of ceiling for 10 minutes.
- Staging may be stopped outside test windows to free memory.

### 5. Database connection budget

- Verified limit: **100 connections per DB user** (HOSTING-VERIFICATION #10). Plan global 500.
- Budget per environment, with separate DB users per environment:

| Pool | Max connections | Notes |
|---|---|---|
| prod api (Prisma pool) | 12 | `DATABASE_POOL_MAX=12`, `connectTimeout 10 s`, `acquireTimeout 5 s` |
| prod api lock connection | 1 | reserved for `GET_LOCK`-based singletons if ever needed (normally 0 in API) |
| prod worker pool | 6 | |
| prod worker lock connection | 1 | runner singleton |
| migration/ops scripts | 2 | only during deploy, drills |
| **prod total** | **22** | < 25% of per-user limit |
| staging api / worker / ops | 4 / 3 / 1 | **8 total** on a separate user |

Pools are long-lived (min idle 1, idle timeout 300 s) so cold starts do not churn connections. That matters if the documented `max_connections_per_hour` example (500) applies (HOST-001). Saturation (pool wait p95 > 200 ms, or > 80% of `DATABASE_POOL_MAX` in use for 5 minutes) is a migration signal.

### 6. Scale ceiling

This plan is intended for a **pilot**. It is sized to serve up to:

| Dimension | Ceiling |
|---|---|
| Tenants | 15 |
| Active doctors | 40 |
| Concurrently open chamber days (queues in session) | 20 |
| Concurrent authenticated web/mobile sessions | 250 (≈ 60 staff/doctor workspaces actively polling + patients) |
| Serials issued per day | 3,000 |
| API requests per minute (peak, incl. polling) | 1,500 |
| Jobs per day | 25,000 |
| Stored files | 40 GB (disk adapter budget) |
| Database size | 4 GB (of the 6 GB plan quota) |

**Migration signals.** Any of these, sustained, triggers a planned move:

| Signal | Threshold |
|---|---|
| CPU (hPanel usage) | > 70% for 15 min on ≥ 3 days in a week |
| Memory | RSS of any app > 85% of its ceiling for 10 min, or any OOM/limit-induced restart, or 503 "limits reached" |
| API latency | p95 > 800 ms on queue endpoints (`/chamber-days/*/queue`, serial transitions) for 15 min at peak |
| Job lag | p95 > 90 s for `notifications`, or > 10 min for `ai`/`documents`, over a day |
| DB connections | Pool saturation (above) or any "too many connections" error |
| DB size | > 4 GB (warning), 5 GB (act) |
| Disk | Plan disk > 80%, or storage root > 75% of `STORAGE_DISK_BUDGET_GB` |
| Platform behavior | Worker idle-stops despite cron keep-alive, or cron interval unreliable |

### 7. Migration path (no domain-model change)

1. **Hostinger VPS (KVM) or an equivalent managed platform** in the same or a nearby region.
2. Move processes 1:1: `apps/api`, `apps/worker` and `apps/web` build artifacts are unchanged. On a VPS they run under systemd or containers.
3. **Database.** Keep MariaDB of the same series (dump/restore with verified checksums), or move to managed MariaDB/MySQL. A move to PostgreSQL is a separate ADR, with repositories behind ports (the ADR-014 escape hatch).
4. **Jobs.** Keep the DB queue (ADR-015). Optionally add a Redis/BullMQ `JobPort` adapter behind a flag after load evidence.
5. **Storage.** Switch `STORAGE_ADAPTER=s3` if not already (ADR-016 migration job).
6. **Realtime.** SSE or WebSockets become possible. Polling remains a fallback.
7. **Cutover.** DNS TTL lowered 48 h before; read-only maintenance window; final dump; restore; smoke tests; DNS switch; old plan kept read-only for 7 days.

## Alternatives considered

| Alternative | Why not now |
|---|---|
| Hostinger VPS from day one | More operational burden (OS patching, database administration, backups) before pilot scale requires it. Kept as the migration path |
| Managed PaaS with PostgreSQL/Redis | Contradicts the product owner's hosting selection and adds recurring cost and processors |
| Serverless functions | Long-lived pools, job loops and streaming uploads fit poorly; vendor lock-in |

## Consequences

- Architecture constraints encoded elsewhere:
  - MariaDB (ADR-014);
  - DB job queue with keep-alive cron (ADR-015);
  - disk or S3 storage and baseline scanning (ADR-016);
  - polling instead of sockets;
  - no triggers;
  - guarded migrations in the build step.
- Staging shares plan resources with production. Load tests must not run on the production plan during clinic hours.
- There is no platform-level WAF or rate limiting beyond Hostinger's defaults, so application rate limits (DB-backed) are mandatory.
- HOST-001…HOST-013 must pass on the real plan before production data is stored.

---

# Source: ADR-014-mysql-engine.md

# ADR-014 — Database engine: MySQL-compatible (MariaDB on Hostinger)

**Status:** Accepted (Stage 3.1, 2026-09-17)
**Supersedes:** the **engine choice** in ADR-003 ("PostgreSQL relational source of truth"). ADR-003's principle is unchanged: one relational source of truth for structured, tenant-scoped clinical and operational records, with binaries in object storage.
**Related:** ADR-013 (Hostinger), ADR-015 (jobs), ADR-016 (storage).
**Evidence:** `docs/implementation/HOSTING-VERIFICATION.md` §1 #1–#11 and §3 (engine probes).

## Context

- ADR-013 selects Hostinger Cloud Startup. Hostinger documents that Web and Cloud plans **use MariaDB**, and that PostgreSQL is VPS-only.
- The Stage 3.1 brief said the default was "the verified Hostinger MySQL 8.0+ engine". **Verification found MariaDB, not MySQL.** This ADR follows the verified fact. The brief's intent (the engine the plan actually provides, used through Prisma's `mysql` provider) is preserved, and the discrepancy is recorded in the consistency audit (C-01).
- The MariaDB version on the plan is **not documented** (community reports: 10.6.x in 2024), and is resolved by HOST-001.
- Stage 3 documents used PostgreSQL-specific constructs: `timestamptz`, `jsonb`, `text[]`, `citext`, `gen_random_uuid`, partial unique indexes, native enums, triggers, advisory locks and optional RLS.

## Decision

1. **Engine.** Production uses the Hostinger-managed MariaDB. **The design targets the MariaDB 10.6 feature set.** Every construct used was proven on 10.6.28 and 11.4.13 (HOSTING-VERIFICATION §3). No feature newer than 10.6 may be used unless HOST-001 proves the production series supports it and this ADR is amended.
2. **Access.** Prisma ORM **7.10.0** (`provider = "mysql"`), with the MariaDB driver adapter `@prisma/adapter-mariadb` 7.10.0 (Prisma 7 requires driver adapters; the `prisma-client` generator with explicit `output`). Raw SQL is allowed **only** in `packages/database` (lock helpers, claim queries, engine-contract tests) and in migration files, enforced by lint (§6).
3. **Environment parity.** Local development, CI and Testcontainers use the **same engine and series** as production. The image is pinned by digest in `infrastructure/docker/compose.yaml` and `packages/database/test/containers.ts`. Until HOST-001 reports, the pin is `mariadb:10.6` (latest patch digest recorded at FOUND-004). When HOST-001 reports a different series, the pin moves to that series in the same change that records the result.
4. **Character set.** `utf8mb4` everywhere, with default collation **`utf8mb4_unicode_520_ci`** (`utf8mb4_0900_ai_ci` does not exist on 10.6). Identifier and key columns use `CHARACTER SET ascii COLLATE ascii_bin`. The connection sets `SET NAMES utf8mb4 COLLATE utf8mb4_unicode_520_ci` and `SET time_zone = '+00:00'`. A Bangla round-trip test is mandatory.
5. **Isolation.** Queue, serial, credential and approval transactions run at **`READ COMMITTED`** via Prisma `isolationLevel: 'ReadCommitted'`. Other transactions use the engine default `REPEATABLE READ` unless a use-case contract says otherwise. `innodb_lock_wait_timeout` is set per session to `DB_LOCK_WAIT_TIMEOUT_SECONDS` (default 5; HOST-003 confirms it is settable). Error 1205 (lock wait timeout) and 1213 (deadlock) map to the retryable **`QUEUE_BUSY`** in queue contexts and `CONCURRENCY_RETRY_EXHAUSTED` elsewhere, after `DB_TX_RETRY_MAX` (default 3) jittered retries.

## PostgreSQL → MariaDB translation (normative)

| PostgreSQL construct in Stage 3 docs | Replacement |
|---|---|
| `timestamptz` | `DATETIME(3)` **always UTC** (session `time_zone='+00:00'`; Prisma `DateTime @db.DateTime(3)`). Chamber `local_date DATE` + `timezone VARCHAR(64)` columns unchanged. Never `TIMESTAMP` (2038 range, implicit time-zone conversion) |
| `jsonb` | `JSON`: on MariaDB an alias for `LONGTEXT` with an automatic `JSON_VALID` CHECK. Every JSON column has a Zod schema applied on write and on read (`packages/database/src/json-columns.ts`), and JSON is never queried for business filters. When filtering is needed, the value is promoted to a real column |
| `text[]` | Decided per column (§3 of `DATABASE-IMPLEMENTATION.md`): `chambers.mode_capability` → three boolean columns `supports_physical`, `supports_remote`, `supports_hybrid`; `ai_provider_credentials.allowed_model_ids` → `JSON` array (small, never filtered); `medications` aliases → child table `medication_aliases` (searched); `tenant_ai_policies.allowed_provider_codes` → `JSON` array (small, validated) |
| `citext` (e.g. `users.email`) | `email VARCHAR(254) utf8mb4_unicode_520_ci` (case-insensitive collation) **plus** `email_normalized VARCHAR(254) ascii_bin`/`utf8mb4_bin` (NFKC + lower-case, computed in application code), with the unique index on `email_normalized` |
| `gen_random_uuid()` / pgcrypto | **Application-generated UUIDv7** (`uuidv7` npm package, pinned) for every table. Stored as **`VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin`**. Prisma: `String @id @db.VarChar(36)`, no DB default, value set by `packages/kernel` `newId()`. `BINARY(16)` was rejected: Prisma `Bytes` mapping friction in every repository, unreadable ids in operations, and `BIN_TO_UUID` missing on 10.6. `CHAR(36)` was rejected: MariaDB forbids `CHAR` sources in generated columns (error 1901, proven) |
| Partial unique index | Nullable **PERSISTENT generated column** that is non-null only for rows that must be unique, plus a `UNIQUE` index (NULLs allowed). The full list is in `DATABASE-IMPLEMENTATION.md` §4. Generated columns are declared in migration SQL only; they are **omitted from the Prisma model** and never written by the application |
| PostgreSQL enums | `VARCHAR(n)` (ascii_bin for codes) + **table-level** `CHECK (col IN (...))` (enforced since 10.2.1; proven error 4025) + TypeScript/Zod enum as source of truth. Prisma models use `String`, not Prisma `enum` (native MySQL `ENUM` needs a table rebuild on change). CI test: each CHECK list equals the Zod enum values. Fallback if CHECK is ever not enforced: the repository validates before write (already required) and the test suite asserts rejection at the repository layer |
| Append-only triggers | **Not used in any environment.** Hostinger's import rules exclude TRIGGER/PROCEDURE and SUPER needs a VPS, and grants are not configurable on the plan. Controls: (1) repositories for append-only tables expose insert and read methods only (no update/delete), with a type-level `AppendOnlyRepository` and a lint rule forbidding `prisma.<appendOnlyModel>.update*/delete*`; (2) a mandatory integration test per table proving the repository API cannot mutate; (3) **hash chaining** on `audit_logs`, `queue_events`, `timeline_events`, `ai_approvals` and `tenant_ai_policy_events`: `row_hash = SHA-256(prev_row_hash ‖ canonical_row_json)` per tenant stream, verified by the `VerifyAppendOnlyChains` maintenance job (daily) with an alert on mismatch. This detects tampering that bypasses the application |
| Advisory locks | `SELECT … FOR UPDATE` on the owning row via `lockRow` (serials, chamber days, credentials, suggestions). `GET_LOCK(name, timeout)` for process singletons (job runner, migration). Fallback: `singleton_locks` lease row (ADR-015) |
| RLS (optional) | **Not available.** Tenant isolation is application- and repository-enforced (`TenantContext` required by every repository method), **and composite tenant foreign keys are MANDATORY** on: `serials`, `encounters`, `encounter_notes`, `diagnoses`, `prescriptions`, `prescription_items`, `documents`, `lab_reports`, `timeline_events`, `communications`, `ai_jobs`, `ai_drafts`, `ai_suggestions`, `ai_approvals`, `ai_provider_credentials`. Every referenced parent has `UNIQUE (tenant_id, id)`, and each child FK is `(tenant_id, parent_id) → parent(tenant_id, id)`. The full list, which extends to all child tables, is in `DATABASE-IMPLEMENTATION.md` §4. Prisma models these as compound relations `@relation(fields: [tenantId, parentId], references: [tenantId, id])` |
| `SELECT … FOR UPDATE` via Prisma | Prisma cannot express row locks. **Only** `packages/database/src/locks.ts` may issue them: `lockRow<T extends LockableTable>(tx: TxClient, table: T, id: string, tenantId: string): Promise<LockedRow<T>>` runs `tx.$queryRaw` with a whitelisted table and column list, `WHERE id = ? AND tenant_id = ? FOR UPDATE` (plus `lockRows` in stable id order). It must be called inside `prisma.$transaction(async tx => …, { isolationLevel: 'ReadCommitted', timeout, maxWait })`. ESLint rule `hmedic/no-raw-sql` forbids `$queryRaw`, `$executeRaw` and their `Unsafe` variants outside `packages/database/src/{locks,claims,engine}/**` and `**/migrations/**`; dependency-cruiser forbids importing `packages/database/src/locks` from anywhere except application-layer transaction helpers |

## Additional rules

- **DDL is not transactional on MariaDB.** Every migration must be **expand-compatible** with the currently deployed application version:
  - add nullable columns or new tables first;
  - backfill with a job;
  - switch code;
  - contract (drop or rename) in a later release.
  
  Destructive statements require a separate migration file flagged `-- contract` and a pre-migration dump (`DEPLOYMENT.md`).
- **Migration SQL post-processing.** `pnpm db:migration:normalize` rewrites Prisma-generated `CREATE TABLE` to explicit `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci`, converts id/FK columns to `ascii_bin`, and appends generated columns, CHECK constraints and composite FKs from `packages/database/sql/constraints/*.sql`. CI fails if a migration lacks these (`db:migration:lint`).
- **Engine contract tests** (`packages/database/test/engine-contract/`) run in CI against the pinned image, and against staging for HOST-003:
  - SKIP LOCKED claim with `EXPLAIN` (no filesort);
  - conditional claim;
  - CHECK rejection;
  - each generated unique key;
  - JSON validity;
  - lock-wait mapping;
  - deadlock retry;
  - Bangla round-trip;
  - Asia/Dhaka day boundary;
  - composite tenant FK rejection.

## Rejected alternative: externally managed PostgreSQL (escape hatch)

**Option:** keep PostgreSQL through an external managed provider (e.g. a cloud managed PostgreSQL in a nearby region) while hosting the application on Hostinger.

**Rejected now because:**
- it adds an **additional data processor for health data**, with its own terms, region and breach surface;
- every query crosses the internet between Hostinger and the provider (**cross-provider latency** on hot paths such as queue transitions, plus TLS handshake cost on cold starts);
- it adds an **extra recurring cost** before pilot revenue;
- it creates two backup domains and a network dependency for every request.

**Kept as the documented escape hatch.** Repositories sit behind ports, SQL is confined to `packages/database`, and the translation table above is reversible (UUID strings, UTC datetimes, JSON validated in the app). A move to PostgreSQL requires a new ADR, a Prisma provider switch, re-creating generated-column uniques as partial indexes, and the same engine-contract test suite ported. **No domain-model change.**

## Consequences

- Some integrity guarantees move from database features to tested application controls plus detection (hash chains). This is weaker than PostgreSQL triggers against a privileged attacker with DB credentials, and recorded as an accepted risk.
- Prisma schema readability suffers slightly: generated columns and CHECK constraints live in SQL files. The normalize/lint scripts keep them from drifting.
- The engine version is unknown until HOST-001, so the design is conservative (10.6 feature set).

---

# Source: ADR-015-database-job-queue.md

# ADR-015 — Database-backed job queue (no Redis)

**Status:** Accepted (Stage 3.1, 2026-09-17)
**Supersedes:** the Redis 7 + BullMQ selection in `docs/implementation/TECHNOLOGY-STACK.md` (Stage 3) and the "Redis or equivalent" coordination store in `SYSTEM-ARCHITECTURE.md` §4.
**Refines:** ADR-010 (asynchronous worker architecture). ADR-010's principle stands: clinical transactions are synchronous, and slow or retryable work goes through a durable queue carrying tenant, correlation and idempotency metadata. Only the queue technology changes.
**Related:** ADR-013 (Hostinger hosting), ADR-014 (MySQL-compatible engine), ADR-017 (per-doctor AI).

## Context

- The production target (ADR-013) is Hostinger Cloud Startup. Hostinger does not offer Redis on Web or Cloud plans, and there is no Docker or root access to run it (see `docs/implementation/HOSTING-VERIFICATION.md`).
- BullMQ requires Redis.
- The Stage 3 design already had a transactional outbox (`outbox_events`) in the source database, so a second broker would add another store that could lose, duplicate or reorder work.
- Expected load on the plan's scale ceiling (ADR-013) is low: thousands of jobs per day, not per second.
- Redis was also going to hold rate-limit counters, OTP challenges, idempotency records and caches. Each needs a new home.

## Decision

### 1. One queue store: the relational database

Background work is persisted in two tables in the same MySQL-compatible database (ADR-014), behind the existing `JobPort`. No business module knows how jobs are stored.

**`jobs`**

| Column | Type (MySQL) | Notes |
|---|---|---|
| `id` | `VARCHAR(36)` ascii_bin | UUIDv7, application-generated (ADR-014; VARCHAR, never CHAR — generated-column rule) |
| `tenant_id` | `VARCHAR(36)` ascii_bin NULL | NULL only for platform jobs (catalog refresh, TTL cleanup, backups) |
| `queue` | `VARCHAR(64)` | e.g. `notifications`, `documents`, `ai`, `maintenance`, `outbox` |
| `type` | `VARCHAR(96)` | e.g. `RenderPrescriptionPdf` |
| `payload` | `JSON` | **IDs and enums only. No PHI, no secrets, no provider keys.** Validated by a Zod schema per job type |
| `status` | `VARCHAR(24)` + CHECK | `QUEUED`, `RUNNING`, `WAITING_RATE_LIMIT`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `DEAD` |
| `priority` | `SMALLINT` | lower runs first; default 100 |
| `run_at` | `DATETIME(3)` UTC | earliest start time (delays, backoff, rate-limit waits) |
| `attempts` | `INT` | incremented on claim |
| `max_attempts` | `INT` | per job type; default 8 |
| `concurrency_key` | `VARCHAR(128)` NULL | e.g. `ai-credential:<id>`; see §4 |
| `locked_by` | `VARCHAR(128)` NULL | runner instance id (`<app>:<hostname>:<pid>:<random>`) |
| `locked_at` | `DATETIME(3)` NULL | |
| `lease_expires_at` | `DATETIME(3)` NULL | |
| `last_error_class` | `VARCHAR(64)` NULL | normalized error class; never a raw provider message |
| `idempotency_key` | `VARCHAR(191)` NULL | unique per queue: `UNIQUE (queue, idempotency_key)`; MySQL allows multiple NULLs |
| `correlation_id` | `VARCHAR(36)` ascii_bin | |
| `causation_id` | `VARCHAR(36)` ascii_bin NULL | outbox event id or parent job id |
| `created_at`, `updated_at`, `finished_at` | `DATETIME(3)` | |

Indexes: `(queue, status, priority, run_at)` for claiming — column order must satisfy the claim `ORDER BY priority, run_at` without filesort (proven in HOSTING-VERIFICATION §3.2; an EXPLAIN test enforces it); `(status, lease_expires_at)` for reclaim; `(tenant_id, created_at)`; `(concurrency_key, status)`.

**`dead_letters`**: `id`, `job_id` (unique), `tenant_id`, `queue`, `type`, `payload` (copied, still PHI-free), `attempts`, `last_error_class`, `failed_at`, `replayed_at` NULL, `replayed_by` NULL, `replay_job_id` NULL. Replay is an authorized operator action (`ops.jobs.replay`) and writes an audit event.

**`job_concurrency_leases`**: `(concurrency_key, slot_no)` primary key, `job_id` unique, `lease_expires_at`. See §4.

### 2. Claiming

**Primary (requires verified `SKIP LOCKED` support, HOST-003):**

```sql
-- inside a short READ COMMITTED transaction
SELECT id FROM jobs
 WHERE queue IN (?) AND status = 'QUEUED' AND run_at <= UTC_TIMESTAMP(3)
 ORDER BY priority, run_at
 LIMIT ?
 FOR UPDATE SKIP LOCKED;

UPDATE jobs
   SET status='RUNNING', locked_by=?, locked_at=UTC_TIMESTAMP(3),
       lease_expires_at=UTC_TIMESTAMP(3) + INTERVAL ? SECOND,
       attempts = attempts + 1, updated_at=UTC_TIMESTAMP(3)
 WHERE id IN (?);
COMMIT;
```

**Fallback (engine without `SKIP LOCKED`, or if the verification test fails):** select candidate ids without a lock, then claim each one with an atomic conditional update:

```sql
UPDATE jobs SET status='RUNNING', locked_by=?, locked_at=..., lease_expires_at=..., attempts=attempts+1
 WHERE id = ? AND status = 'QUEUED' AND run_at <= UTC_TIMESTAMP(3);
-- affected rows = 1 means claimed; 0 means another runner won
```

Both strategies implement the same `JobClaimer` interface. The strategy is chosen by `JOB_CLAIM_STRATEGY=skip_locked|conditional_update` (default `skip_locked`), and both pass the same contract test suite against the pinned engine image.

### 3. Leases, retries and dead letters

- A running job holds a lease (default 120 s; per type, e.g. AI 300 s). The runner heartbeats by extending the lease at half its duration. Heartbeat updates require `locked_by` to match.
- **Reclaim:** a maintenance pass sets `RUNNING` jobs whose `lease_expires_at < now` back to `QUEUED` with `run_at = now`, and deletes their concurrency lease. That attempt stays counted.
- **Completion:** a runner may only complete a job it still holds (`WHERE id=? AND locked_by=? AND status='RUNNING'`). A runner that lost its lease discards its result; handlers must be idempotent (§6).
- **Backoff:** `run_at = now + min(maxDelay, base × 2^(attempts−1)) × random(0.5, 1.0)`, with per-type `base` and `maxDelay` (defaults 5 s and 30 min).
- **Terminal failure:** when `attempts >= max_attempts`, or the handler throws a non-retryable error class, the job becomes `DEAD` and a `dead_letters` row is inserted in the same transaction.
- **Rate-limited provider work** (ADR-017) moves to `WAITING_RATE_LIMIT` with `run_at = retry_after` and gives back the attempt it used (`attempts = attempts − 1`), up to a per-type maximum total wait. After that it fails with `RATE_LIMITED`.

### 4. Per-key concurrency

Some work must not run in parallel for the same key, for example AI calls on one doctor's free-tier credential (default concurrency 1).

- A job with `concurrency_key` is claimable only if the runner can also insert a row into `job_concurrency_leases (concurrency_key, slot_no)` for some `slot_no` in `1..limit`, inside the claim transaction.
- If every slot is taken, the insert hits a primary-key conflict. The job stays `QUEUED` and the runner moves on to other work.
- The lease row is deleted on completion or reclaim.
- The limit comes from configuration or the owning record (e.g. `ai_provider_credentials.max_concurrency`, default 1).
- This works the same way on MySQL and MariaDB, and needs neither advisory locks nor `SKIP LOCKED`.

### 5. Outbox → jobs

- `outbox_events` is still written in the same transaction as the source change.
- The **outbox publisher** runs as a job-runner loop. It claims unpublished outbox rows with the same claim strategy, maps each event to zero or more `jobs` rows (unique `(queue, idempotency_key)` with key `<eventId>:<handler>`), and marks the outbox row published, all in one transaction.
- There is no second broker, and delivery is at-least-once with idempotent consumers.

### 6. Handler contract

- Handlers receive `{ jobId, tenantId, correlationId, payload }`, load current state from the database, and must be idempotent. They typically check a business idempotency key or target state before acting.
- Handlers never hold a database transaction open while calling an external provider.
- Payload schemas are versioned (`payload.v`). Unknown versions fail with `JOB_PAYLOAD_UNSUPPORTED` (non-retryable → dead letter).

### 7. Runner modes (deploy-time choice from HOST-005)

**Verified platform fact (HOSTING-VERIFICATION §1 #14):** Hostinger stops a managed Node.js app's process "after a period without incoming traffic" and restarts it on the next request. Every app must bind `process.env.PORT`. No non-HTTP process mode is documented. A worker therefore cannot rely on staying alive without traffic.

| Mode | `JOB_RUNNER_MODE` | When | Behavior |
|---|---|---|---|
| 1. Dedicated worker app, kept warm | `worker` | **Default for Hostinger.** It stays the default as long as HOST-005 shows a 1-minute cron ping keeps the process alive. | `apps/worker` is a minimal HTTP app on `worker.<domain>`. It serves only `/health/live`, `/health/ready`, `/internal/jobs/run` and `/internal/metrics`; everything else returns 404. While the process is up, it polls queues continuously (idle poll interval 1 s with backoff to 5 s). An hPanel **Custom** cron runs every minute (`curl` with `INTERNAL_CRON_TOKEN`) against `/internal/jobs/run`. That call (a) wakes the process if Hostinger idled it, and (b) runs one bounded batch under the singleton lock, so progress is guaranteed even if the loop was stopped. The API sets `JOB_RUNNER_MODE=off`. |
| 2. Embedded runner | `embedded` | Local development convenience, and a fallback if the plan's app count or memory budget cannot fit a separate worker. | The API process runs the same runner loop plus the same `/internal/jobs/run` cron endpoint. It is resolved from a **child DI container** containing only job handlers (see `AI-IMPLEMENTATION.md` §7.5); clinical write modules are never visible to handlers. Concurrency is capped by `JOB_RUNNER_MAX_CONCURRENCY` (default 2). |
| 3. Cron-kick only | `cron` | **Only if HOST-005 shows the process does not stay warm, or background loops are killed between requests.** | No background loop. Each cron call processes a bounded batch (`JOB_CRON_BATCH_MAX`, default 25 jobs; time budget `JOB_CRON_TIME_BUDGET_SECONDS`, default 45 s) and returns counts. |

**Singleton in every mode.** The loop and each cron batch hold `GET_LOCK('hmedic:job-runner:<env>:<queueGroup>', 0)` on a dedicated connection, so two processes never run the same queue group. If the lock is taken, a cron call returns `202 {"skipped":"runner_active"}`. If `GET_LOCK` is unavailable (HOST-004), the fallback is a `singleton_locks` row (`name` primary key, `holder`, `lease_expires_at`) acquired with `SELECT … FOR UPDATE` and renewed every 15 s.

**Latency by mode:**
- In modes 1 and 2, notification jobs normally start within about 1–2 s of commit.
- In mode 3, delay is up to one cron interval plus the batch time. For example, a 1-minute cron can mean about 60–105 s until a patient's "you are called" notification.
- Mode 3 is therefore acceptable only if queue notifications are treated as best-effort. In-app queue state stays authoritative through API polling or push-free refresh, so no clinical workflow depends on job latency.
- In mode 3, the patient apps poll `GET /serials/{id}` (15 s default while `WAITING`/`CALLED`) and the doctor queue view polls the chamber-day queue.

Every mode reports **job lag**: now − `run_at` of the oldest `QUEUED` job per queue. It is exposed on `/health/ready` (degraded threshold) and `/internal/metrics`.

### 8. What moves from Redis to the database

| Former Redis use | New home | Cleanup |
|---|---|---|
| Rate-limit counters | `rate_limit_counters`: `(scope, subject_hash, window_start)` unique, `count`, `expires_at`. Fixed-window counters are combined over the current and previous window (sliding-window approximation) and incremented with `INSERT … ON DUPLICATE KEY UPDATE count = count + 1`. | TTL cleanup job |
| OTP challenges | `otp_challenges`: hashed code (HMAC-SHA-256 with pepper), attempts, `expires_at`, `consumed_at` | TTL cleanup job |
| Idempotency records | `idempotency_records` (see `DATABASE-IMPLEMENTATION.md`) | TTL cleanup after `expires_at` |
| Session / refresh state | `sessions`, `refresh_tokens` (already DB-backed in Stage 3) | Expired-session cleanup |
| Job coordination and locks | `jobs`, `job_concurrency_leases`, `GET_LOCK` singleton | Lease reclaim |
| Caches | **Removed.** An in-process LRU (max 5,000 entries, TTL ≤ 10 min) is allowed only for non-PHI reference data: the medication catalog, the AI model catalog and permission maps. No PHI caching. | n/a |

A `MaintenanceTtlCleanup` job runs every 10 minutes by default through the runner (or every cron tick in mode 3). It deletes expired rows in bounded batches (`LIMIT 1000` per statement, repeated until done or the time budget is spent) from: `rate_limit_counters`, `otp_challenges`, `idempotency_records`, expired `sessions`/`refresh_tokens`, `password_reset_tokens`, `email_verification_tokens`, finished `jobs` older than the retention setting (default 14 days succeeded, 90 days failed; dead letters are kept until an operator purges them), `ai_usage_counters` older than 35 days, and expired upload sessions.

## Alternatives considered

| Alternative | Why not now |
|---|---|
| Redis/BullMQ on a separate managed Redis provider | Adds an external data processor and network latency. Job metadata would leave the primary store, and the plan cannot run Redis itself. |
| Hostinger VPS for Redis only | Splits the operational surface before the scale ceiling is reached. It stays the migration path (ADR-013). |
| External queue SaaS (SQS, Cloud Tasks, QStash) | Adds another processor and credential, with outbound calls in hot paths. It could return later as a `JobPort` adapter. |
| pg-boss / Graphile Worker | PostgreSQL-only, and the engine is MySQL-compatible (ADR-014). |

## Consequences

- One store gives transactional enqueue with the source change, and backups cover jobs.
- Queue throughput is bounded by the database. That is acceptable up to the ADR-013 scale ceiling, and job lag and connection saturation are migration signals.
- The TTL cleanup job and job-table retention must be monitored, or table growth will hurt claim queries.
- `JobPort` stays technology-neutral: a Redis/BullMQ or cloud-queue adapter can be reintroduced on a VPS or managed platform with no domain changes.
- Contract tests must cover:
  - both claim strategies;
  - lease expiry and reclaim;
  - concurrency leases;
  - lost-lease completion rejection;
  - dead-lettering;
  - rate-limit waiting;
  - the `GET_LOCK` singleton with two runner processes.

## Verification gates

- HOST-003: `SKIP LOCKED` works on the production engine. If not, set `JOB_CLAIM_STRATEGY=conditional_update`.
- HOST-004: `GET_LOCK` is available and released on connection close.
- HOST-005: runner mode (worker app vs embedded vs cron).
- HOST-006: cron minimum interval and whether cron can call HTTPS or run a command.

---

# Source: ADR-016-object-storage-and-scanning.md

# ADR-016 — Object storage and malware scanning on Hostinger

**Status:** Accepted (Stage 3.1, 2026-09-17)
**Refines:** ADR-009 (object storage for files). ADR-009's principle stands: binaries live outside the relational store, with metadata, checksum and version in the database, private access only, and authorization before every read. What changes is where binaries live in production and how they are scanned.
**Related:** ADR-013 (Hostinger hosting), ADR-015 (job queue), ADR-017 (AI raw-output storage).

## Context

- Hostinger Cloud Startup provides no S3-compatible object storage service (see `docs/implementation/HOSTING-VERIFICATION.md`, HOST-007).
- Disk is 100 GB NVMe, **shared** by every site and app on the plan.
- There is no ClamAV or custom system packages, so the Stage 3 "worker scans malware" assumption cannot be met on the host.
- Files include lab reports, prescription PDFs, images, and in V1+ audio. They contain PHI and must survive redeploys, be backed up, and never be publicly reachable.

## Decision

### 1. `ObjectStoragePort` with two production-capable adapters

```ts
interface ObjectStoragePort {
  createUploadSession(input: { key: ObjectKey; contentType: string; sizeBytes: number; sha256: string; partSizeBytes: number; expiresAt: Date }): Promise<UploadSession>;
  uploadPart(input: { sessionId: string; partNumber: number; body: ReadableStream | Buffer; contentSha256: string }): Promise<PartReceipt>; // used by API-proxied adapters
  getPartUploadTargets?(input: { sessionId: string; partNumbers: number[] }): Promise<PresignedPart[]>;        // direct-to-bucket adapters only
  completeUpload(input: { sessionId: string; parts: PartReceipt[] }): Promise<StoredObjectMeta>;
  abortUpload(input: { sessionId: string }): Promise<void>;
  head(key: ObjectKey): Promise<StoredObjectMeta | null>;
  openReadStream(key: ObjectKey, range?: ByteRange): Promise<ReadableStream>;
  createSignedDownload?(key: ObjectKey, ttlSeconds: number, disposition: ContentDisposition): Promise<SignedUrl>; // S3 only
  delete(key: ObjectKey): Promise<void>;
  capabilities(): { directClientUpload: boolean; signedDownloadUrls: boolean; serverSideEncryption: boolean };
}
```

- **Object keys** are opaque and follow `t/<tenantId>/<category>/<uuidv7>/<version>`. A key never contains names, phone numbers or file names. The original file name is stored as encrypted metadata in the database only if the category policy needs it.
- **`S3CompatibleAdapter`** is the preferred production target.
  - It uses a private bucket with block-public-access, bucket policy deny-list, and server-side encryption if the provider offers it.
  - Clients upload directly with presigned multipart part URLs; `getPartUploadTargets` returns URLs valid for at most 15 minutes.
  - Downloads use short-lived presigned GET URLs (default 60 s) issued only after API authorization.
  - The storage provider is an **external decision** (research register). Candidates to evaluate, with none selected: Cloudflare R2, Backblaze B2 (S3 API), Wasabi, DigitalOcean Spaces, AWS S3 (e.g. `ap-south-1`/`ap-southeast-1`), and Hostinger VPS running a self-managed S3-compatible server. Criteria:
    - region latency to Bangladesh;
    - data-processing terms;
    - encryption;
    - egress cost;
    - lifecycle rules;
    - presigned multipart support.
- **`PrivateDiskAdapter`** is allowed in staging and production **only if HOST-007 verifies a persistent, non-public directory** that survives redeploys (e.g. `~/hmedic-storage/<env>/`, outside every document root and outside the app's deploy directory). Its rules:
  - `STORAGE_DISK_ROOT` must be an absolute path. At startup the API verifies that it exists, is writable, and is not inside any configured public root; if any check fails, startup is refused.
  - **No direct URLs.** Downloads stream through `GET /documents/{id}/download?token=…`. The token is a short-lived (default 60 s), single-object, single-version HMAC-signed token bound to tenant, actor and document version, issued by `POST /documents/{id}/download-token` after authorization. The streaming endpoint re-checks the token, sets `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`.
  - **Uploads are chunked and resumable through the API.** `PUT /documents/upload-sessions/{id}/parts/{n}` stores each chunk as `<root>/.uploads/<sessionId>/<n>.part` with a per-part SHA-256. Finalize concatenates the parts in order into `<root>/objects/<key>`, verifies total size and full-file SHA-256, `fsync`s, then atomically renames into place.
  - **Path safety.** Keys are validated against `^[a-z0-9/_-]+$`, resolved with `path.resolve`, and rejected unless the resolved path starts with the root. Symlinks inside the root are refused (`lstat`).
  - **Checksums** are verified on finalize and before every scan. A mismatch returns `CHECKSUM_MISMATCH`.
  - **Backups include the storage root** (see `docs/implementation/DEPLOYMENT.md` §Backups).
  - **Disk-usage alert.** A maintenance job measures storage-root bytes and filesystem free space. It alerts at 60% (warning) and 75% (critical) of the configured storage budget (`STORAGE_DISK_BUDGET_GB`, default 40 GB of the 100 GB shared quota). It also alerts when total plan disk usage passes 80%. Crossing critical is a documented migration signal to the S3 adapter (ADR-013).
- **Adapter selection** is set by `STORAGE_ADAPTER=s3|disk`. Every environment picks exactly one, and a migration job (`MigrateObjectsBetweenAdapters`) copies objects and verifies checksums before the flag flips.
- **Local development** uses MinIO in Docker Compose for the S3 adapter and a temp directory for the disk adapter.
  - **Both adapters pass one shared contract test suite:**
    - multipart resume;
    - checksum mismatch;
    - abort;
    - range read;
    - path traversal (disk);
    - expired session;
    - delete;
    - capability flags.
  - MinIO is **local and CI only**, never production.

### 2. Upload state and scanning

```text
CREATED -> UPLOADING -> UPLOADED -> SCANNING -> AVAILABLE
CREATED/UPLOADING -> EXPIRED
UPLOADED/SCANNING -> REJECTED
SCANNING -> SCAN_ERROR -> SCANNING (retry) | REJECTED (after max attempts)
```

- A file is readable by non-uploader roles only in `AVAILABLE`. The uploader can see its own `UPLOADED`/`SCANNING` status but cannot download it.
- **`MalwareScanPort`**:
  ```ts
  interface MalwareScanPort {
    scan(input: { key: ObjectKey; declaredContentType: string; sizeBytes: number; category: DocumentCategory }): Promise<ScanVerdict>;
    describe(): { adapter: string; detectsKnownMalware: boolean; limits: string[] };
  }
  type ScanVerdict = { result: 'CLEAN' | 'REJECTED' | 'ERROR'; reasonCode?: ScanReason; sanitizedKey?: ObjectKey };
  ```
- **Adapters:**
  1. **`MockMalwareScanner`** (local/CI): deterministic results keyed by fixture names.
  2. **`BaselineContentPolicyScanner`** (default for staging/production until an external scanner is selected):
     - **Allowlist per category:** PDF, JPEG, PNG and WebP for documents and lab reports. V1 audio: `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`.
     - **Magic-byte sniffing** (e.g. `file-type`) must match the declared and allowed type.
     - **Per-category size limit** from configuration.
     - **Images are fully decoded and re-encoded** (e.g. `sharp`, a prebuilt binary that must run on the host; HOST-002). Metadata (EXIF/GPS) is stripped, and the re-encoded file replaces the original as a new `document_versions` row, with the original deleted after success.
     - **PDFs** are structurally parsed (e.g. `pdf-lib` load) and rejected if they are encrypted, fail to parse, contain `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile` or `/OpenAction`-to-JavaScript, or exceed the configured page limit. PDFs are **not** rewritten, so the raw report stays authoritative.
     - **Honest limits** (recorded in `describe()` and shown in admin docs):
       - it does **not** detect known malware signatures;
       - it does not detect exploits in otherwise well-formed PDFs;
       - it does not inspect macros in non-allowed Office types, because those types are rejected outright;
       - it does not protect a user who downloads and opens a crafted PDF in a vulnerable reader.
       Downloads are served as attachments with `nosniff` to reduce browser-side risk.
  3. **`ExternalScanServiceAdapter`** (Future): an HTTP scanning service behind the port, with provider selection and data-processing review in the research register.
- **Scanning runs as a job** (`ScanDocumentVersion`, queue `documents`). Documents stay `SCANNING` until the configured scanner returns. `ERROR` retries with backoff; after `max_attempts` the result is `REJECTED` with `SCAN_UNAVAILABLE`, and the uploader sees a retry-upload message.

### 3. Other uses of storage

- **Prescription PDFs:** rendered by a worker, stored via the port, not scanned (generated internally), checksummed.
- **AI raw provider output** (ADR-017): stored under category `ai-raw`, never shown to patients, readable only through audit roles, with per-tenant retention.
- **Backups:** encrypted dumps go to a *separate* off-site destination behind `BackupDestinationPort`, never into the same storage root (see `DEPLOYMENT.md`).

## Alternatives considered

| Alternative | Why not |
|---|---|
| Public web-root folder with obscure names | Violates private-access and authorization-before-read rules. |
| Database BLOBs | Bloats backups and the connection budget; rejected in ADR-009. |
| ClamAV on the host | No system packages or daemon on the plan. Possible on a VPS later, as an `ExternalScanServiceAdapter`-like local adapter. |
| Only S3 from day one | Requires an external storage decision before Foundation. The port plus disk adapter keeps Stage 4 unblocked while the decision is researched. |

## Consequences

- API-proxied disk uploads and downloads consume API memory, CPU and bandwidth. The streaming implementation must never buffer whole files in memory. Chunk size defaults to 5 MiB and is capped at 8 MiB, and memory tests are required.
- The disk adapter keeps PHI on the same plan as the application. Plan backups plus off-site encrypted file backups are mandatory, and disk budget is a migration trigger.
- The baseline scanner reduces but does not eliminate malicious-file risk. That limitation is recorded as an accepted risk until an external scanner is selected.
- Switching adapters is operational (copy, verify, flip flag) and needs no schema or API change.

## Verification gates

- HOST-007: a persistent, non-public, redeploy-surviving directory exists (required for `PrivateDiskAdapter`).
- HOST-010: backup inclusion of that directory and downloadable backups.
- HOST-002: native image library (`sharp` prebuilt binary) loads on the host. Fallback: the image re-encode step is disabled, JPEG/PNG/WebP are accepted after magic-byte and size checks only, and this is recorded as a reduced-assurance mode in `describe()`.

---

# Source: ADR-017-per-doctor-multi-provider-ai.md

# ADR-017 — Per-doctor, multi-provider AI credentials with enforced data-use safeguards

**Status:** Accepted (Stage 3.1, 2026-09-17)
**Refines:** ADR-008 (AI approval architecture). ADR-008 is unchanged: AI creates drafts and suggestions only, and only explicit doctor approval creates clinical records. This ADR decides **whose credentials** call **which providers**, and what safeguards must hold before patient data leaves the platform.
**Related:** ADR-013 (hosting: no KMS), ADR-015 (job queue), ADR-016 (raw-output storage), `docs/implementation/AI-IMPLEMENTATION.md`, `docs/implementation/AI-PROVIDER-REGISTER.md`.

## Context

- Hakeemify's product decision: **each doctor brings their own AI key.**
  - **Default:** the doctor's own Google AI Studio (Gemini API) key on the **free tier**.
  - **Optional:** doctors who agree to pay use a paid key (BYOK), including Gemini with billing enabled on their own project.
  - **Platform-managed paid key** (Hakeemify pays and bills the doctor) must be designed but disabled.
- **Provider terms differ by tier.** Google's Gemini API terms describe free-tier (unpaid) content as usable for improving Google products, including human review. Paid-tier content is described as not used for that purpose. Other providers' free tiers have similar or unknown terms. See `AI-PROVIDER-REGISTER.md` for the clauses and last-verified dates.
- **Rate limits and model availability change often**, so they cannot be constants.
- **AI must stay optional.** The manual workflow must be unaffected when no credential exists.
- **Hosting has no key-management service** (ADR-013), so secrets need application-level envelope encryption.

## Decision

### 1. Ownership

- An AI credential belongs to **one doctor within one tenant**: `(tenant_id, doctor_profile_id)`.
- A doctor who works in two tenants configures credentials separately in each. Credentials are never shared across tenants.
- The owning doctor manages their own credentials.
- A member with the explicit grant **`ai.credentials.manage`** (for example a clinic admin) may **add, replace, disable or revoke** a doctor's credential. **Nobody can read a saved secret back**, including that member and the owning doctor. Only `secret_last4`, provider, tier, status and usage are visible.
- Jobs for a doctor may only use that doctor's credentials. Staff-triggered AI actions for a doctor's encounter are not allowed in MVP; AI jobs are doctor-triggered.

### 2. Billing modes

| `billing_mode` | Meaning | MVP |
|---|---|---|
| `DOCTOR_BYOK_FREE` | Doctor's own key on a provider free tier | **Default mode** |
| `DOCTOR_BYOK_PAID` | Doctor's own key on a paid tier (e.g. Gemini with Cloud Billing enabled) | Enabled |
| `PLATFORM_MANAGED` | Hakeemify-held key; usage metered for future billing | **Designed, disabled** behind `AI_PLATFORM_MANAGED_ENABLED=false`. Only metering tables (`ai_usage_ledger`) and ports exist; no billing tables or endpoints (billing stays Future per the consistency audit). |

### 3. Encoded data-use policy (not just documentation)

- **Static adapter metadata.** Every provider adapter declares, in code under `packages/ai-adapters/<provider>/metadata.ts`, one entry per `(providerCode, tier)`:
  - `dataUsePolicy`: `MAY_TRAIN_OR_REVIEW` | `NO_TRAINING_CONTRACTUAL` | `UNKNOWN`;
  - `tier`: `FREE` | `PAID`;
  - `processingRegionNotes`;
  - `termsUrl`;
  - `termsLastVerifiedAt`;
  - `capabilities` (text, jsonSchema, audio, vision).
  
  The metadata matches a row in `AI-PROVIDER-REGISTER.md`, and a CI test fails if the two diverge (the register is parsed as a table).
- **Effective policy:**
  ```text
  effective_data_use_policy = metadata(provider_code, declared_tier).dataUsePolicy, with UNKNOWN treated as MAY_TRAIN_OR_REVIEW
  ```
  It comes only from adapter metadata and the declared tier. It is **never** derived from user-typed text, and a user cannot declare a stricter policy than the metadata allows.
- **Declared tier.** The doctor declares `FREE` or `PAID`.
  - Where the provider exposes a reliable signal, validation compares it with the declaration. On a mismatch the credential cannot activate, with `last_error_class=TIER_MISMATCH`.
  - Where no reliable signal exists, the declaration stands. The acknowledgement text states that the doctor is responsible for the declaration.
  - A `PAID` declaration that cannot be verified is still treated as `PAID` for policy purposes, but the UI labels it "tier self-declared".
- **Hard preconditions** for any job whose credential's effective policy is `MAY_TRAIN_OR_REVIEW`. **All** must hold; the job is refused with `POLICY_BLOCKED` otherwise:
  1. **Tenant opt-in.** The tenant AI policy has `free_tier_ai_allowed = true`. The default is `false` (`AI_FREE_TIER_ALLOWED_DEFAULT=false`). Opting in is a `tenant_owner` action (`ai.policy.manage`), recorded with policy version, actor and time.
  2. **Doctor acknowledgement.** The doctor has an active `ai_data_use_acknowledgements` row for that provider, tier and the **current** terms-text version. A new text version invalidates older acknowledgements, and the credential returns to `PENDING_VALIDATION` until the doctor re-acknowledges.
  3. **Patient consent.** The patient whose data is used has an active `patient_consents` row with purpose `ai_assistance`.
  4. **Minimization.** The `PhiMinimizationService` has run and succeeded. On failure the job fails with `PHI_MINIMIZATION_FAILED` and **nothing is sent**.
  5. **Text only.** Audio transcription and raw document or image sending are blocked for these credentials (`POLICY_BLOCKED`, reason `RAW_MEDIA_NOT_ALLOWED_FOR_POLICY`), because identifiers cannot be reliably removed from raw media.
- **`NO_TRAINING_CONTRACTUAL` credentials** still require tenant AI enablement, patient consent, and minimization by default. A tenant owner may set `minimization_required_for_no_training = false` through a recorded policy decision. That relaxation is an internal risk decision, **not a legal claim**, and the UI says so.
- **Visibility.** The UI shows the credential's data-use class (for example "Free tier — provider may use data to improve its products") next to every AI action and in the draft review screen.
- **Legal gate.** "AI provider use of patient data in Bangladesh" is an **open research gate**. Until it is closed, free-tier AI **must not be enabled with real patient data in production**. This is enforced by the production readiness checklist, plus a startup check: if `APP_ENV=production` and `AI_FREE_TIER_PRODUCTION_GATE_CLOSED != true`, the policy engine forces `free_tier_ai_allowed = false` for every tenant. Development and staging use synthetic data only.

### 4. Secrets

- **Envelope encryption.**
  - A per-credential random 256-bit data key encrypts the secret with AES-256-GCM.
  - The data key is itself wrapped by the key-encryption key `AI_CREDENTIAL_KEK` (32 random bytes, base64) identified by `AI_CREDENTIAL_KEK_ID`.
  - Stored fields: `encrypted_secret` (ciphertext + IV + tag), `wrapped_data_key`, `key_id`.
  - Additional authenticated data (AAD) = `credential_id|tenant_id|doctor_profile_id|provider_code`, so ciphertext moved to another row fails to decrypt.
- **Key rotation** (no KMS on the plan):
  1. Add the new KEK as `AI_CREDENTIAL_KEK` and `AI_CREDENTIAL_KEK_ID`, keeping the old one in `AI_CREDENTIAL_KEK_PREVIOUS` / `AI_CREDENTIAL_KEK_PREVIOUS_ID`.
  2. Run the `ReencryptAICredentials` job, which rewraps data keys in batches and is idempotent by `key_id`.
  3. Verify no rows still reference the old key id.
  4. Remove the previous KEK.
  
  Each step is audited.
- **Never exposed.** Secrets are never returned after save, never logged, never placed in job payloads (jobs carry `credential_id` only), never exported, and never cached in plaintext beyond the single provider call. The decrypted value lives only inside the adapter call scope. Buffers are overwritten after use where the runtime allows; this is best-effort in Node and documented as such.
- **Fingerprint.** `secret_fingerprint = HMAC-SHA-256(AI_CREDENTIAL_FINGERPRINT_PEPPER, secret)` enables duplicate detection without storing a reversible hash.
- **Validation job.** Saving a key creates the credential in `PENDING_VALIDATION` and enqueues `ValidateAICredential`, a minimal non-PHI call such as a model list or a fixed synthetic prompt, which sets `ACTIVE`, `INVALID` or `QUOTA_EXHAUSTED`.
- **Revocation is immediate.** Status `REVOKED` commits synchronously. Runners re-read credential status immediately before the provider call, and again before persisting results; in-flight jobs fail with `AI_CREDENTIAL_REVOKED` and results obtained after revocation are discarded.

### 5. Providers and adapters

- **`AIProvider` port:** `validateCredential`, `listModels`, `generateStructured(schema, messages, options)`, `transcribe` (capability-gated), `countTokens` (optional), with a normalized error taxonomy:
  - `INVALID_CREDENTIAL`
  - `RATE_LIMITED` (with `retryAfter`)
  - `QUOTA_EXHAUSTED`
  - `MODEL_UNAVAILABLE`
  - `CONTENT_BLOCKED`
  - `SCHEMA_INVALID`
  - `TIMEOUT`
  - `PROVIDER_ERROR`
  - `PHI_MINIMIZATION_FAILED`
  - `POLICY_BLOCKED`
  - `AI_CREDENTIAL_REVOKED`
- **MVP adapters:** `MockAIProvider` (deterministic, fixtures for every error class), `GeminiApiAdapter` (Google AI Studio key; free or paid by declaration), `OpenAICompatibleAdapter` (configurable base URL; each concrete provider still needs its own metadata entry and register row before it can be selected).
- Additional named adapters are Future. Their metadata slots are defined in the register. Vendor SDKs may be imported **only** inside `packages/ai-adapters/*`, enforced by dependency-cruiser.
- **Models** come from `ai_model_catalog`, refreshed by a job through provider list-models APIs where available. No model ID is hard-coded in business code: defaults come from the catalog plus configuration, and tests use mock model IDs.
- **Rate limits** are configuration plus observed provider responses (`429`/`retry-after`) recorded in `ai_usage_counters`. No RPM/RPD numbers appear in code or docs; the register links to the providers' current documentation.

### 6. Execution

- **Jobs.** AI jobs run through ADR-015 with `concurrency_key = ai-credential:<credential_id>`. Default concurrency is 1 per credential, configurable per credential up to `AI_MAX_CONCURRENCY_PER_CREDENTIAL`.
- **`RATE_LIMITED`** moves the job to `WAITING_RATE_LIMIT` until `retry_after` without consuming an attempt, up to `AI_RATE_LIMIT_MAX_WAIT_SECONDS`.
- **`QUOTA_EXHAUSTED`** marks the credential `QUOTA_EXHAUSTED` and fails the job with a doctor-readable message.
- **Fallback between credentials** happens only if **all** hold:
  - the doctor configured a fallback order;
  - the fallback credential is `ACTIVE`;
  - its effective policy is **equal or stricter** (`NO_TRAINING_CONTRACTUAL` ≥ `MAY_TRAIN_OR_REVIEW`);
  - its model supports the required capability;
  - all preconditions in §3 hold for the fallback's policy.
  
  There is **never** fallback to a platform-managed key, and **never** from a no-training credential to a may-train credential.
- **Provenance.** Every job records provider, model, tier, billing mode, effective policy, prompt template version, output schema version, minimization report (categories and counts only), usage, and error class.
- **Quota display.** Doctors see used and remaining estimates derived from counters and provider headers, labeled "estimate".

### 7. Provider usage restrictions and the provider production gate (added after terms review, 2026-09-17)

**Conflict discovered.** The Gemini API Additional Terms (last updated 2026-04-28; `AI-PROVIDER-REGISTER.md` row `gemini`) state, for **all** tiers:
- "You may not use the Services in clinical practice, to provide medical advice, or in any manner that is overseen by or requires clearance or approval from a medical device regulatory agency."
- For the unpaid tier: "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
- The APIs require users to be 18+, and are barred for apps "likely to be accessed by individuals under the age of 18".

The product's default mode (doctor's own Gemini free-tier key used during consultations) is therefore **in tension with the provider's own terms**, independent of our minimization safeguards. This ADR does not resolve that legal question and makes no compliance claim. It records the conflict (consistency audit C-02) and encodes a gate:

1. **Usage restrictions in adapter metadata.** Each metadata entry carries `usageRestrictions: UsageRestriction[]` (e.g. `NO_CLINICAL_PRACTICE_USE`, `NO_SENSITIVE_PERSONAL_DATA_FREE_TIER`, `USERS_18_PLUS`, `PAID_ONLY_FOR_EEA_UK_CH_END_USERS`) and `productionGate: 'OPEN' | 'CLOSED'`, where `CLOSED` means a documented legal/product review accepted use with real patient data for that `(provider, tier)`. **All provider entries start `OPEN`.**
2. **Enforcement.** When `APP_ENV=production`, a credential for a `(provider, tier)` whose gate is `OPEN` cannot become `ACTIVE`. Validation leaves it `PENDING_VALIDATION` with `POLICY_BLOCKED` / `PROVIDER_PRODUCTION_GATE_OPEN`. The gate is closed only by changing adapter metadata and the register together, in a reviewed change referencing the review record. There is no runtime override. Development and staging (synthetic data only) are unaffected, so the Gemini free-tier default mode can be built and tested end to end.
3. **Default mode stays as specified** (Gemini free tier is the first-offered option in the credential UI), because the product brief requires it and because it is buildable and testable. **Production enablement of any provider with real patient data is blocked** until the register gate for that provider/tier is closed. For Gemini specifically, the clinical-practice clause must be reviewed first. Evaluating alternatives is recorded as an external product decision: providers whose terms have no clinical-use prohibition and a contractual no-training commitment (register candidates: OpenAI API paid, Anthropic API paid via a future native adapter, Groq, Mistral paid), subject to the same review.
4. **Patient-facing apps never call AI** (doctor-triggered only), which keeps AI out of apps that minors may use. The age restriction is recorded for review, not resolved.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Single platform key for everyone | Hakeemify bears cost and data-processing responsibility before billing exists; conflicts with the product decision. Kept as disabled `PLATFORM_MANAGED`. |
| Trust a user-entered "this provider doesn't train" flag | Policy would depend on unverified user input. Rejected: policy is derived from reviewed metadata only. |
| Allow audio/images on free tier with best-effort redaction | Identifiers in voice and images cannot be reliably removed. Rejected for may-train credentials. |
| Store keys hashed only | The platform must replay the key to the provider, so encryption is required. |

## Consequences

- Each doctor's free-tier limits, outages and terms changes are isolated per credential. The UX must explain quotas and data-use classes clearly.
- The register and adapter metadata need periodic review. `termsLastVerifiedAt` older than `AI_TERMS_MAX_AGE_DAYS` (default 180) raises a warning metric and admin banner. It does not silently change policy.
- Minimization reduces clinical context in prompts, such as exact dates becoming relative days. Evaluation must measure the draft-quality impact on synthetic data.
- No part of this ADR is legal or regulatory clearance.

---

# Source: ADR-018-zamanit-sms-otp.md

# ADR-018 — Zaman IT as the first SMS and OTP delivery adapter

**Status:** Accepted (2026-09-17, Stage 3.2)
**Extends:** ADR-007 (communication provider abstraction). **Resolves:** the Stage 3.1 external decision "Production OTP/SMS provider".
**Evidence:** `docs/implementation/ZAMANIT-VERIFICATION.md`. **No compliance claim** is made.

## Context

- The product owner selected **Zaman IT** (Bangladesh) as the SMS provider. The following facts come from the provider dashboard and are treated as input, not verified by us:
  - send endpoint `http://103.89.240.228/api/sendsms`, balance endpoint `http://103.89.240.228/api/checkbalance`;
  - `api_key` parameter; regenerating the key in the dashboard invalidates the old key immediately;
  - GET and POST accepted;
  - send parameters `api_key`, `type` (`text` | `unicode`), `phone` (`88017XXXXXXXX`, several joined with `+`), `senderid`, `message`;
  - error codes 1001–1007;
  - prepaid BDT balance.
- **The published base URL is plain HTTP on a bare IP**, and the provider's sample code disables TLS verification.
- The provider's public web page sits behind a bot-verification interstitial and was not read. A search-index snippet of it claims "only delivered SMS are charged"; that claim is UNVERIFIED.
- Stage 3.1 designs OTPs as generated, HMAC-hashed, expired and verified by HMedic (`AUTH-IMPLEMENTATION.md`), with synchronous delivery after commit.
- The provider exposes no idempotency key, so a timeout can mean "sent".

## Decision

### 1. Ports and ownership

```text
identity-access: OtpService ──> OtpDeliveryPort ──> SmsOtpDelivery (communication public facade)
                                                     └─> SmsProvider port ──> ZamanItSmsAdapter | MockSmsAdapter
communication:   DeliverCommunication job ──> SmsProvider port (same adapters)
```

- **HMedic owns the OTP lifecycle.** Zaman IT only transports text. `OtpDeliveryPort` (identity-access) and `SmsProvider` (communication) are separate ports, and the Stage 3.1 `OtpProvider` port is renamed `OtpDeliveryPort`.
- **Adapter packages:** `packages/communication-adapters/zamanit` and `packages/communication-adapters/mock` (SMS mock).
- **OTP always uses the platform account.** Authentication happens before any tenant context exists.

```ts
interface SmsProvider {
  readonly code: 'zamanit' | 'mock';
  send(input: {
    credential: SmsCredentialHandle;                        // resolved server-side; secret never leaves the process
    destination: E164Phone;                                  // canonical +8801XXXXXXXXX
    text: string;                                            // rendered template, no PHI
    purpose: 'OTP' | 'TRANSACTIONAL';
    correlationId: string;
  }): Promise<SmsSendResult>;
  checkBalance(credential: SmsCredentialHandle): Promise<SmsBalanceResult>;
}
type SmsSendResult =
  | { outcome: 'ACCEPTED'; providerMessageId?: string; segmentsEstimated: number; encoding: 'text' | 'unicode' }
  | { outcome: 'REJECTED'; errorClass: SmsErrorClass; providerCode?: string }
  | { outcome: 'PROVIDER_UNAVAILABLE'; errorClass: 'PROVIDER_UNAVAILABLE' }   // provably not sent (connect/DNS failure before request bytes)
  | { outcome: 'UNKNOWN_OUTCOME'; errorClass: 'UNKNOWN_OUTCOME' };           // timeout after send, 5xx, unparseable body
```

### 2. Transport security

- **Always `POST`, with an `application/x-www-form-urlencoded` body. Never `GET`.** With GET, the key would appear in URLs, proxy logs, provider access logs and Hostinger logs. An ESLint rule in the adapter package forbids `method: 'GET'` and query-string construction containing `api_key`.
- **TLS verification is never disabled.** `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED` and custom insecure agents are forbidden by lint and by a startup check.
- **If an HTTPS endpoint becomes available, it is mandatory.** `ZAMANIT_BASE_URL` must then be `https://`, and the adapter refuses `http://` unless `ZAMANIT_ALLOW_INSECURE_HTTP=true`.
- **Until then, the HTTP risk is explicit.** The API key, the recipient phone number and the message text (including OTP codes) travel **unencrypted** between the Hostinger data center and the provider IP. Anyone on the network path can read or tamper with them.
- **Production gate `GATE-SMS-HTTP` (OPEN).** With `APP_ENV=production`, the adapter refuses an `http://` base URL unless:
  - `ZAMANIT_ALLOW_INSECURE_HTTP=true`; **and**
  - a platform audit record `SMS_HTTP_TRANSPORT_RISK_ACCEPTED` exists. It is written by `pnpm ops:record-risk-decision --gate GATE-SMS-HTTP --owner <name> --expires <date>`, which requires DB operator access and appends to the platform audit chain, and it must not be expired.

  Without both, OTP delivery fails closed and an alert fires. The gate is listed in `IMPLEMENTATION-REVIEW.md` §4 and requires an **explicit owner decision**. Engineering cannot close it.
- **Mitigations (all mandatory):**
  1. Ask the provider for HTTPS with a hostname, and for IP allow-listing of the Hostinger egress IP (`docs/implementation/zamanit-provider-request.md`).
  2. Keep OTPs short-lived with strict limits: `OTP_TTL_SECONDS` default **180** (max 300), `max_attempts` 5, a new challenge on every resend (the previous one is superseded), and resend limited by `otp:phone` 3 per 15 min and 10 per day.
  3. Rotate keys on schedule: `ZAMANIT_KEY_MAX_AGE_DAYS` (90) triggers an alert. The runbook `runbooks/zamanit-key-rotation.md` covers the fact that regeneration invalidates the old key immediately: rotate off-peak, update hPanel env at once (the redeploy takes minutes), then verify with `checkbalance`.
  4. Alert on balance anomalies: the balance is below `ZAMANIT_BALANCE_ALERT_BDT`, or it drops more than `ZAMANIT_BALANCE_DROP_ALERT_BDT_PER_HOUR` beyond expected spend (possible key abuse).
  5. **No PHI in SMS text**, whatever the transport (§5).
  6. Staff and doctor accounts can require password + OTP step-up, so an intercepted OTP alone never grants staff access (`requireOtpForStaff` remains a second factor, not a first factor).

### 3. Formats, encoding and segments

- **Phone:**
  - canonical storage stays `+8801[3-9]XXXXXXXX` (E.164);
  - the adapter strips the `+` to produce `8801XXXXXXXXX` (13 digits) and rejects anything that does not match `^8801[3-9][0-9]{8}$` **before** any network call, with `INVALID_DESTINATION_FORMAT`;
  - **one recipient per request.** Multi-recipient `+` joins are not used, because per-recipient outcomes and mixed valid/invalid behavior are unverified.
- **Encoding:** `type=text` when every character is in the GSM-7 default alphabet or its extension table; otherwise `type=unicode`. Any Bangla character forces `unicode`.
- **Segment estimate** (documented rule, stored as `segments_estimated`, labelled an estimate until ZAMANIT-VER-07 confirms billing):
  - GSM-7: ≤ 160 septets → 1 segment, otherwise ⌈septets / 153⌉. Extension characters (`^{}\[~]|€`) count as 2.
  - Unicode (UCS-2): ≤ 70 UTF-16 code units → 1 segment, otherwise ⌈units / 67⌉.
- **Templates are designed to stay within one segment** where possible: an OTP fits in 1 segment in both English and Bangla, and CI asserts this for the rendered longest case.

### 4. Error mapping and retries

| Code / condition | Normalized class | Retry | Side effects |
|---|---|---|---|
| 1001 | `INVALID_CREDENTIAL` | No | credential → `INVALID`; critical alert (platform) or tenant notice |
| 1002 | `SENDER_ID_INVALID` | No | credential `sender_id_status=INVALID`; alert |
| 1003 | `INVALID_REQUEST` | No | bug alert |
| 1004 | `INVALID_REQUEST` | No | bug alert |
| 1005 | `DESTINATION_UNSUPPORTED` | No | fallback channel only if authorized by consent and preferences |
| 1006 | `INSUFFICIENT_BALANCE` | No | credential → `SUSPENDED_BALANCE`; queued SMS jobs for that credential rescheduled to the next balance check; `SmsBalanceLow` event; alert |
| 1007 | `INVALID_DESTINATION_FORMAT` | No | bug alert (the adapter should have rejected it first) |
| connect error / DNS failure before request bytes are written | `PROVIDER_UNAVAILABLE` | Yes, ADR-015 backoff (max 5) for transactional; OTP: no automatic retry (user resends) | — |
| timeout after the request was sent, HTTP 5xx, unparseable 2xx body | `UNKNOWN_OUTCOME` | see below | attempt `possible_duplicate=true` if retried |

**Duplicate safety:**
- **OTP:** never auto-retry after `UNKNOWN_OUTCOME` or `PROVIDER_UNAVAILABLE`.
  - The API still returns `202` with the generic hint "if the code does not arrive, request a new one".
  - A resend creates a **new** challenge and supersedes the old one, within the resend limits.
- **Transactional notifications** (serial called, appointment reminder, payment receipt):
  - at most **one** automatic retry after `UNKNOWN_OUTCOME`;
  - the retry attempt row carries `possible_duplicate=true`;
  - no further retries.
- **Bulk or campaign SMS:** out of MVP scope. There is no endpoint.

**Response parsing:** the success body format is UNVERIFIED (ZAMANIT-VER-02/03).
- **Until SMS-002 captures real fixtures**, the parser classifies:
  - any response containing one of the codes 1001–1007 as a code value → the mapped class;
  - HTTP 2xx without such a code → `ACCEPTED` with `providerMessageId` absent;
  - anything else → `UNKNOWN_OUTCOME`.
- **Enabling the adapter in production** requires the SMS-002 fixture-based parser (success marker and message-id extraction where present). This is part of `GATE-SMS-HTTP`'s checklist.

### 5. Content rules

- **Templates** are versioned files `packages/communication/src/templates/sms/<key>.<locale>.v<n>.txt` in `bn-BD` and `en-BD`.
- **Allowed placeholders only:** `{appName}`, `{otpCode}`, `{otpMinutes}`, `{serialNumber}`, `{localTime}`, `{localDate}`, `{clinicSmsName}`, `{shortLink}`.
  - A template lint rejects any other placeholder.
  - `{clinicSmsName}` is a tenant-configured display name (default the clinic name), so clinics whose name reveals a specialty can choose a neutral name.
- **Never included:** diagnosis, prescription, medication, lab, note, doctor specialty or any other clinical content, and no patient names.
- **Short links** are opaque (`https://app.<domain>/s/<22-char random token>`), map to an in-app route that requires login, and expire (`communication_short_links`).

### 6. Credentials

| Mode | Owner | Storage | Used for |
|---|---|---|---|
| `PLATFORM_ACCOUNT` (default) | Hakeemify | env `ZAMANIT_API_KEY`, `ZAMANIT_SENDER_ID` (hPanel) | all OTPs; tenant notifications unless the tenant has its own account |
| `TENANT_ACCOUNT` (optional) | a clinic or doctor tenant | `provider_credentials` row (`provider_kind=SMS`, `provider_code=zamanit`), envelope-encrypted with `PROVIDER_CREDENTIAL_KEK` (same pattern as ADR-017 §4; AAD = `credentialId\|tenantId\|providerKind\|providerCode`) | that tenant's transactional notifications |

- `provider_credentials` is a generalized table for non-AI provider secrets (SMS and payment). AI credentials stay in `ai_provider_credentials` (ADR-017), because they carry AI-specific policy columns. Both use the shared `SecretEnvelopePort` in the new `packages/secrets` package. The key encryption keys are separate: `AI_CREDENTIAL_KEK` and `PROVIDER_CREDENTIAL_KEK`.
- **What the API returns:** DTOs expose only `id`, `providerCode`, `status`, `secretLast4`, the non-secret `senderId`, `validatedAt` and `lastErrorClass`. **The key is never returned, logged, queued or exported.**
- **Validation** uses `checkbalance`, which sends nothing and costs nothing: a balance response → `ACTIVE`; 1001 → `INVALID`.
- **Sender ID status** stays `UNVERIFIED` until the first accepted send, because Zaman IT exposes no sender-ID check.

### 7. Balance monitoring

- **`CheckSmsBalance` job** (maintenance queue, every `ZAMANIT_BALANCE_CHECK_MINUTES` = 60, singleton):
  - calls `checkbalance` for the platform account and every `ACTIVE` or `SUSPENDED_BALANCE` tenant credential;
  - stores `sms_balance_snapshots`;
  - emits `SmsBalanceLow` below the threshold (platform: `ZAMANIT_BALANCE_ALERT_BDT`; tenant: the credential's `balance_alert_bdt`);
  - reactivates `SUSPENDED_BALANCE` credentials once the balance is above the threshold.
- **Dashboard:**
  - the platform operator sees `GET /platform/sms/balance`;
  - a tenant sees its own credential balance;
  - daily spend estimate = sum of negative balance deltas per Asia/Dhaka day, cross-checked with Σ `segments_estimated` × `ZAMANIT_PRICE_PER_SEGMENT_BDT` (optional business config). It is labelled an estimate.
- The balance response format is UNVERIFIED (ZAMANIT-VER-02). The parser accepts a documented set of shapes captured in SMS-002 and otherwise stores `parse_status=UNPARSED` and alerts.

### 8. Configuration

`ZAMANIT_BASE_URL`, `ZAMANIT_API_KEY`, `ZAMANIT_SENDER_ID`, `ZAMANIT_TIMEOUT_MS` (default 10000), `ZAMANIT_BALANCE_ALERT_BDT`, `ZAMANIT_LIVE_SMOKE` (default `false`), plus the gate and operational variables above (`ENVIRONMENT-CONTRACT.md` §6).

### 9. Testing

- **Mock adapter** (`communication-adapters/mock`, also served by `mock-providers`): success; each of 1001–1007; connect failure; timeout after send; HTTP 500; unparseable body; balance response; balance below threshold.
- **Contract tests** run the Zaman IT adapter against the mock server over HTTP. They check form encoding, POST only, no key in the URL or logs, phone conversion, encoding choice and segment estimates.
- **Live smoke** (SMS-008): **one** controlled message.
  - Runs only when `ZAMANIT_LIVE_SMOKE=true`, on a developer workstation or staging.
  - Destination is the developer-supplied `ZAMANIT_LIVE_SMOKE_TO`, and the text is fixed and non-clinical.
  - **Never in CI.** The CI workflow sets `ZAMANIT_LIVE_SMOKE=false`, and the test aborts when `CI=true`.

## Alternatives considered

| Alternative | Why not now |
|---|---|
| Keep mocks only | Real OTP login cannot go live |
| Use GET as in the provider sample | Key leakage into URLs and logs |
| Disable TLS verification (provider sample) | Forbidden; it gives a false sense of security with no benefit |
| Provider-generated OTP | Moves verification trust to a plaintext-HTTP provider; HMedic keeps the hashed OTP lifecycle |
| WhatsApp OTP | No provider selected; stays behind the same `OtpDeliveryPort` |

## Consequences

- Real OTP and SMS notifications can be implemented and tested entirely with mocks. Only one gated live message is ever sent in Stage 4.
- Production use over HTTP depends on an explicit, expiring owner decision (`GATE-SMS-HTTP`).
- A second SMS provider can be added behind `SmsProvider`, without domain changes, if Zaman IT cannot provide HTTPS.

---

# Source: ADR-019-aamarpay-payments-mvp.md

# ADR-019 — Payments enter MVP with aamarPay

**Status:** Accepted (2026-09-17, Stage 3.2)
**Supersedes:**
- the "Billing is Future" resolution (consistency audit S3-13; `DATABASE-SPEC.md`/`PRODUCT-ARCHITECTURE-SPEC.md` billing scope);
- the Stage 3.1 external decision "payment provider".

**Evidence:** `docs/implementation/AAMARPAY-VERIFICATION.md`. Build contract: `docs/implementation/PAYMENT-IMPLEMENTATION.md`. **No legal, financial or regulatory compliance claim is made.**

## Context

- **The product owner selected aamarPay.** Hakeemify already holds an aamarPay merchant account. aamarPay's documentation states it holds a Bangladesh Bank Payment Service Operator licence and PCI DSS compliance; that is their claim, not ours.
- **Documented integration model** (read 2026-09-17):
  - the server POSTs JSON to `jsonpost.php` with `store_id` and `signature_key`, and receives `payment_url`;
  - the payer is redirected to aamarPay;
  - the gateway POSTs results to `success_url` / `fail_url`;
  - the merchant should call **Search Transaction** in the success endpoint;
  - IPN is available for successful payments only, configured through aamarPay support.
- **Security-relevant facts** (verification doc):
  - Search Transaction is documented, and was observed in the sandbox, as **GET with `signature_key` in the query string**;
  - IPN is described as signed, but no signature scheme is documented;
  - refunds and settlement reports have no documented API;
  - aamarPay's Flutter package and Android library take the store ID and signature key **inside the mobile app**.
- **Scope:** patient payments for consultations and telemedicine, plus doctor/clinic subscription payments to Hakeemify. Insurance, claims and complex invoicing stay Future.
- **Regulatory risk:** collecting patient fees into Hakeemify's merchant account on behalf of doctors means Hakeemify holds money owed to third parties. In Bangladesh this may be regulated activity (payment aggregation or facilitation), with tax and accounting implications. It is not researched.

## Decision

### 1. Bounded context and packages

- **`packages/payments`** (new bounded context) owns:
  - merchant accounts, fee schedules, payment intents, attempts, gateway events, verifications;
  - ledger, payouts, refunds, subscriptions and invoices.
  
  It replaces the `billing` Future placeholder.
- **Adapter packages:**
  - `packages/payment-adapters/aamarpay` implements `PaymentGatewayPort`;
  - `packages/payment-adapters/mock` is the mock gateway.
- **`packages/provider-credentials`** owns `provider_credentials`. Its envelope encryption comes from `packages/secrets` (ADR-018 §6).

```ts
interface PaymentGatewayPort {
  readonly code: 'aamarpay' | 'mock';
  initiate(input: {
    merchant: MerchantCredentialHandle; environment: 'sandbox' | 'live';
    tranId: string; amount: MoneyString; currency: 'BDT'; desc: string;
    customer: { name: string; email: string; phone: string };
    successUrl: string; failUrl: string; cancelUrl: string; optA: string;
  }): Promise<{ outcome: 'CREATED'; paymentUrl: string } | { outcome: 'REJECTED'; errorClass: PaymentErrorClass; message?: string } | { outcome: 'UNKNOWN_OUTCOME' }>;
  searchTransaction(input: { merchant: MerchantCredentialHandle; environment: 'sandbox' | 'live'; tranId: string }):
    Promise<GatewayTransactionRecord | { outcome: 'NOT_FOUND' } | { outcome: 'CREDENTIAL_MISMATCH' } | { outcome: 'UNAVAILABLE' }>;
  validateCredential(input: { merchant: MerchantCredentialHandle; environment: 'sandbox' | 'live' }):
    Promise<'VALID' | 'INVALID' | 'INCONCLUSIVE'>;
}
```

### 2. Merchant modes

| Mode | aamarPay store owner | Used for | Production gate |
|---|---|---|---|
| `PLATFORM_MERCHANT` | Hakeemify (existing account; credentials in hPanel env `AAMARPAY_PLATFORM_*`) | **Platform subscriptions (always).** Patient fees only for tenants/doctors who opt in instead of having their own store. | Patient fees: **`GATE-PAY-PLATFORM-COLLECTION` (OPEN)**. Subscriptions: none beyond live credentials. |
| `DOCTOR_MERCHANT` | the doctor or clinic (their own aamarPay store) | patient fees paid directly to that doctor/clinic | none specific (the doctor/clinic is the merchant of record) |

- **Choosing a mode.** A tenant or doctor chooses the mode **per fee type** (`payment_merchant_accounts.fee_types_enabled`). The resolution order for a patient fee is:
  1. an active doctor-owned `DOCTOR_MERCHANT` account enabling that fee type;
  2. an active clinic-owned `DOCTOR_MERCHANT` account;
  3. the tenant's `PLATFORM_MERCHANT` opt-in row, only if patient collection is allowed (below);
  4. otherwise **no online payment**, and the chamber's policy falls back to pay-at-chamber.
- **Doctor-merchant credentials** (store ID, signature key) live in `provider_credentials` (`provider_kind=PAYMENT`), envelope-encrypted. Only `storeIdLast4` / `secretLast4` are displayed. They are never returned, logged or sent to clients. No doctor can read another doctor's credential, and nobody can read their own after submission.
- **Credential validation.** Call Search Transaction with a random, never-used `request_id` against the account's environment:
  - a JSON body with `status: "Invalid-Data"` → `VALID` (store and key matched, and no transaction exists);
  - the text "Store_id & signature key not matched" → `INVALID`;
  - anything else → `INCONCLUSIVE`, and the status becomes `UNVERIFIED_UNTIL_FIRST_PAYMENT`. The first real payment is then verified with Search Transaction, and a mismatch disables the account.
  
  This behavior was **observed in the sandbox only** (2026-09-17). Live behavior is UNVERIFIED (PAY-014).
- **Environment separation.** Each account's `environment` must equal `AAMARPAY_ENV`: staging is `sandbox` only, production is `live` only. The startup and use-case checks refuse any mismatch.
- **Platform collection of patient fees is gated.**
  - `PAYMENTS_PLATFORM_COLLECTION_ENABLED` defaults to `false`.
  - With `APP_ENV=production`, it can be `true` only when the platform audit record `PAYMENTS_PLATFORM_COLLECTION_GATE_CLOSED` exists. That record references a legal/financial review (payment aggregation/facilitation status, tax, accounting, payout obligations), is recorded by `pnpm ops:record-risk-decision --gate GATE-PAY-PLATFORM-COLLECTION`, and must not be expired.
  - Otherwise `PLATFORM_MERCHANT` rows for patient fee types cannot be activated (`POLICY_BLOCKED`, reason `PLATFORM_COLLECTION_GATE_OPEN`).
  - The design is complete regardless: a settlement ledger, **manual** payout records, and platform commission configuration (`platform_commission_bps`, default **0**, a business decision).
  - Local and staging may enable it with synthetic data.

### 3. Server-authoritative flow

1. **Client request.** The client calls `POST /payments/intents {purpose, businessReference, returnChannel}` with an `Idempotency-Key`. **No amount is accepted.** An `amount` field is rejected by schema (`VALIDATION_FAILED`), which makes client-amount tampering visible in tests.
2. **Server setup.** The server authorizes the payer, resolves the business reference (appointment, subscription invoice), **computes the amount from `fee_schedules`** (or the invoice), resolves the merchant account, and creates the intent (`CREATED`) with an opaque `tran_id`. It then calls `initiate` **from the server only**. The signature key never reaches web or mobile.
3. **Redirect.** The server stores `payment_url` as a hash, sets the intent to `REDIRECTED`, and returns `paymentUrl`.
   - Web navigates to it.
   - Mobile opens it in an external Custom Tab / SFSafariViewController, never a WebView that injects credentials. **aamarPay's Flutter package and Android library are not used**, because they require the store ID and signature key on the device.
4. **Return endpoints.** `success_url` / `fail_url` / `cancel_url` = `{API_PUBLIC_URL}/api/v1/payments/aamarpay/return/{intentId}/{success|fail|cancel}`. The endpoint:
   - treats the POSTed body as **untrusted**, stores it **redacted** in `payment_gateway_events`, and moves the intent to `PENDING_VERIFICATION` if it is not already terminal;
   - loads the intent by path id **and** checks that the body's `mer_txnid` equals the intent's `tran_id` (a mismatch → event flagged `SUSPECT_FORGERY`, intent untouched);
   - calls **Search Transaction** with the **intent's own merchant credentials** (never credentials derived from the request);
   - sets `PAID` **only if every one of these holds** in the Search Transaction result:
     - `status_code = "2"`;
     - `mer_txnid = intent.tran_id`;
     - `store_id` = the merchant account's store ID;
     - `amount` (decimal string parsed exactly) = `intent.amount`;
     - `currency = "BDT"`, and `currency_merchant = "BDT"` when present;
   - redirects the browser (`303`) to `PAYMENT_RETURN_BASE_URL/payments/result/{intentId}`. The URL carries the opaque intent id only, with no status. The result page reads the status from the API.
5. **IPN.** `POST /payments/aamarpay/ipn` follows the same verify-then-transition logic. It is idempotent and tolerates at-least-once and out-of-order delivery. The IPN's own signature is **not** relied on: its scheme is undocumented, and the IPN only triggers verification.
6. **Reconciliation.** `ReconcilePaymentIntents` (every 5 min) re-verifies intents in `REDIRECTED`/`PENDING_VERIFICATION` older than 2 min, using backoff per intent. It expires intents past `expires_at` whose Search Transaction shows no success.
7. **Commit on PAID.** In **one transaction**: the intent becomes `PAID`, `payment_verifications` is inserted, balanced `ledger_entries` are written, and the outbox event `PaymentSucceeded` is emitted.
   - Consumers update appointment or subscription state asynchronously (§5).
   - **A payment event never changes clinical data**. This is a dependency rule: `payments` may not import `clinical`/`prescriptions`, and payment handlers cannot resolve clinical write use cases.

### 4. Payment intent state machine

```text
CREATED ──initiate ok──> REDIRECTED ──callback/IPN/reconcile──> PENDING_VERIFICATION ──verified success──> PAID
   │                          │                                        ├── verified failure (status 7) ──> FAILED
   │ initiate rejected        │ cancel return + not successful         ├── cancel + not successful ─────> CANCELLED
   └──> FAILED                └──> CANCELLED                           └── expires_at passed + not successful ──> EXPIRED
PAID ──refund recorded──> REFUND_PENDING ──refund confirmed (manual)──> REFUNDED
FAILED | CANCELLED | EXPIRED ──verified success (late)──> PAID with late_payment=true, manual_review_status=OPEN
```

- **Verified success always wins**, because the money moved. A late success sets `late_payment=true`. Consumers do **not** auto-confirm a business reference whose hold was released; staff resolve the open review by honoring the booking or refunding.
- **Refunds are manual**, because aamarPay documents no refund API. Staff issue the refund in the aamarPay merchant panel or through support, then record it: `REFUND_PENDING` with an evidence reference, then `REFUNDED` on confirmation. If a refund API is later verified, an ADR amendment adds it behind the same states.
- **Row version:** every transition uses `row_version`. The verification lock order is `payment_intents` row → business reference row.

### 5. Business rules

- **Payment never blocks the manual clinical workflow.** A patient already in the queue can always be consulted, and payment status is informational for clinical screens.
- **Per-chamber policy flags:**
  - `chamber_payment_mode`: `PAY_AT_CHAMBER` (default) | `PREPAID_REQUIRED` | `OPTIONAL_ONLINE`;
  - `telemedicine_payment_mode`: `PREPAID_REQUIRED` (default) | `OPTIONAL_ONLINE` | `PAY_AT_CHAMBER` (the last is not meaningful for remote care and is disallowed by CHECK for `REMOTE` bookings).
- **Prepaid bookings:**
  - The appointment is created as `PENDING_PAYMENT` with `payment_hold_expires_at = now + PAYMENT_INTENT_TTL_MINUTES`. It reserves slot capacity, and **no serial is issued**.
  - `PaymentSucceeded` → the `ConfirmPaidAppointment` job sets the appointment to `BOOKED` and issues the serial through `IssueAppointmentSerial`.
  - `PaymentExpired`/`PaymentFailed`/`PaymentCancelled` → `ReleasePaymentHold` cancels the appointment with reason `PAYMENT_NOT_COMPLETED` and frees capacity.
  - **Staff override:** `POST /appointments/{id}/payment-override {reason}` (`appointment.write`) confirms the appointment without payment. It is audited and marks `payment_waived=true`.
- **`cus_email` is required by aamarPay.** The value used is, in order:
  1. the payer's verified email if they have one;
  2. otherwise the tenant's `payment_contact_email`;
  3. otherwise the platform `PAYMENT_PLATFORM_NOREPLY_EMAIL`.
  
  **Per-patient emails are never fabricated.** The consequence, that gateway receipts may go to the clinic or the no-reply address, is documented in the payment UI copy.
- **Minimal data to the gateway:**
  - `cus_name` = the **payer's** display name (the account user, not a dependent patient);
  - `cus_phone` = the payer's verified phone;
  - `desc` = `HMEDIC-<8-char intent short ref>`;
  - `opt_a` = intent id; `opt_b`–`opt_d` unused;
  - no clinic specialty, doctor name, service description or clinical information.
- **Money:**
  - `DECIMAL(12,2)` in the database;
  - decimal **strings** in APIs and events (`"500.00"`);
  - arithmetic in the kernel `Money` value object as integer paisa (`bigint`);
  - parsing accepts only `^\d{1,10}(\.\d{1,2})?$`;
  - **no floating-point money anywhere** (lint rule `hmedic/no-float-money` on `Money`-typed fields plus schema tests).

### 6. Ledger (double-entry-lite)

- `ledger_entries` is append-only and hash-chained per tenant. Every posting group (`posting_id`) must sum to zero, checked in the use case and in the chain verification job.
- **PAID on `DOCTOR_MERCHANT`:** memo postings only (the money went to the doctor's store). `GATEWAY_RECEIVED +amount` / `MERCHANT_DIRECT_REVENUE −amount`, plus fee postings from Search Transaction `processing_charge` if present.
- **PAID on `PLATFORM_MERCHANT`, patient fee:**
  - `GATEWAY_CLEARING +amount`;
  - `GATEWAY_FEE +fee` / `GATEWAY_CLEARING −fee`;
  - `PLATFORM_COMMISSION −commission`;
  - `DOCTOR_PAYABLE −(amount − fee − commission)` (fee bearer: `PAYMENT_GATEWAY_FEE_BEARER`, default `DOCTOR`, business decision).
- **Subscription:** `GATEWAY_CLEARING +amount` / `PLATFORM_SUBSCRIPTION_REVENUE −amount`, plus fee postings.
- **Refunds and payouts** post reversing or settling entries. **Payouts are manual**: a platform operator records a bank/MFS transfer reference. No automated disbursement exists.
- **Fee:** the gateway fee is `processing_charge` from Search Transaction. If absent, fee = `amount − rec_amount`. If neither is present, the posting is flagged `fee_unverified=true`.

### 7. Hosting

- **Callback and IPN URLs** are public HTTPS on `api.<domain>`. They are unauthenticated, rate-limited, and **not** cookie endpoints, so CSRF does not apply; they are protected by server-side verification.
- **Cross-site POSTs** from the gateway carry no session cookies, and none are needed.
- **The IPN URL is registered per store with aamarPay support.** Doctor stores must request it themselves, and reconciliation covers stores without an IPN.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Trust the success POST body | Forgeable; aamarPay recommends Search Transaction |
| aamarPay Flutter/Android SDK | Puts the signature key in the app |
| Client-supplied amount | Tampering |
| Platform collects all patient fees | Unresearched regulated activity; gated instead |
| Wait for a refund API | Refunds are needed from day one; recorded manually |

## Consequences

- Payments are fully implementable and testable with the mock gateway and aamarPay sandbox fixtures.
- The signature key in the Search Transaction query string is a provider-side limitation. It is never logged on our side, and PAY-014 asks aamarPay for a POST alternative.
- Doctor-merchant mode works without any legal gate. Platform-collected patient fees stay disabled in production until `GATE-PAY-PLATFORM-COLLECTION` closes.

---

# Source: ADR-020-medicine-dataset-import.md

# ADR-020 — Medicine dataset import (Stage M dataset → medication catalog)

**Status:** Accepted (2026-09-17, Stage 3.2)
**Resolves:** the Stage 3.1 external decision "Verified Bangladesh medicine dataset" as far as the **import mechanism** goes. The data itself stays `UNVERIFIED`.
**Inputs:** `tools/medicine-data/dist/latest.json` → `medicine-dataset-20260917-4`, and its `DATASET-CARD.md`, `checksums.sha256` and `schema/*.schema.json`.
**No compliance claim** is made. The catalog is **not clinical guidance**.

## Context

**What Stage M produced** (version `medicine-dataset-20260917-4`, status `UNVERIFIED`, built 2026-09-17):

| File | Records |
|---|---:|
| medications | 50,946 |
| generics | 1,852 |
| manufacturers | 401 |
| aliases | 1,389 (all `alias_origin: source`) |
| prices_observed | 58 |
| provenance | 62,494 |
| conflicts | 2,809 |
| review_queue | 5,764 |

- **Sources:** DGDA, the Mendeley CC BY 4.0 dataset and LazzPharma are `UNCLEAR` (legal review required). Six sources are `PROHIBITED` and contributed nothing.
- **DGDA match:** 78.3% of products are `MATCHED`.
- **Dataset card production gates** (all outstanding):
  1. legal/terms review for every `UNCLEAR` source;
  2. clinician/pharmacist sample review with sample size and error rate;
  3. DGDA cross-reference completed where public data allows;
  4. import safeguards (catalog-source indicator, free-text fallback, no dosing text).
- **Records:**
  - A medication record has a stable `id` = `med_` + the first 16 hex characters of SHA-256(`record_key`).
  - `record_key` = `brand | sorted generic set | strength | dosage form | manufacturer [#route]`, all normalized.
  - Fields carry per-field provenance `{value, sources, agreement_count, alternatives}`.
- **Known limitations** stated by the card:
  - veterinary products are included and should be excluded at import;
  - `unmapped` dosage forms exist;
  - Bangla brand names, pack size and therapeutic class are empty in this build;
  - observed prices are retail observations, not MRP, unless `is_official_mrp` is true.

## Decision

### 1. Import contract

- **The Stage M JSON Schemas are the import contract**, adopted without redefining fields. The importer validates every line against the schema files **shipped in the dataset directory**, and checks each schema file's SHA-256 against `checksums.sha256`.
- **Pinned schema set.** The importer pins accepted schema sets by the SHA-256 of `schema/medications.schema.json` et al. For this version they are listed in `docs/implementation/PRESCRIPTION-IMPLEMENTATION.md` §5.2. A dataset with a new schema hash is refused (`MEDDATA_SCHEMA_UNSUPPORTED`) until an importer update and an ADR-020 amendment accept it.
- **Field mapping** (no renaming inside the dataset; mapping happens only at the database boundary):

| Dataset field | Catalog column |
|---|---|
| `record_key` | `medications.canonical_key` (upsert key) |
| `id` | `medications.dataset_record_id` |
| `brand_name.value` / `brand_name_bn.value` | `brand_name` / `brand_name_bn` |
| `generic_names.value[]` | `medication_generic_links` → `medication_generics` (matched by generic `key`) |
| `strength.value` / `strength_parsed` | `strength_text` / `strength_parsed` JSON |
| `dosage_form.value` / `dosage_form_raw` | `dosage_form` / `dosage_form_raw` JSON |
| `route.value` | `route` |
| `manufacturer.value` | `manufacturer_id` → `medication_manufacturers` (matched by the manufacturers file `key`) |
| `registration_number.value` + `.alternatives` | `registration_number` + `registration_alternatives` JSON |
| `dgda_match` | `dgda_match` |
| `status` | `review_status` (`UNVERIFIED` for this version) |
| `monograph_urls[0]` | `monograph_source_url` (link only; content never imported) |
| `source_ids`, per-field `sources`/`agreement_count` | `source_ids` JSON, `field_provenance` JSON (bounded) |
| aliases file | `medication_aliases` (`alias_origin` kept; `target_type=generic` → generic aliases) |
| prices_observed file | `medication_price_observations` |
| provenance / conflicts / review_queue | **not imported** into the application DB; counts are recorded in `medication_dataset_imports.counts` |

### 2. Import rules

- **Integrity first.** Verify every file listed in `checksums.sha256` before any write. `latest.json` is informational; the importer requires an explicit version.
- **Upsert by `canonical_key`**, in batches of `MEDICATION_IMPORT_BATCH_SIZE` (500) within short transactions:
  - update attributes and `dataset_version`;
  - rows absent from the new version → `active=0`, `deactivated_in_version`;
  - **rows referenced by `prescription_items` or `patient_medications` are never deleted.** Nothing in the catalog is ever hard-deleted.
- **Idempotent per version.** `medication_dataset_imports` has a unique `dataset_version` for `SUCCEEDED`. Re-running the same version is a no-op report. A failed run resumes from its checkpoint (last processed line per file).
- **Veterinary exclusion** (default `MEDICATION_IMPORT_EXCLUDE_VETERINARY=true`), per the dataset card:
  - dosage forms `bolus_veterinary`, `water_soluble_powder_veterinary`, `pour_on_veterinary`;
  - products whose `manufacturer.value` or any `manufacturer.alternatives[].value` contains `(Veterinary)`.

  Excluded rows are counted in the report, not imported. For `medicine-dataset-20260917-4` this is 732 products (669 with a veterinary form, 117 with a veterinary manufacturer, overlapping; counted on 2026-09-17), leaving 50,214 importable products. `unmapped` dosage forms (552) are imported with `dosage_form='unmapped'` and a "form not mapped" badge.
- **Price check (this version):** all 58 observed prices pass the 2-decimal rule, and none is `is_official_mrp`.
- **Price conversion.** The dataset carries JSON numbers. They are converted to `DECIMAL(12,2)` by validating the number's shortest round-trip decimal string against `^\d{1,10}(\.\d{1,2})?$`. Rows failing this are skipped with `PRICE_PRECISION_REJECTED` in the report, so no float is ever stored. `is_official_mrp=false` rows are stored with `price_label` as given and **never displayed as MRP**.
- **Environment gate.**
  - `review_status=UNVERIFIED` datasets import freely in `development`, `test` and `staging`.
  - In `production` the import is refused (`POLICY_BLOCKED`, reason `MEDDATA_PRODUCTION_GATES_OPEN`) unless **both** hold:
    - `MEDICATION_IMPORT_PRODUCTION_ALLOWED=true`;
    - `medication_dataset_gate_attestations` contains all four dataset-card gates (`LEGAL_SOURCE_REVIEW`, `CLINICAL_SAMPLE_REVIEW`, `DGDA_CROSS_REFERENCE`, `IMPORT_SAFEGUARDS_VERIFIED`) for that version, each with an evidence reference, recorded by a platform operator (audited).
  - `GATE-MEDDATA-PROD` is OPEN for `medicine-dataset-20260917-4`.
- **Synthetic seed remains synthetic.** `pnpm db:seed` inserts a handful of clearly synthetic catalog rows (`DEMO-` brands, `canonical_key` prefixed `synthetic:`). The real dataset is a separate, opt-in step in dev: `pnpm meddata:import --dir tools/medicine-data/dist/<version>`.

### 3. Execution paths

| Environment | How |
|---|---|
| local / dev | CLI `pnpm meddata:import --dir <dataset dir> [--dry-run]` in `packages/prescriptions/src/infrastructure/medication-import/cli.ts`. It runs the importer in-process against `DATABASE_URL`. The dataset is read as **data files**; `tools/` code is never imported. |
| staging / production | 1. The operator stages files under the storage prefix `platform/medicine-datasets/<version>/`: `pnpm meddata:stage --dir … --env staging` for the S3 adapter, or SFTP into `<STORAGE_DISK_ROOT>/platform/medicine-datasets/<version>/` for the disk adapter (write access verified by MEDDATA-003 / HOST-007). 2. A platform operator calls `POST /admin/medications/imports {datasetVersion}`. 3. The worker job `ImportMedicationDataset` streams the JSONL through `ObjectStoragePort` line by line, bounded by memory (ADR-013 budget). |

### 4. Search and prescribing

- **Search** (`GET /medications/search?q=&limit=`) matches:
  - brand-name prefix (normalized), generic name/key prefix, Bangla brand/alias prefix, Banglish/brand-variant aliases;
  - ranking: exact brand > brand prefix > source alias > generic > **generated alias (lowest)**;
  - a tenant "frequently prescribed" boost from `medication_usage_stats`, updated by a `PrescriptionApproved` consumer;
  - inactive rows excluded;
  - veterinary rows never present.
- **Results show:**
  - brand, generics, strength, form, manufacturer;
  - a **catalog source indicator** (dataset version, `review_status` badge "Unverified catalog", DGDA match badge);
  - optionally, an "observed price, may differ" label with source and date.
- **Prescribing:**
  - selection stores `medication_id` + `medication_dataset_version` and snapshots strength/form text into the item;
  - the free-text fallback stays and is visibly marked;
  - **no dose, frequency or duration is ever suggested from catalog or scraped data**;
  - monograph URLs are not shown as guidance.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Upsert by dataset `id` | Equivalent (id = hash of `record_key`), but `canonical_key` is human-auditable and the id is derived; both are stored |
| Import provenance/conflicts into the app DB | 23 MB of source linkage that is not needed at runtime; kept with the dataset artifact |
| Allow production import with a warning | Contradicts the dataset card gates |
| Delete removed products | Breaks prescription history |

## Consequences

- Dev and staging get a realistic 50k-product catalog, with provenance and badges.
- Production keeps an empty catalog until all four gates are attested (the seed never runs in production). Free-text prescribing works throughout.
- A new Stage M version with the same schema hash imports without code changes.

---

# Source: AI-SPEC.md

# AI Assistance Specification

## 1. Safety boundary

AI is assistive software, never the clinical authority. It MUST NOT silently diagnose, prescribe, modify a patient record, finalize a prescription, or overwrite doctor documentation.

The required flow is:

```text
RAW INPUT -> AI PROCESSING -> AI DRAFT -> REVIEW REQUIRED
-> DOCTOR EDITED -> DOCTOR APPROVED -> FINAL CLINICAL RECORD
```

## 2. Provider abstraction

Define an `AIProvider` interface with operations such as:

- `transcribe(audio_reference, language_hints)`;
- `draft_note(transcript_or_selected_notes, patient_context_reference)`;
- `extract_clinical_items(note_reference)`;
- `retrieve_history(patient_id, query)`;
- `summarize_timeline(patient_id, date_range)`;
- `suggest_follow_up(encounter_reference)`.

The domain stores provider, model, version, request ID, timestamps, schema version, and status. No business module imports a specific vendor SDK directly.

## 3. MVP AI scope

### MVP

- Doctor-triggered patient history retrieval with source timeline references.
- Draft clinical note from doctor-selected structured inputs and free-text notes.
- Optional asynchronous audio upload for transcription only if a reviewed provider is available.
- Structured draft sections: complaint, history, observed symptoms, assessment candidates, plan candidates, and missing-information prompts.
- Doctor review screen with accept/edit/reject per suggestion.

### V1/V2

- Bangla, English, and mixed Banglish transcription evaluation.
- Clinical extraction into candidate symptoms/diagnoses/medications.
- Draft prescription items that require explicit item-by-item approval.
- Lab report assistance that never replaces the raw report.
- Similar prior encounters with source links.

### Future/research

- Real-time transcription, automated coding, medication safety recommendations, continuous ambient capture, and advanced decision support. These require clinical validation, provider review, and legal/regulatory research.

## 4. Data and provenance

Every `AIJob`, `AITranscript`, `AIDraft`, `AISuggestion`, and `AIApproval` MUST record:

- tenant, actor, patient/encounter reference;
- provider/model/version and schema version;
- input references, selected history range, and timestamp;
- raw output stored in protected redacted storage;
- structured validated output;
- confidence/uncertainty where provider supports it;
- review status and reviewer;
- edits, decision, approval timestamp, final artifact reference;
- correlation ID and audit event.

No AI output becomes a diagnosis or prescription merely because it passes schema validation.

## 5. Human review UX contract

- Display “AI draft” and “Review required” prominently.
- Show source references for every extracted item.
- Permit accept, edit, reject, and ignore-later actions.
- Require doctor attestation before final clinical save.
- Make AI-generated text visually distinguishable until approved.
- Do not allow a bulk “approve all” for diagnosis or prescription without item-level confirmation in MVP.
- Preserve the final doctor-authored version separately from the AI draft.

## 6. Voice pipeline

```text
Audio capture -> resumable upload -> malware/format check -> transcription job
-> transcript -> clinical extraction job -> draft -> doctor review -> approval
```

- MVP may be asynchronous; real-time transcription is not required.
- Support language hints `bn`, `en`, and `mixed` without assuming quality.
- Store audio as a protected object with retention policy and explicit recording/consent state.
- Segment uploads and retry failed parts; never put audio bytes in PostgreSQL.
- Chamber noise, code-switching, accents, and medical terms require evaluation datasets that contain no real patient data unless separately approved.
- A failed AI job leaves the ordinary manual workflow available.

## 7. Retrieval design

Patient-history retrieval uses a tenant/patient authorization check before retrieval. The first implementation can query `timeline_events`, encounters, prescriptions, diagnoses, lab reports, and follow-ups with date/type filters. Retrieval results MUST include source IDs and occurred-at dates. A vector index MAY be added later, but it cannot bypass relational authorization or source citations.

## 8. Failure and safety

- Provider timeout, quota, unsafe content, schema failure, low confidence, or missing consent produces a visible failed/needs-review state.
- AI jobs are retryable with idempotency keys and bounded attempts.
- Prompt injection in uploaded documents is treated as untrusted content.
- The UI MUST allow the doctor to discard AI output and complete the consultation manually.
- Safety incidents and incorrect approved suggestions are auditable and reportable.

## Change log

### 2026-09-17 — Stage 3.1

- The single platform `AIProvider` is replaced by per-doctor credentials across providers (Gemini API, OpenAI-compatible endpoints, mock), with billing modes `DOCTOR_BYOK_FREE`, `DOCTOR_BYOK_PAID` and a disabled `PLATFORM_MANAGED` (ADR-017).
- The approval architecture (ADR-008) is unchanged: AI output stays a draft or suggestion, and only doctor approval inside the clinical context writes records.
- Transcription remains disabled for MVP. The rule about audio bytes now reads "never put audio bytes in the database" (MariaDB, ADR-014); raw media is never sent to providers that may train on inputs.
- Provider terms for clinical use (notably Gemini API) are recorded as OPEN production gates in `docs/implementation/AI-PROVIDER-REGISTER.md` (audit C-02).

---

# Source: API-SPEC.md

# REST API Specification

## 1. API conventions

Base path: `/api/v1`. JSON request/response bodies use ISO-8601 timestamps and opaque UUIDs. All tenant-owned endpoints resolve the tenant from the authenticated membership and require an explicit tenant context in the path or selected header. The service MUST verify that the actor belongs to that tenant.

Standard response envelope:

```json
{
  "data": {},
  "meta": {"requestId": "uuid"},
  "errors": []
}
```

Errors use stable codes, human-safe messages, field details, and `requestId`; they never include PHI or provider secrets. List endpoints support `limit` (bounded), opaque `cursor`, `sort`, and domain filters. Mutating POST endpoints that can be retried require `Idempotency-Key`.

## 2. Authentication and authorization

- `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/password/reset/request`, `POST /auth/password/reset/complete`.
- `POST /auth/session/refresh`, `DELETE /auth/session`.
- API access token is short-lived; refresh token rotation and device/session revocation are server-side.
- Every endpoint lists required permission in route metadata and checks it in the service layer.

Roles are capabilities, not hard-coded UI assumptions: `tenant_owner`, `clinic_admin`, `doctor`, `nurse`, `receptionist`, `patient`, and optional `billing_manager`. A doctor may access assigned patient/encounter records; staff access is scoped by explicit tenant/clinic/chamber permissions; patients access only their own records and shared documents.

## 3. Identity and patient endpoints

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/tenants` | platform/admin | Create tenant. |
| `GET` | `/patients?query=&phone=&mrn=` | patient.read | Search tenant patients with minimum necessary fields. |
| `POST` | `/patients` | patient.write | Create patient after duplicate check. |
| `GET` | `/patients/{patientId}` | patient.read | Patient profile and access summary. |
| `PATCH` | `/patients/{patientId}` | patient.write | Update demographics/contacts; sensitive fields audit. |
| `POST` | `/patients/{patientId}/merge-cases` | patient.merge | Request duplicate merge; never automatic final merge. |
| `GET` | `/patients/{patientId}/timeline` | timeline.read | Cursor-paginated timeline. |
| `GET` | `/patients/{patientId}/access-log` | audit.read | Authorized access history. |

Example patient creation:

```json
{
  "firstName": "Example",
  "lastName": "Patient",
  "dateOfBirth": "1990-01-15",
  "phone": "+8801XXXXXXXXX",
  "alternateContacts": [],
  "locale": "bn-BD",
  "consents": [{"purpose": "care", "channel": "in_app"}]
}
```

The example contains no real patient data. Phone normalization and duplicate scoring are server-side.

## 4. Scheduling and serial endpoints

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/chambers` | chamber.manage | Create chamber. |
| `POST` | `/chambers/{id}/schedule-rules` | schedule.manage | Create recurring/exception schedule. |
| `POST` | `/chamber-days` | schedule.manage | Materialize a chamber day. |
| `GET` | `/chamber-days/{id}/availability` | appointment.read | View slots/capacity. |
| `POST` | `/appointments` | appointment.write | Book advance appointment. Idempotent. |
| `POST` | `/chamber-days/{id}/walk-ins` | serial.write | Register walk-in and issue serial. Idempotent. |
| `POST` | `/serials/{id}/check-in` | serial.manage | Check in physical/remote patient. |
| `POST` | `/serials/{id}/call` | queue.call | Call patient. |
| `POST` | `/serials/{id}/skip` | queue.manage | Skip with reason and recall policy. |
| `POST` | `/serials/{id}/recall` | queue.manage | Recall skipped patient. |
| `POST` | `/serials/{id}/cancel` | serial.manage | Cancel serial. |
| `POST` | `/chamber-days/{id}/reorder` | queue.manage | Audited queue reorder. |
| `GET` | `/chamber-days/{id}/queue` | queue.read | Patient-minimized queue view or staff view based on permission. |

Serial issue request:

```json
{
  "patientId": "uuid",
  "appointmentId": "uuid",
  "careMode": "remote",
  "source": "advance_booking"
}
```

Queue transition request:

```json
{
  "reason": "patient confirmed readiness",
  "expectedVersion": 12
}
```

The server rejects invalid transitions and stale `expectedVersion` values.

## 5. Encounter and clinical endpoints

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/serials/{id}/encounter` | encounter.start | Start encounter exactly once. |
| `GET` | `/encounters/{id}` | encounter.read | Encounter and participants. |
| `POST` | `/encounters/{id}/participants` | encounter.manage | Add authorized staff/interpreter. |
| `PATCH` | `/encounters/{id}/notes` | note.write | Save versioned structured draft. |
| `POST` | `/encounters/{id}/symptoms` | clinical.write | Add symptom observation. |
| `POST` | `/encounters/{id}/diagnoses` | diagnosis.write | Add doctor-authored diagnosis. |
| `POST` | `/encounters/{id}/complete` | encounter.complete | Complete encounter and publish timeline events. |
| `POST` | `/encounters/{id}/interrupt` | encounter.manage | Record interruption/reconnect reason. |

No endpoint accepts an AI output as a final clinical write. AI approval endpoints are separate and permissioned.

## 6. Prescription, labs, documents, follow-up

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/encounters/{id}/prescriptions` | prescription.write | Create draft prescription. |
| `PATCH` | `/prescriptions/{id}` | prescription.write | Edit draft/version. |
| `POST` | `/prescriptions/{id}/approve` | prescription.approve | Doctor approves and finalizes immutable version. |
| `POST` | `/prescriptions/{id}/render` | prescription.read | Enqueue PDF generation. |
| `GET` | `/prescriptions/{id}` | prescription.read | View permitted prescription. |
| `POST` | `/patients/{id}/lab-reports/upload-session` | document.write | Create authorized multipart upload. |
| `POST` | `/lab-reports` | lab.write | Register uploaded report and metadata. |
| `POST` | `/lab-reports/{id}/results` | lab.write | Add reviewed structured result. |
| `GET` | `/documents/{id}/download-url` | document.read | Issue short-lived signed URL after authorization. |
| `POST` | `/encounters/{id}/follow-ups` | followup.write | Create plan and optional appointment. |
| `PATCH` | `/follow-ups/{id}` | followup.write | Update status/due date with audit. |

Prescription approval example:

```json
{
  "version": 2,
  "attestation": "I reviewed and approve this prescription",
  "sendChannels": ["patient_portal", "email"]
}
```

## 7. Communication and telemedicine endpoints

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/communications` | communication.send | Create consent-checked message intent. |
| `GET` | `/communications/{id}` | communication.read | Delivery status and redacted attempts. |
| `POST` | `/encounters/{id}/telemedicine/session` | telemedicine.start | Create provider-neutral session. |
| `POST` | `/telemedicine/sessions/{id}/join-token` | telemedicine.join | Issue short-lived participant token. |
| `POST` | `/telemedicine/sessions/{id}/end` | telemedicine.manage | End session and record reason. |
| `POST` | `/communications/{id}/retry` | communication.retry | Retry permitted failed attempt. |

Provider IDs and raw payloads are never returned to patients unless required for support.

## 8. AI endpoints

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/encounters/{id}/ai/note-draft` | ai.use | Enqueue draft from selected sources. |
| `POST` | `/encounters/{id}/ai/transcription` | ai.use | Enqueue uploaded audio transcription. |
| `GET` | `/ai/jobs/{id}` | ai.read | Job status and safe output reference. |
| `POST` | `/ai/drafts/{id}/review` | doctor.review_ai | Accept/edit/reject suggestions. |
| `POST` | `/ai/suggestions/{id}/approve` | doctor.approve_ai | Convert one suggestion into a clinician-authored record. |

Review request:

```json
{
  "decision": "edited",
  "editedText": "doctor-authored text",
  "approvedTarget": "encounter_note"
}
```

The API rejects approval by a patient, unassigned staff member, or non-clinician role.

## 9. Pagination, validation, and audit

- Validate all identifiers, enum values, dates, lengths, MIME types, and tenant ownership.
- Use cursor pagination for timeline, messages, audit, queue events, and delivery attempts.
- Use optimistic version fields for queue, encounter notes, prescriptions, and patient merges.
- Audit all clinical writes, approvals, access to PHI, permission changes, document access, communication actions, and export actions.
- API tests MUST include invalid transition, cross-tenant ID, unauthorized role, replayed idempotency key, and stale version cases.

## Change log

### 2026-09-17 — Stage 3.1

- The lab-report upload-session route and `GET /documents/{id}/download-url` are replaced by `/documents/upload-sessions*` and `POST /documents/{id}/download-token` + token-streamed download (ADR-016, audit C-12).
- The doctor-prefixed AI review/approve permissions are replaced by the canonical `ai.review` and `ai.approve` plus the encounter-assignment rule (audit S3-03, C-14).
- New routes for per-doctor AI credentials, tenant AI policy, acknowledgements and usage (ADR-017); patient contexts via `X-Patient-Context` (audit C-15); internal job runner and diagnostics (ADR-015, ADR-013).
- Live queue updates use ETag polling (ADR-013, audit C-09). Route, permission and error-code contract: `docs/implementation/API-IMPLEMENTATION.md`.

### 2026-09-17 — Stage 3.2

- New routes: payment intents, aamarPay return and IPN callbacks (unauthenticated, verification-protected), fee schedules, merchant accounts, refunds, subscriptions, tenant SMS credentials, platform SMS balance, payouts, medication dataset imports and gate attestations; `GET /medications/search` replaces the catalog query route (ADR-018/019/020). Contract: `docs/implementation/API-IMPLEMENTATION.md` §3.7, §3.9, §3.11, §3.12 and `PAYMENT-IMPLEMENTATION.md` §9.
- Permissions added: `payment.create`, `payment.read`, `payment.merchant.manage`, `fee.manage`, `refund.manage`, `sms.credentials.manage`; platform-only `medication.import`, `payout.manage`, `platform.refund.manage`, `ops.sms.read`. `platform_operator` is an explicit, minimal, audited role outside tenant roles.

---

# Source: ARCHITECTURE-DECISIONS.md

# Architecture Decision Records

## Index

| ADR | Title | Status |
|---|---|---|
| ADR-001 | New codebase instead of fork | Accepted |
| ADR-002 | Modular monolith first | Accepted |
| ADR-003 | PostgreSQL relational source of truth | **Superseded by ADR-014** (relational source of truth retained; engine changed) |
| ADR-004 | Tenant and membership isolation | Accepted (RLS option withdrawn, see ADR-014) |
| ADR-005 | First-class serial engine | Accepted |
| ADR-006 | Patient timeline as a projection | Accepted |
| ADR-007 | Communication provider abstraction | Accepted; first SMS adapter **selected by ADR-018** |
| ADR-008 | AI approval architecture | Accepted; provider model **extended by ADR-017** |
| ADR-009 | Object storage for files | **Partially superseded by ADR-016** |
| ADR-010 | Asynchronous worker architecture | Accepted; queue technology **decided by ADR-015** |
| ADR-011 | Shared Flutter mobile architecture | Accepted |
| ADR-012 | Video provider abstraction and no recording default | Accepted |
| [ADR-013](ADR-013-hostinger-hosting.md) | Hostinger Cloud Startup hosting target | Accepted (2026-09-17) |
| [ADR-014](ADR-014-mysql-engine.md) | MariaDB (MySQL-family) database engine | Accepted (2026-09-17) |
| [ADR-015](ADR-015-database-job-queue.md) | Database-backed job queue | Accepted (2026-09-17) |
| [ADR-016](ADR-016-object-storage-and-scanning.md) | Object storage port and scanning | Accepted (2026-09-17) |
| [ADR-017](ADR-017-per-doctor-multi-provider-ai.md) | Per-doctor multi-provider AI | Accepted (2026-09-17) |
| [ADR-018](ADR-018-zamanit-sms-otp.md) | Zaman IT as first SMS/OTP delivery adapter | Accepted (2026-09-17, Stage 3.2) |
| [ADR-019](ADR-019-aamarpay-payments-mvp.md) | Payments enter MVP with aamarPay | Accepted (2026-09-17, Stage 3.2); supersedes billing-Future (audit S3-13) |
| [ADR-020](ADR-020-medicine-dataset-import.md) | Medicine dataset import | Accepted (2026-09-17, Stage 3.2) |

ADR-013…ADR-020 are separate files. The original text of ADR-001…ADR-012 below is unchanged; Stage 3.1 supersession notes are appended as quoted blocks.

## ADR-001 - New codebase instead of fork

**Context:** The teardown found useful patterns across five repositories, but also unknown licensing, GPL obligations, obsolete dependencies, incomplete workflows, and security risks.  
**Decision:** Build a completely new codebase and use repositories as reference-only.  
**Alternatives:** Fork Medigo, OpenEMR, HCW@Home, TPT Doctor, or DocPilot; rejected because product fit, licensing, and security are not established.  
**Reasoning:** Preserves Bangladesh-specific domain ownership and avoids accidental source/license inheritance.  
**Consequences:** More initial design work; clear provenance and smaller product scope.  
**Open Questions:** Legal review of any future dependency or separately approved code reuse.

## ADR-002 - Modular monolith first

**Context:** The workflow requires atomic serial, encounter, prescription, timeline, and follow-up transactions.  
**Decision:** Start with bounded modules in one API and database, plus workers.  
**Alternatives:** Microservices from day one; rejected as premature operational complexity.  
**Reasoning:** Preserves transaction consistency while leaving provider/worker boundaries explicit.  
**Consequences:** Strong module discipline and repository boundaries are required.  
**Open Questions:** Split high-volume AI/communication modules only after measured load.

## ADR-003 - PostgreSQL relational source of truth

**Context:** Teardown showed TPT/OpenEMR strengths in explicit clinical relationships and Medigo weaknesses in client-side document/free-text persistence.  
**Decision:** Use PostgreSQL for structured tenant-scoped records; object storage for binaries.  
**Alternatives:** Firestore-only; rejected for core clinical integrity/audit/query requirements.  
**Reasoning:** Supports constraints, transactions, reporting, timeline queries, and tenant checks.  
**Consequences:** Migrations and query design are required; offline sync is an explicit client concern.  
**Open Questions:** RLS as defense-in-depth after repository tests.

> Stage 3.1 supersession (2026-09-17): **superseded by ADR-014.** A relational source of truth is retained, but the engine is MariaDB (the database Hostinger Cloud provides). The RLS open question is closed as not applicable.

## ADR-004 - Tenant and membership isolation

**Context:** TPT provides a useful tenant boundary; frontend-only filtering is unsafe.  
**Decision:** Every tenant-owned table and repository query is tenant-scoped; roles are capability-based.  
**Alternatives:** Global user-only authorization; rejected.  
**Reasoning:** Supports SaaS clinics and prevents cross-tenant PHI access.  
**Consequences:** Tenant context must flow through every service, job, export, and provider callback.  
**Open Questions:** Cross-tenant practitioner access requires separate policy/research.

> Stage 3.1 note (2026-09-17): the RLS defense-in-depth option is not available on MariaDB. Composite tenant foreign keys and tenant-isolation tests are mandatory instead (ADR-014).

## ADR-005 - First-class serial engine

**Context:** No reference provided a Bangladesh chamber serial model.  
**Decision:** `Serial`, `ChamberDay`, `QueueEvent`, and `CheckIn` are separate from Appointment and Encounter.  
**Alternatives:** Treat appointment as queue position; rejected because walk-ins, recalls, shared physical/remote queues, and audit need independent state.  
**Reasoning:** Makes chamber operations explicit and testable.  
**Consequences:** More tables and state-transition tests; supports the core differentiator.  
**Open Questions:** Exact chamber policy defaults and queue fairness rules require field validation.

## ADR-006 - Patient timeline as a projection

**Context:** The product needs fast longitudinal history without a giant medical-record table.  
**Decision:** Generate immutable `TimelineEvent` projections from committed domain events, retaining source references.  
**Alternatives:** Assemble arbitrary tables only in the UI; rejected for retrieval consistency and AI access.  
**Reasoning:** Gives one authorized history read model without duplicating clinical truth.  
**Consequences:** Projection idempotency/rebuild tooling is required.  
**Open Questions:** Event retention and redaction policy require legal review.

## ADR-007 - Communication provider abstraction

**Context:** Teardown only verified integration hooks, not finished WhatsApp/SMS behavior.  
**Decision:** Normalize message intent, attempts, receipts, retries, consent, and provider IDs behind adapters.  
**Alternatives:** Couple business logic to one provider; rejected due to availability, cost, and policy uncertainty.  
**Reasoning:** Supports fallback and provider replacement without changing clinical modules.  
**Consequences:** Adapter contracts and webhook verification must be maintained.  
**Open Questions:** Bangladesh provider/template/Business verification.

> Stage 3.2 note (2026-09-17): the abstraction stands; Zaman IT is the first real SMS adapter and the OTP transport (ADR-018). Payments use a separate `PaymentGatewayPort` with aamarPay (ADR-019).

## ADR-008 - AI approval architecture

**Context:** No reference verified safe AI clinical writing.  
**Decision:** AI creates drafts/suggestions only; doctor review and explicit approval create final records.  
**Alternatives:** Auto-write diagnosis/prescription; rejected as unsafe and contrary to product requirement.  
**Reasoning:** Preserves clinician control and provenance.  
**Consequences:** Review UX, versioning, audit, and provider abstraction are mandatory.  
**Open Questions:** Provider, model quality, Bangla/Banglish evaluation, clinical validation.

> Stage 3.1 note (2026-09-17): the approval architecture stands. The provider open question is answered by ADR-017 (per-doctor credentials, multiple providers, encoded data-use policy, production gates).

## ADR-009 - Object storage for files

**Context:** Lab reports, PDFs, images, and audio are large and require access policy/versioning.  
**Decision:** Store binaries in private object storage; store metadata/checksum/version in PostgreSQL.  
**Alternatives:** PostgreSQL blobs or public URLs; rejected for scale and access control.  
**Reasoning:** Enables signed access, scanning, resumable upload, and retention jobs.  
**Consequences:** Storage lifecycle and authorization must be tested.  
**Open Questions:** Provider and region/data-residency research.

> Stage 3.1 supersession (2026-09-17): **partially superseded by ADR-016.** Private storage with DB metadata stands; object storage becomes a port with S3-compatible and private-disk adapters, metadata lives in MariaDB, and signed URLs become API-streamed HMAC download tokens.

## ADR-010 - Asynchronous worker architecture

**Context:** PDF, delivery, notification, scanning, transcription, and AI operations are slow/retryable.  
**Decision:** Use a durable job queue with tenant/correlation/idempotency metadata. Keep clinical transactions synchronous.  
**Alternatives:** Make every operation synchronous; rejected for poor UX and retry behavior.  
**Reasoning:** Separates committed clinical state from eventual side effects.  
**Consequences:** Job monitoring, dead-letter handling, and idempotency are required.  
**Open Questions:** Queue technology and capacity sizing after load tests.

> Stage 3.1 note (2026-09-17): the queue technology open question is answered by ADR-015 (MariaDB job tables, leases, outbox, cron-assisted runner). No external queue broker is used.

## ADR-011 - Shared Flutter mobile architecture

**Context:** Medigo demonstrates separate patient/doctor mobile flows; DocPilot demonstrates shared Flutter packaging. Both are incomplete/old.  
**Decision:** Shared Flutter core with role-specific app shells/modules, Android-first.  
**Alternatives:** Separate native codebases or reuse old dependencies; rejected for duplication or maintenance risk.  
**Reasoning:** Shared auth/API/offline/upload primitives reduce divergence while preserving role UX.  
**Consequences:** Feature boundaries and release testing must remain disciplined.  
**Open Questions:** Exact package/release strategy.

## ADR-012 - Video provider abstraction and no recording default

**Context:** HCW has mediasoup patterns, Medigo has Agora, OpenEMR has provider-based telehealth; runtime/provider details are not equivalent.  
**Decision:** Use a provider-neutral telemedicine interface, audio-only fallback, short-lived participant tokens, and no recording by default.  
**Alternatives:** Commit immediately to Agora/Jitsi/mediasoup or record all calls; rejected without provider, consent, retention, and operational evidence.  
**Reasoning:** Preserves choice and minimizes sensitive media risk.  
**Consequences:** Adapter capability matrix and provider evaluation are required.  
**Open Questions:** Provider, TURN/ICE/reconnect, Bangladesh bandwidth/cost, recording policy.

---

# Source: ARCHITECTURE-REVIEW.md

# Architecture Review

## Executive Summary

This stage converts the teardown into a new implementation-ready architecture for a Bangladesh-first doctor telemedicine and patient-continuity platform. The design is a tenant-scoped modular monolith with PostgreSQL, private object storage, durable workers, provider adapters, and shared Flutter doctor/patient clients. It keeps physical and remote patients in the same serial, encounter, timeline, and follow-up domains.

No application source code was created. No reference repository was modified or forked.

## Architecture

Major decisions:

- New codebase, no reference fork.
- Modular monolith first, with workers for slow/retryable operations.
- PostgreSQL source of truth for structured clinical data.
- Object storage for files and private signed access.
- Explicit Tenant/Membership authorization and tenant-scoped repositories.
- First-class Serial/ChamberDay/QueueEvent instead of appointment-as-queue.
- Encounter separated from Appointment and Serial.
- Patient Timeline as an authorized source-linked projection.
- Provider-neutral communication, video, payment, and AI adapters.
- AI drafts only; doctor approval creates final clinical truth.
- Android-first shared Flutter core with role-specific app shells.

## Core Domain Model

The canonical relationships are:

```text
Tenant
  -> Clinic -> Chamber -> ChamberDay -> Appointment -> Serial -> Encounter
Tenant
  -> Users/Memberships -> DoctorProfile/StaffProfile
Tenant
  -> Patient -> Contacts/Consents
Encounter
  -> Participants, Notes, Symptoms, Diagnoses, Prescription, LabReports, Documents
Patient
  -> TimelineEvents, PatientMedications, FollowUpPlans, Communications
Encounter
  -> TelemedicineSession -> Participants/JoinEvents
AIJob
  -> Transcript/Draft/Suggestion -> AIApproval -> doctor-authored final artifact
```

No giant medical-record model, generic EAV clinical model, or appointment record containing all clinical data is used.

## Critical Workflows

### Serial to consultation

A patient is identified or created, books or walks in, receives a serial for a chamber day, checks in, waits in the shared queue, is called or recalled, and starts exactly one encounter. Physical and remote care use the same serial state machine; `care_mode` affects readiness and communication, not identity or timeline ownership.

### Consultation to prescription

The doctor records structured symptoms, diagnoses, notes, documents, and a prescription draft. AI may populate a draft suggestion. The doctor reviews and edits. An authorized doctor approves a version, which becomes immutable final clinical data and triggers PDF rendering/delivery jobs.

### Timeline to follow-up

Committed domain events create source-linked timeline entries. The doctor sees prior encounters, diagnoses, prescriptions, labs, documents, communications, and follow-ups. A follow-up plan can create a new appointment and serial linked to the source encounter without reusing the old serial.

## AI Safety

AI jobs, drafts, suggestions, and approvals are separate from final clinical tables. Every artifact records provider/model/version, input references, output, uncertainty, reviewer, edits, decision, and timestamp. No patient, staff, or automated worker can finalize an AI diagnosis or prescription without the required doctor action.

## Bangladesh Readiness

The architecture includes Asia/Dhaka-aware chamber days, E.164 phone normalization, OTP abstraction, Bangla/English/Banglish search aliases, bilingual document capability, shared physical/remote queue, walk-ins, delay/recall/no-show, resumable uploads, audio-only fallback, provider-neutral SMS/WhatsApp/email, and Android-first low-bandwidth behavior.

The architecture does not claim Bangladesh regulatory compliance, approved medicine data, WhatsApp availability, payment provider availability, or legal retention periods. Those remain explicit research gates.

## Security

Tenant checks exist at API/service and repository layers. Files use private object storage and short-lived signed URLs. Audit events cover PHI access, clinical writes, approvals, communications, permission changes, exports, and security events. Logs are redacted. Backups, restore drills, secret management, rate limiting, dependency review, and tenant-isolation tests are production gates.

## MVP

1. Foundation and tenant context.
2. Patient identity and duplicate review.
3. Chamber/schedule/serial/queue.
4. Encounter and manual clinical notes.
5. Structured prescription and PDF.
6. Patient timeline.
7. Follow-up and notifications.
8. Minimal remote session adapter.
9. Controlled AI note draft after manual workflow stability.

## Deferred Work

Real-time transcription, broad clinical decision support, automated lab extraction, recording, PSTN ownership, advanced payments, claims, cross-tenant sharing, and provider-specific features are deferred until validated.

## Open Questions

- Which identity/OTP provider and Bangladesh SMS route will be used?
- Which WhatsApp Business provider, templates, consent model, and fallback are available?
- Which video provider meets bandwidth, token, TURN/ICE, cost, and data-handling needs?
- Which verified Bangladesh medicine dataset and update process will be licensed?
- What clinical review is required for AI note, diagnosis, medication, and lab suggestions?
- What retention, export, deletion, data residency, telemedicine consent, prescription, and payment requirements apply?
- Which payment provider and cash/chamber settlement process are viable?
- What queue policy do real chambers require for late arrivals, fairness, overbooking, and recall?

## Risks

- Serial concurrency bugs can create double booking or unsafe queue behavior.
- Weak tenant filtering can expose PHI.
- Provider outage can interrupt delivery or consultation.
- AI extraction errors can contaminate records if approval is bypassed.
- Old reference dependencies are not to be inherited.
- Large files, audio, and documents can create cost/retention risk.
- Local provider/legal decisions may change adapters, templates, or policy configuration.

## Reference Repository Influence

### Observed in teardown

OpenEMR relational clinical/audit/API breadth; TPT tenant/EHR boundaries and decision-support entities; HCW consultation/media states and mediasoup topology; Medigo patient/doctor mobile split, Firebase booking/chat, and Agora integration; DocPilot shared Flutter package structure.

### Architectural pattern adopted

Tenant-scoped structured records, explicit appointment/encounter separation, consultation state concepts, provider adapters, shared mobile core, document metadata/versioning, audit events, and human-reviewed AI drafts.

### Pattern modified

Medigo’s mobile split is retained but moved behind a server API and modern shared client core. HCW’s consultation-centric state ideas are combined with TPT/OpenEMR-style patient and clinical separation. Timeline is designed as a projection rather than a reference repository’s arbitrary UI aggregation.

### Pattern rejected

Direct client-side PHI writes, free-text-only prescriptions, one shared user row as the complete patient/doctor EHR model, silent AI writes, generic unverified WhatsApp/SMS claims, legacy dependencies, and copying GPL/unknown-license source without legal review.

## Definition of done for this stage

- All required architecture documents exist.
- Serial engine and state transitions are explicit.
- Patient identity, timeline, consultation, prescription, AI, communication, mobile, security, localization, MVP, roadmap, ADRs, and traceability are documented.
- Database and API names align with the domain model.
- Unresolved provider/legal/clinical questions are preserved.
- No product implementation or reference-repository modification occurred.

## Change log

### 2026-09-17 — Stage 3.1

- The relational engine and signed-URL findings are superseded by ADR-014 (MariaDB) and ADR-016 (download tokens). Stage 3.1 review: `docs/implementation/IMPLEMENTATION-REVIEW.md` and `docs/implementation/ARCHITECTURE-CONSISTENCY-AUDIT.md`.

### 2026-09-17 — Stage 3.2

- Open questions "Which payment provider…" and the SMS/OTP provider are answered by ADR-019 (aamarPay) and ADR-018 (Zaman IT); cash/chamber settlement remains pay-at-chamber without tracking in MVP. The "approved medicine data" non-claim still stands: the imported dataset is `UNVERIFIED` and production-gated (ADR-020).

---

# Source: BANGLADESH-LOCALIZATION-SPEC.md

# Bangladesh Localization Specification

## 1. Locale and time

- Default locale: `bn-BD` for patient-facing interfaces where selected; `en-BD` remains available for doctors/staff.
- Default deployment timezone: `Asia/Dhaka`.
- Store timestamps as timezone-aware instants; store chamber-day local date and timezone explicitly.
- Format dates, times, digits, currency, and weekdays through locale services, not string concatenation.
- Keep translation keys versioned and allow tenant-level default locale.

## 2. Phone identity

- Normalize Bangladesh numbers to E.164 where possible; preserve entered display value separately.
- Support local `01...` input and international `+880...` presentation without assuming every number is mobile.
- Store verified and unverified contact states, purpose, last verification time, and channel preference.
- Permit alternate phone, caregiver phone, and emergency contact without making them the patient identity.
- OTP provider, sender identity, delivery, abuse controls, and applicable legal requirements require provider/legal research.

## 3. Language and search

- UI supports Bangla and English; Banglish is accepted as a search/input aid, not a canonical clinical language.
- Store canonical medicine/diagnosis terms separately from localized labels and aliases.
- Search fields may include Bangla name, English name, Banglish terms, brand name, generic name, and approved aliases.
- Transliteration must be versioned and explainable; never silently change the doctor’s authored clinical text.
- PDFs may render bilingual labels and doctor-authored text according to tenant/patient preference. Font embedding and print QA are required.

## 4. Medicine catalog

The schema supports generic name, brand name, strength, dosage form, manufacturer, Bangladesh brand flag, Bangla name, Banglish aliases, and dataset version. No medication data is invented in this stage. Import requires a verified dataset, provenance, update process, deprecation policy, and clinical/pharmacy review.

A doctor may use a free-text fallback when the catalog has no match; the fallback is visibly marked and not silently mapped to a catalog item.

## 5. Chamber operations

The chamber-day model supports:

- advance booking and walk-in;
- physical, remote, and hybrid care mode;
- recurring weekly schedule and dated exceptions;
- delay notices and queue recalculation;
- no-show, skip, recall, reschedule, and cancellation;
- multiple chambers per clinic/doctor;
- remote patients entering the same queue as physical patients.

No patient-facing view exposes another patient’s identity or medical reason.

## 6. Connectivity

- API mutations are idempotent and retryable where safe.
- Uploads use resumable multipart sessions and checksums.
- Attachments are compressed client-side within a configured quality limit.
- Audio-only consultation is available when video is not viable.
- Patient can see last synchronized queue state and its timestamp when offline; stale state is clearly labeled.
- The server remains authoritative for queue position, encounter lifecycle, and prescription finalization.

## 7. Communication and payment

- SMS and WhatsApp are adapters with consent, templates, receipts, retries, and fallback.
- Email and in-app notifications remain independent fallback channels.
- Payment uses a provider-neutral interface; Bangladesh provider selection, cash/chamber settlement, refunds, and applicable regulation are open research items.

## 8. Bangladesh research register

Before production, separately research phone/OTP practices, WhatsApp Business requirements, prescription/doctor credential requirements, telemedicine consent, medical record retention/export, payment rules, data residency, SMS sender requirements, and AI clinical governance. This document does not assert compliance or invent requirements.

## Change log

### 2026-09-17 — Stage 3.1

- Research register additions (open, no compliance claim): (a) Hostinger data-center region (India selected by default) and cross-border hosting of patient data; (b) object storage and backup destination region; (c) AI provider data location, retention and terms for clinical use; (d) the **AI patient data gate**: whether minimized patient data may be sent to foreign AI providers, on which tiers, and under what consent (AIREG-001…009 in `docs/implementation/AI-PROVIDER-REGISTER.md`). References: ADR-013, ADR-016, ADR-017.
- Bangla text uses `utf8mb4` with `utf8mb4_unicode_520_ci` collation; Asia/Dhaka local dates are stored alongside UTC timestamps (ADR-014).

### 2026-09-17 — Stage 3.2

- Research register additions (open; no compliance claim): (a) **payment aggregation/facilitation** — whether Hakeemify may collect patient fees on behalf of doctors, with tax, accounting and payout obligations (`GATE-PAY-PLATFORM-COLLECTION`); (b) SMS sender ID masking rules, transactional vs promotional routes, DND and sending-hour restrictions, and whether OTP over a plain-HTTP provider API is acceptable (`GATE-SMS-HTTP`); (c) medicine data licensing and use for DGDA, the Mendeley dataset and pharmacy sources, clinician/pharmacist sample review, DGDA cross-reference (`GATE-MEDDATA-PROD`); (d) refund and consumer-protection rules for online medical-service payments. References: ADR-018, ADR-019, ADR-020.
- Payer contact data: aamarPay requires a customer email; many patients have none. HMedic never fabricates per-patient emails and uses the payer email, the clinic contact email or a platform no-reply address (ADR-019 §5).
- Medicine search supports brand, generic, Bangla and Banglish aliases, with machine-generated aliases ranked lowest; veterinary products are excluded; observed prices are labelled "observed price, may differ" and never shown as MRP (ADR-020).

---

# Source: COMMUNICATION-SPEC.md

# Communication Specification

## 1. Provider-neutral model

Business modules create a `Communication` intent. A channel adapter performs delivery:

```text
CommunicationService -> ProviderAdapter -> WhatsApp / SMS / Email / Phone / Push / Video
```

The business action never calls a Twilio, WhatsApp, SMTP, Agora, Jitsi, or other provider SDK directly.

## 2. Supported channels

- `in_app`: timeline/notification and message inbox.
- `email`: prescription, appointment, follow-up, and account messages where consented.
- `sms`: OTP, queue updates, fallback, and essential notification where configured.
- `whatsapp`: template-based messages through an approved provider adapter; no generic API assumption.
- `phone`: provider-neutral call intent or click-to-call handoff; PSTN ownership is an open question.
- `video`: telemedicine session adapter, separate from message delivery.

## 3. Delivery state machine

```text
CREATED -> CONSENT_CHECKED -> QUEUED -> SENDING -> SENT
SENT -> DELIVERED -> READ
SENDING/SENT -> FAILED -> RETRY_SCHEDULED -> QUEUED
CREATED/QUEUED -> CANCELLED
```

Provider-specific states map into this normalized state. A delivery attempt stores provider message ID, attempt number, timestamps, redacted error class, and receipt. It never stores an access token or raw PHI provider payload in ordinary logs.

## 4. Idempotency and retry

- `Communication.idempotency_key` is unique per tenant.
- A worker may retry transient failures with exponential backoff and a maximum attempt policy.
- Permanent failures require a visible reason and optional alternate channel.
- Delivery receipts are webhook-verified where the provider supports signatures.
- Webhooks are authenticated, deduplicated by provider event ID, and mapped to a communication attempt.

## 5. Consent and preferences

Before sending, evaluate:

- patient channel preference and opt-out;
- purpose and consent basis;
- tenant template/channel configuration;
- destination verification state;
- whether the content is allowed for that channel;
- whether a fallback is authorized.

A patient may choose portal-only, email, SMS, WhatsApp, or a combination. Essential account/security messages have separate policy and legal review.

## 6. WhatsApp

Treat WhatsApp as a provider integration with explicit constraints:

- use approved templates where required;
- store template version and locale;
- record consent and opt-out;
- support delivery/failure receipts;
- do not assume calling and messaging have the same API or consent behavior;
- fall back to SMS/email/in-app only when patient preference and policy allow;
- never place a permanent signed document URL in a message; use an expiring authorized link or portal notification.

Provider selection, template approval, business verification, and Bangladesh availability remain open questions.

## 7. SMS/email

- SMS adapter supports Bangladesh E.164 normalization, provider message IDs, sender configuration, retries, and failover.
- Email uses a transactional provider abstraction, template version, unsubscribe/preference behavior, and bounce handling.
- OTP delivery is isolated from general communications and has stricter rate limits.
- Prescription PDFs are generated first, stored privately, then delivered using an authorized short-lived link or attachment policy.

## 8. Notifications

Queue notifications are generated from serial events: booked, confirmed, checked-in, called, delayed, skipped, recalled, and cancelled. Notifications contain minimum necessary content. Patient-facing queue position is derived from current eligible serials and is not disclosed to unauthorized users.

## 9. Video/audio

`TelemedicineProvider` exposes `createSession`, `issueParticipantToken`, `endSession`, and `recordParticipantEvent`. The initial adapter may use an external provider or WebRTC-compatible service; the selection is intentionally open. Provider credentials stay server-side.

- No recording by default.
- Session token is short-lived and encounter/participant scoped.
- Reconnect events are recorded without treating a temporary disconnect as encounter completion.
- Audio-only mode is a first-class fallback.
- Low-bandwidth mode can disable video while preserving audio/chat.
- A phone handoff is recorded as a communication event if the platform does not own the call.

## 10. Asynchronous operations

Background jobs handle outbound delivery, receipts, PDF generation, push notifications, and provider webhooks. Queue/encounter state changes remain synchronous transactions; notification fan-out follows the committed event.

## Change log

### 2026-09-17 — Stage 3.1

- Delivery work runs on the MariaDB job queue (`notifications` queue) with outbox dispatch and DB-backed idempotency (ADR-015).
- OTP messages are sent synchronously after the OTP challenge commits, not via the job queue (`docs/implementation/AUTH-IMPLEMENTATION.md`).
- Video signaling and media are hosted by the selected telemedicine provider; the platform origin does not accept inbound WebSockets (ADR-013).

### 2026-09-17 — Stage 3.2

- Zaman IT is the first SMS adapter and the OTP delivery transport (ADR-018). Normalized terminal state for Zaman IT SMS is `SENT` unless a delivery-report source is verified; `DELIVERED`/`READ` are not invented.
- Duplicate safety without provider idempotency: no automatic OTP resend; at most one transactional retry after an unknown outcome, flagged as a possible duplicate.
- SMS templates are versioned (bn-BD, en-BD) and may contain only generic text, OTP code, serial number, time, clinic SMS name and an opaque login-required short link.

---

# Source: DATABASE-SPEC.md

# Database Specification

## 1. Relational baseline

Use PostgreSQL with UUID primary keys generated by the database/application boundary. Every tenant-owned table MUST include `tenant_id` and a foreign key to `tenants(id)` unless explicitly documented as global reference data. Use UTC timestamps in storage with the tenant/deployment timezone applied for display; default deployment timezone is `Asia/Dhaka`.

Common columns on mutable tenant tables:

```text
id uuid primary key
tenant_id uuid not null references tenants(id)
created_at timestamptz not null
updated_at timestamptz not null
created_by uuid nullable references users(id)
updated_by uuid nullable references users(id)
deleted_at timestamptz nullable
```

Do not use a generic EAV table for core clinical fields. JSON is allowed for provider payload snapshots, address/contact extensions, configurable tenant settings, and raw extraction payloads, with strict size/redaction rules.

## 2. Core tables

### Identity and organization

| Table | Important columns and constraints |
|---|---|
| `tenants` | `id`, `name`, `slug unique`, `status`, `default_locale`, `default_timezone`, `created_at`. |
| `users` | `id`, `email nullable unique`, `status`, `last_login_at`; credentials are stored in an external identity system or dedicated protected credential store, not plaintext. |
| `tenant_memberships` | `tenant_id`, `user_id`, `role`, `permissions jsonb`, `status`; unique `(tenant_id,user_id)`, index by tenant/role/status. |
| `doctor_profiles` | `tenant_id`, `user_id`, display name, registration metadata, specialty, status; unique `(tenant_id,user_id)`. |
| `staff_profiles` | `tenant_id`, `user_id`, role/title/status; unique `(tenant_id,user_id)`. |
| `clinics` | `tenant_id`, name, address, locale/timezone override, status; unique `(tenant_id,name)` where active. |
| `chambers` | `tenant_id`, `clinic_id`, `doctor_id`, name, mode capability, status; indexes `(tenant_id,doctor_id,status)` and `(tenant_id,clinic_id)`. |

### Patient identity

| Table | Important columns and constraints |
|---|---|
| `patients` | `tenant_id`, `medical_record_number`, legal/display names, date of birth, sex/gender fields, address jsonb, status, primary phone reference; unique `(tenant_id,medical_record_number)`. Do not use phone alone as identity. |
| `patient_contacts` | `tenant_id`, `patient_id`, `type`, normalized value, display value, verification status, preferred flag, consent status; unique active normalized value per patient/type. |
| `patient_identifiers` | `tenant_id`, `patient_id`, identifier type/value/source; unique `(tenant_id,type,value)` when verified. |
| `patient_merge_cases` | source patient, target patient, reason, status, reviewer, reviewed_at; all merges are auditable and reversible by policy. |
| `patient_consents` | patient, purpose, channel, status, captured_at, withdrawn_at, evidence reference, policy version. |

### Scheduling and serials

| Table | Important columns and constraints |
|---|---|
| `doctor_schedule_rules` | tenant, chamber, doctor, weekday/date exception, start/end local time, capacity, recurrence, active dates. |
| `chamber_days` | tenant, chamber, doctor, local date, timezone, status, queue policy snapshot, sequence seed; unique `(chamber_id,local_date)`. |
| `appointment_slots` | chamber day, start/end, capacity, booking status; index by doctor/date/status. |
| `appointments` | tenant, patient, doctor, chamber, chamber day, slot nullable, source, care mode, status, reason, rescheduled_from nullable; indexes by patient/date/status and doctor/day/status. |
| `serials` | tenant, chamber day, appointment nullable, patient, serial number, queue position, care mode, source, status, check-in/call timestamps, recall count, encounter nullable; unique `(chamber_day_id,serial_number)`, index `(chamber_day_id,status,queue_position)`. |
| `check_ins` | serial, method, checked_in_at, verified_by, remote readiness, location/device metadata minimized. One active check-in per serial. |
| `queue_events` | tenant, serial, event type, from/to status, position before/after, actor, reason, occurred_at, idempotency key; append-only, index by serial/time. |

Queue transitions and serial allocation MUST use a transaction with a chamber-day lock or serial counter row. Never allocate with a client-side timestamp or random number.

### Encounter and clinical records

| Table | Important columns and constraints |
|---|---|
| `encounters` | tenant, patient, doctor, chamber, serial, appointment, care mode, status, started/ended/interrupted timestamps, completion reason; unique one active encounter per serial. |
| `encounter_participants` | encounter, user/patient/external participant, role, joined/left timestamps, authorization status. |
| `encounter_notes` | encounter, author, version, structured section columns/jsonb, status, signed_at; unique `(encounter_id,version)`. |
| `symptom_observations` | encounter, patient, normalized term nullable, free-text detail, onset, severity, source, certainty. |
| `diagnoses` | encounter, patient, code system/code nullable, display, status, certainty, author, source (`doctor` or `ai_approved`). |
| `medications` | global/tenant catalog scope, generic/brand names, strength, form, manufacturer, locale fields, aliases jsonb, dataset version, active status. Never seed invented Bangladesh values. |
| `patient_medications` | patient, medication nullable, free-text fallback, dose/instructions, start/end, status, source encounter/prescription. |
| `prescriptions` | tenant, patient, encounter, doctor, status (`draft`,`final`,`void`), version, approval metadata, rendered document ID nullable; unique version per encounter. |
| `prescription_items` | prescription, sequence, medication nullable, free-text name fallback, strength, form, route, dose, frequency, duration, quantity, instructions, substitution flag; index prescription/sequence. |
| `lab_reports` | tenant, patient, encounter nullable, source/lab name, report date, review status, document ID, raw metadata. |
| `lab_results` | lab report, analyte/code, value numeric/text, unit, reference range, abnormal flag, result date, extraction source, review status. |
| `documents` | tenant, patient, encounter nullable, category, storage key, version, MIME, size, checksum, upload status, access policy, malware scan status. |
| `document_versions` | document, version number, storage key, checksum, uploaded by, created at; unique `(document_id,version_number)`. |

### Timeline, follow-up, communication

| Table | Important columns and constraints |
|---|---|
| `timeline_events` | tenant, patient, event type, occurred_at, source type/id, summary, visibility, structured refs jsonb, projection version; index `(tenant_id,patient_id,occurred_at desc)`. Immutable after creation except redaction marker. |
| `follow_up_plans` | tenant, patient, source encounter, doctor, due date/window, reason, instructions, status, appointment/serial nullable. |
| `communications` | tenant, patient nullable, actor, channel, purpose, template, consent reference, business type/id, status, idempotency key; unique idempotency key per tenant. |
| `communication_attempts` | communication, provider, provider message ID, status, attempt number, error class, sent/delivered/failed timestamps, redacted provider metadata. |
| `communication_preferences` | tenant, patient, channel, address/contact, preference, consent version, effective dates. |
| `telemedicine_sessions` | tenant, encounter, provider adapter, provider session ID, state, issued/expires timestamps, ended reason, recording policy. |
| `telemedicine_participants` | session, participant, role, join/leave/reconnect counts, authorization state. |

### AI and audit

| Table | Important columns and constraints |
|---|---|
| `ai_jobs` | tenant, requested by, purpose, provider, model, input references, status, started/completed, failure class, correlation ID. |
| `ai_transcripts` | job, source document/audio, language, segments, confidence metadata, status; raw audio is not copied into ordinary rows. |
| `ai_drafts` | job, encounter/patient, draft type, schema version, structured output jsonb validated against schema, provenance, status, expires_at. |
| `ai_suggestions` | draft, suggestion type, source refs, text/structured candidate, confidence/uncertainty, review status. |
| `ai_approvals` | suggestion/draft, reviewer doctor, decision, edits, approved artifact ID, approved_at; unique approval decision per version. |
| `audit_logs` | tenant nullable, actor, action, resource type/id, request/correlation ID, outcome, occurred_at, redacted metadata, hash chain/reference where implemented. Append-only. |

## 3. Tenant isolation

- Repositories require `tenant_id` as an explicit parameter or derive it from an authenticated membership context.
- Service methods reject cross-tenant IDs even if a resource UUID is known.
- PostgreSQL row-level security MAY be added after repository query tests exist; it is defense-in-depth, not a substitute for service authorization.
- Tenant-isolation integration tests are mandatory for every sensitive repository.

## 4. Soft delete and retention

- Clinical source records are not physically deleted through ordinary user actions. Use status, void, redaction, or controlled deletion workflows.
- Operational records such as appointment drafts may use `deleted_at`.
- Documents use retention metadata and tombstones; storage deletion requires an authorized job and audit event.
- Retention periods, export/deletion rights, and legal holds remain research questions requiring Bangladesh-specific legal review.

## 5. Required indexes

At minimum: tenant plus patient/date on all patient history tables; tenant plus doctor/chamber/day/status on scheduling and serial tables; serial state/position on queues; encounter/patient/time on clinical tables; communication status/provider IDs; AI job status/created time; audit resource/time and actor/time. Add query plans before adding broad indexes.

## Change log

### 2026-09-17 — Stage 3.1

- Engine is MariaDB (ADR-014). UUID keys become `VARCHAR(36)` ascii_bin UUIDv7 generated in the application; zoned timestamps become `DATETIME(3)` UTC; binary JSON becomes `JSON` (LONGTEXT + `JSON_VALID`); partial unique indexes become persistent generated columns + UNIQUE; case-insensitive text types become normalized columns.
- The row-level-security option is withdrawn: MariaDB has no RLS. Tenant isolation relies on scoped repositories, composite tenant foreign keys and tenant-isolation tests.
- `encounter_notes` versioning changes to one draft row plus append-only `encounter_note_versions`; bare version columns are replaced by `row_version` (optimistic lock) and `revision` (business version). See consistency audit C-06, C-10.
- New tables for the database job queue (ADR-015), patient accounts and guardianships (audit C-15), per-doctor AI credentials and policy (ADR-017), and storage upload sessions (ADR-016). Build contract: `docs/implementation/DATABASE-IMPLEMENTATION.md`.

### 2026-09-17 — Stage 3.2

- Payments and platform subscriptions are MVP (ADR-019 supersedes the billing-Future scope): payment intents, verifications, ledger (append-only, hash-chained), refunds, payouts, fee schedules, merchant accounts, subscriptions. Money is `DECIMAL`, never floating point.
- The medication catalog is imported from the Stage M dataset with provenance, keyed by the dataset `record_key`, never deleting referenced rows, and gated for production (ADR-020). New catalog tables: generics, manufacturers, price observations, usage stats, dataset imports, gate attestations.
- Generalized `provider_credentials` (SMS and payment secrets, envelope-encrypted), `platform_operators`, `platform_gate_decisions`, `sms_balance_snapshots`, `communication_short_links` (ADR-018/019). Build contract: `docs/implementation/DATABASE-IMPLEMENTATION.md` (migrations 0015–0018 and amendments).

---

# Source: DOMAIN-MODEL.md

# Domain Model

## 1. Identity and tenancy

- `Tenant`: SaaS boundary; owns clinics, users, chambers, patients, and all clinical/operational records.
- `User`: login identity and global account metadata. A user may have memberships in multiple tenants.
- `TenantMembership`: tenant-scoped role and permission assignment.
- `DoctorProfile`: clinician identity, display information, credentials metadata, specialties, and active status.
- `StaffProfile`: receptionist, nurse, manager, or other operational staff assignment.
- `Patient`: persistent medical identity owned by a tenant. It is not recreated per appointment.
- `PatientContact`: normalized phone/email/contact point with type, verification state, and preference.
- `PatientMergeCase`: controlled duplicate-resolution workflow; never silently merges clinical histories.

## 2. Organization and schedule

- `Clinic`: organization location or business unit within a tenant.
- `Chamber`: doctor-facing service location or virtual chamber. A chamber belongs to a clinic and may support physical, remote, or hybrid care.
- `ChamberDay`: a dated operating instance generated from a recurring schedule. It owns one queue sequence.
- `DoctorScheduleRule`: recurring weekly/exception schedule definition.
- `AppointmentSlot`: bookable time range or booking capacity associated with a chamber day.
- `Appointment`: booking intent for a patient, doctor, chamber day, and care mode. It is not a queue position or encounter.

## 3. Serial and queue

- `Serial`: a patient’s position in one chamber day. It may link to an appointment or be a walk-in serial.
- `QueueEvent`: append-only record of queue transitions, actor, reason, position before/after, and timestamp.
- `CheckIn`: explicit arrival/readiness record with physical/remote method and verification status.
- `QueuePolicy`: chamber-day settings for capacity, numbering, grace period, recall count, and reorder permissions.

### Serial state machine

```text
REQUESTED -> BOOKED -> CONFIRMED -> CHECKED_IN -> WAITING -> CALLED
CALLED -> IN_CONSULTATION -> COMPLETED
CALLED -> SKIPPED -> RECALLED -> CALLED
WAITING -> NO_SHOW
REQUESTED/BOOKED/CONFIRMED/CHECKED_IN/WAITING/CALLED -> CANCELLED
BOOKED/CONFIRMED -> RESCHEDULED -> BOOKED
```

Rules:

- `REQUESTED` is optional for pending remote/online booking; `BOOKED` is the committed serial reservation.
- A walk-in creates a `Serial` directly in `BOOKED` or `CHECKED_IN` according to staff action and has `source=walk_in`.
- Physical and remote serials share the same queue sequence. `care_mode` is `physical`, `remote`, or `hybrid`.
- Only `CHECKED_IN`, `WAITING`, `CALLED`, `IN_CONSULTATION` are queue-active states.
- `CALLED` has a recall deadline. Expiry transitions to `SKIPPED`; staff can create `RECALLED` as a new queue event, not erase history.
- Reordering changes current position through an audited queue event. It does not rewrite the original serial number.
- Delay is represented by chamber-day/queue policy and queue events with reason and expected delay, not by mutating historical timestamps.
- `COMPLETED` requires a linked encounter, even when the encounter is marked interrupted and completed later.
- `NO_SHOW`, `CANCELLED`, and `RESCHEDULED` are terminal for that serial; a new serial is required for a new visit.

## 4. Consultation and clinical model

- `Encounter`: clinical service event linked to one serial, patient, doctor, tenant, and care mode. It has lifecycle, start/end, interruption, and completion status.
- `EncounterParticipant`: patient, doctor, staff, interpreter, or invited participant with role and join/leave metadata.
- `EncounterNote`: structured sections such as complaint, history, examination, assessment, plan, and free-text clinician notes. Versioned and authored.
- `SymptomObservation`: patient-reported or clinician-observed symptom with normalized term where available, free-text detail, onset, severity, and source.
- `Diagnosis`: diagnosis/problem attached to an encounter with code-system reference where available, clinician status, certainty, and notes. AI suggestions are not diagnoses until approved.
- `Medication`: catalog entity with generic/brand names, strength, form, manufacturer, aliases, locale terms, and source/version metadata.
- `PatientMedication`: longitudinal medication history with active/inactive status and source encounter.
- `Prescription`: a doctor-authored clinical document with draft/final/void status, version, approval metadata, and patient/encounter association.
- `PrescriptionItem`: structured medicine instruction: medication reference or free-text fallback, strength, form, route, dose, frequency, duration, quantity, timing, instructions, and substitution flag.
- `LabReport`: patient-associated report metadata and review status, optionally linked to an encounter/follow-up.
- `LabResult`: structured analyte/result where extraction or manual entry is reliable; raw report remains authoritative.
- `Document`: uploaded or generated file metadata, classification, ownership, checksum, versions, and access policy.

## 5. Timeline and follow-up

- `TimelineEvent`: immutable projection record with event type, occurred-at, source type/id, summary, actor, visibility, and searchable structured references. It is generated from committed domain events.
- `FollowUpPlan`: doctor-authored plan with reason, due date/window, instructions, target encounter, and status.
- `FollowUpTask`: operational reminder/task linked to a plan and optionally an appointment/serial.

Timeline event types include `appointment`, `serial`, `queue_change`, `encounter_started`, `encounter_completed`, `symptom`, `diagnosis`, `prescription_finalized`, `lab_report`, `document`, `follow_up`, `communication`, `call`, `ai_approved_note`, and `doctor_note`.

## 6. Communication and telemedicine

- `Communication`: logical outbound/inbound message intent with channel, template, recipient, consent basis, and business reference.
- `CommunicationAttempt`: provider-specific delivery attempt, retry state, provider message ID, receipt, error class, and timestamps.
- `CommunicationPreference`: patient/tenant channel preferences and opt-in/opt-out records.
- `TelemedicineSession`: authorized media session linked to an encounter, provider adapter, expiry, state, and session metadata.
- `TelemedicineParticipant`: session participant authorization and join/leave/reconnect events.
- `MediaArtifact`: optional metadata for user-uploaded audio/video; recording is disabled unless separately enabled with consent and retention policy.

## 7. AI assistance

- `AIJob`: asynchronous job with purpose, provider/model, input references, status, and failure metadata.
- `AITranscript`: transcript segments and language metadata tied to an input artifact and job.
- `AIDraft`: structured draft output with schema version, provenance, uncertainty, and review status.
- `AISuggestion`: atomic suggested symptom, diagnosis, medication, follow-up, or timeline summary item.
- `AIApproval`: doctor review decision, edits, reviewer, timestamp, and final artifact reference.

AI objects are never the clinical source of truth. Final notes, diagnoses, prescriptions, and follow-ups are created or changed only through explicit clinician actions.

## 8. State ownership rules

- Appointment owns booking/cancellation/reschedule state.
- Serial owns queue state and position.
- Encounter owns clinical service lifecycle.
- Prescription owns medication instructions and finalization.
- Timeline owns read-optimized event projection, not clinical mutation.
- Communication owns delivery state, not clinical approval.
- AI owns drafts and provenance, never final clinical truth.

## Change log

### 2026-09-17 — Stage 3.1

- Serial state machine completed: walk-in entry `CHECKED_IN`, `RESCHEDULED` is terminal and creates a linked serial, `IN_CONSULTATION -> CANCELLED` interrupts the encounter (audit C-07).
- Chamber-day versioning is split into `next_serial_number`, `queue_order_version` and `row_version` (audit C-04).
- New entities: `PatientAccount`, `PatientGuardianship`, `CareTeamMember`, `DoctorCoverage` (audit C-14, C-15); `AIProviderCredential`, `TenantAIPolicy`, `AIDataUseAcknowledgement` (ADR-017); `Job`, `DeadLetter` (ADR-015); `UploadSession` (ADR-016).
- Encounter notes: one mutable draft plus immutable signed revisions (audit C-10). Timeline redaction inserts a `REDACTED` marker (audit C-05).

### 2026-09-17 — Stage 3.2

- New entities: `PaymentIntent` (state machine CREATED → REDIRECTED → PENDING_VERIFICATION → PAID/FAILED/CANCELLED/EXPIRED; PAID → REFUND_PENDING → REFUNDED; late verified success flagged for review), `PaymentVerification`, `LedgerEntry`, `Refund`, `Payout`, `FeeSchedule`, `PaymentMerchantAccount`, `Subscription`, `SubscriptionInvoice`, `ProviderCredential`, `PlatformOperator`, `MedicationDatasetImport` (ADR-019/020).
- `Appointment` gains `PENDING_PAYMENT` (capacity held, no serial) and payment requirement/status fields. Payment state never changes clinical entities.
- `Medication` is a global, versioned catalog record with provenance and review status; prescription items snapshot the catalog attributes at selection (ADR-020).

---

# Source: IMPLEMENTATION-ROADMAP.md

# Implementation Roadmap

This roadmap is for a new codebase. It contains no implementation work in this stage.

## Phase 0 - Architecture and validation

**Objectives:** approve domain names, threat model, provider evaluation plan, Bangladesh research register, and API/database conventions.

- Modules: architecture package, ADRs, test strategy, migration policy.
- Database: migration baseline and tenant context design.
- API: error envelope, auth contract, idempotency, pagination.
- UI: clickable workflow prototypes only if useful; no production feature dependency.
- Tests: architecture consistency, authorization matrix, serial transition table tests designed.
- Acceptance: all required specs reviewed, unresolved questions owner-assigned, no reference code selected for copying.
- Risks: provider/legal decisions may alter adapters but must not change core domain IDs.

## Phase 1 - Foundation

**Objectives:** API shell, PostgreSQL, migrations, object storage abstraction, job queue, observability, CI.

- Database: `tenants`, `users`, `tenant_memberships`, audit base.
- API: health, request IDs, authentication boundary, tenant context.
- UI: environment/session shell.
- Tests: migration, health, secret/config, tenant context, log redaction.
- Acceptance: a request cannot access a tenant without membership; no PHI in baseline logs.

## Phase 2 - Identity, tenant, patient

**Objectives:** accounts, roles, patient identity, phone normalization, duplicate review.

- Database: patient/contact/identifier/consent/merge tables.
- API: patient create/search/read/update, merge case workflow.
- UI: doctor/staff registration and patient search/create.
- Tests: duplicate scoring, verified phone, cross-tenant access, merge audit.
- Acceptance: one patient can own multiple future appointments/serials/encounters without duplication.

## Phase 3 - Doctor, chamber, scheduling, serial

**Objectives:** recurring chamber days, slots, walk-ins, shared queue.

- Database: clinics, chambers, schedule rules, chamber days, slots, appointments, serials, check-ins, queue events.
- API: booking, walk-in, check-in, queue read, call, skip, recall, reorder, delay.
- UI: doctor queue and patient queue position.
- Tests: exhaustive state transition matrix, concurrency/duplicate issuance, no-show/recall, reorder audit, physical/remote mixed queue.
- Acceptance: no serial number collision; every transition is auditable; queue truth survives client retry.
- Risks: queue concurrency and chamber-day timezone boundaries.

## Phase 4 - Consultation and clinical records

**Objectives:** physical and remote encounter lifecycle, participants, notes, symptoms, diagnoses, documents.

- Database: encounters, participants, notes, symptoms, diagnoses, documents.
- API: encounter start/interruption/end, clinical writes, upload sessions.
- UI: doctor consultation workspace and patient encounter status.
- Tests: serial-to-encounter uniqueness, permission scopes, version conflict, interruption/reconnect.
- Acceptance: completed serial has exactly one encounter link and clinical records remain versioned.

## Phase 5 - Prescription

**Objectives:** fast structured prescription editor, doctor approval, PDF rendering.

- Database: medications/catalog import boundary, patient medications, prescriptions/items, document versions.
- API: draft/edit/approve/render/access.
- UI: autocomplete, structured dosage/frequency/duration/instructions, approval screen.
- Tests: item validation, approval permissions, immutable final version, render failure/retry, no silent AI finalization.
- Acceptance: final prescription is doctor-approved, versioned, auditable, and patient-accessible.
- Dependency: verified medicine dataset is not required for schema/API work; catalog import is gated.

## Phase 6 - Patient timeline

**Objectives:** create an efficient patient history projection.

- Database: timeline events, projection version/checkpoint.
- API: cursor timeline with filters/source links.
- UI: doctor timeline and patient approved-history view.
- Tests: event ordering, idempotent projection, source authorization, redaction behavior.
- Acceptance: appointment, serial, encounter, diagnosis, prescription, lab, document, communication, AI approval, and follow-up events appear with source references.

## Phase 7 - Follow-up and notifications

**Objectives:** follow-up plans, reminders, queue notifications, delivery intent.

- Database: follow-up plans/tasks, communication/preferences/attempts.
- API: follow-up CRUD, communication status, preferences.
- UI: doctor follow-up creation and patient action view.
- Tests: due-date timezone, duplicate reminder prevention, opt-out, retry/fallback.
- Acceptance: follow-up can create a new appointment/serial linked to its source encounter.

## Phase 8 - Communication and telemedicine

**Objectives:** provider adapters, remote session authorization, audio/video fallback.

- Database: telemedicine sessions/participants, communication provider metadata.
- API: session create/join/end, message/delivery operations, webhooks.
- UI: join readiness, low-bandwidth mode, reconnect, audio-only.
- Tests: token scope/expiry, unauthorized join, provider failure, webhook idempotency, reconnection.
- Acceptance: remote patient and doctor use the same encounter/serial flow as physical care.
- Open question: provider selection and Bangladesh WhatsApp/SMS availability.

## Phase 9 - AI and voice

**Objectives:** controlled note drafts, optional asynchronous transcription, history retrieval.

- Database: AI jobs/transcripts/drafts/suggestions/approvals.
- API: trigger/status/review/approve.
- UI: source-linked draft review and explicit approval.
- Tests: schema rejection, prompt-injection fixture, provider timeout, doctor-only approval, audit provenance.
- Acceptance: AI cannot write a final diagnosis/prescription without an authorized doctor action.

## Phase 10 - Mobile hardening

**Objectives:** Android-first offline/cache/upload/retry behavior and low-end device quality.

- Database/API: conflict/version and upload status refinements.
- UI: patient/doctor production flows, push deep links, offline state.
- Tests: device, network switching, process death, upload resume, data clearing on logout.
- Acceptance: manual workflow remains usable when AI/provider/push features fail.

## Phase 11 - Security hardening

**Objectives:** threat-model remediation and operational controls.

- Work: dependency/SBOM review, secret scanning, SAST/DAST, authorization matrix, tenant isolation tests, signed URL tests, PHI log review, backup restore.
- Acceptance: critical findings closed or explicitly risk-accepted; no compliance claim made without external review.

## Phase 12 - Production readiness

**Objectives:** controlled launch readiness.

- Work: load tests for serial concurrency and timeline queries; job backlogs; provider failover; runbooks; incident drills; migration/rollback; support redaction.
- Acceptance: operational SLOs selected, monitoring alerts tested, restore drill passed, legal/provider research register reviewed.

## MVP order

1. Foundation.
2. Identity/tenant/patient.
3. Doctor/chamber/serial.
4. Consultation/clinical notes.
5. Prescription.
6. Timeline.
7. Follow-up/notifications.
8. Minimal remote session adapter.
9. Controlled AI note draft only after the manual loop is stable.

## Change log

### 2026-09-17 — Stage 3.1

- A Phase 0 **Hosting verification** (HOST-001…HOST-013 on the real Hostinger plan, synthetic data only) runs in parallel with Foundation (ADR-013).
- Foundation objectives change from a PostgreSQL database and generic job queue to MariaDB with engine-contract tests (ADR-014) and a database job queue with runner modes (ADR-015).
- New work streams: AI credentials (AICRED), AI policy and minimization (AIPOL), provider adapters (ADAPT) and patient accounts/guardianship (PAT-006…) (ADR-017, audit C-15). Signed URL tests become download-token tests (ADR-016). Sequencing: `docs/implementation/IMPLEMENTATION-BACKLOG.md`.

### 2026-09-17 — Stage 3.2

- New work streams: SMS/OTP delivery and provider credentials (SMS-*, ID-007) before real OTP go-live; payments (PAY-*) after scheduling/queue; medicine dataset import (MEDDATA-*) alongside the prescription catalog; production gates SMS-009, PAY-015, MEDDATA-006 before release. Sequencing: `docs/implementation/IMPLEMENTATION-BACKLOG.md`.

---

# Source: MOBILE-SPEC.md

# Mobile Architecture Specification

## 1. Strategy

Use a shared Flutter architecture for Doctor Mobile and Patient Mobile, with shared design tokens, API client, auth/session handling, offline primitives, upload queue, and domain DTOs. Keep role-specific features in separate app shells or feature modules. This studies Medigo’s patient/doctor split and DocPilot’s shared package pattern without inheriting their obsolete dependencies or direct Firebase writes.

Android is the primary target. iOS support should remain possible but must not delay low-end Android quality.

## 2. Shared layers

- `core`: environment, secure storage, error model, localization, connectivity, analytics redaction.
- `auth`: OTP/password/session/verification and device revoke.
- `api`: typed REST client, retry policy, idempotency, cursor pagination.
- `offline`: local cache for safe read models, outbox for explicitly retryable mutations, conflict/version handling.
- `uploads`: resumable object upload sessions, checksum, retry, scan status.
- `domain`: patient, appointments, serials, encounters, prescriptions, timeline, follow-ups.
- `ui`: accessible shared components, Bangla/English typography and formatting.

## 3. Doctor app

MVP flows:

1. Login and tenant/chamber selection.
2. Today’s chamber day and queue.
3. Check-in, call, skip, recall, reorder with permission.
4. Start physical or remote encounter.
5. Review patient timeline and prior prescriptions/labs.
6. Edit structured note and prescription draft.
7. Review AI draft if available; approve final clinical records.
8. End encounter and create follow-up.
9. View delivery status and failed notifications.

The doctor app MUST remain usable manually when video, AI, or a notification provider is unavailable.

## 4. Patient app

MVP flows:

1. OTP/login and patient profile.
2. Search/select doctor or receive a tenant link.
3. Book appointment or request remote serial.
4. Check in and see current queue position/delay without exposing other patients.
5. Join authorized remote encounter or follow physical chamber instructions.
6. View approved prescription, lab report, documents, and timeline.
7. Receive and schedule follow-up.
8. Manage communication preferences and consent.

## 5. Offline and low bandwidth

- Cache only minimum necessary patient-owned/read-authorized data on device.
- Encrypt local storage and clear it on logout/device revoke.
- Use an outbox only for safe, user-visible operations with idempotency keys; clinical finalization requires server confirmation.
- Show pending/synced/failed state for every queued operation.
- Resume uploads by part; compress images before upload; preserve original metadata separately.
- Audio-only fallback when video quality or bandwidth drops.
- Reconnect session and refresh join token without duplicating encounter or queue transitions.
- Use server timestamps for queue truth; the client never calculates authoritative position.

## 6. Push notifications

Push is an optimization, not the only channel. Deep links open an authenticated API view; payloads contain opaque IDs and minimal text. Delivery failure falls back according to communication preferences.

## 7. Android quality baseline

- Test low-memory and low-end Android devices.
- Avoid large startup bundles and unnecessary video assets.
- Support interrupted process restart, expired sessions, denied permissions, poor connectivity, and clock skew.
- Use accessible touch targets, Bangla text rendering, and dynamic text sizing.
- Do not include production credentials or provider secrets in the app.

## 8. Mobile test strategy

Unit-test state reducers and serializers; integration-test auth, API retries, outbox, upload resume, queue display, prescription access, and permission failures. Device tests cover offline/online transitions, remote join/reconnect, low bandwidth, notification deep links, and logout data clearing.

## Change log

### 2026-09-17 — Stage 3.1

- Queue freshness uses conditional polling with backoff; push remains a refresh hint (ADR-013, audit C-09).
- Mobile apps live in a separate `mobile/` Melos workspace with a Dart client generated from the OpenAPI 3.0 artifact (`docs/implementation/REPOSITORY-STRUCTURE.md`).
- Patient apps support multiple clinic contexts and dependents via patient accounts and guardianships (audit C-15). Doctor apps manage the doctor's own AI credentials; secrets are write-only (ADR-017).

### 2026-09-17 — Stage 3.2

- Patient app pays for appointments by opening the server-issued gateway URL in an external browser tab (Custom Tabs / SFSafariViewController) and returns through App Links / Universal Links to a result screen that shows the server status. No gateway credentials or aamarPay mobile SDKs in the app (ADR-019).
- OTP screens never auto-resend; a resend creates a new code within limits (ADR-018). The doctor prescription editor shows the catalog source indicator and never pre-fills doses (ADR-020).

---

# Source: PRODUCT-ARCHITECTURE-SPEC.md

# Product Architecture Specification

## 1. Product intent

Build a new Bangladesh-first platform for doctors who operate physical chambers and also serve remote patients. The core loop is:

`Serial -> Consultation -> AI-assisted documentation/prescription -> Patient Timeline -> Lab Reports -> Follow-up`

The system MUST represent physical and remote care in one model. A remote patient is not a different patient type and a remote consultation is not a separate record system.

## 2. Scope boundaries

### In scope

- Tenant, clinic, chamber, doctor, staff, patient, and access management.
- Patient identity with normalized Bangladesh phone numbers and alternate contacts.
- Advance appointments, walk-ins, physical serials, and remote serials.
- Shared doctor queue with check-in, call, skip, recall, delay, and no-show handling.
- Physical and remote consultations represented as encounters.
- Structured symptoms, diagnoses, doctor notes, prescriptions, lab reports, documents, timeline events, and follow-ups.
- Provider-neutral notifications and communication adapters.
- AI drafts for documentation, transcription, retrieval, and suggestions, always requiring doctor approval.
- Android-first doctor/patient clients with low-bandwidth behavior.

### Out of scope for MVP

- Autonomous diagnosis or prescribing.
- Automatic medication catalog population.
- PSTN phone infrastructure owned by the platform.
- Call recording by default.
- Full insurance/claims/ERP/billing suite.
- Cross-tenant patient sharing.
- Complex microservice decomposition.
- Regulatory certification claims.

## 3. Bounded contexts

| Context | Owns | Does not own |
|---|---|---|
| Identity & Access | Users, credentials, sessions, roles, permissions, OTP | Clinical patient facts |
| Tenant & Organization | Tenants, clinics, chambers, memberships, settings | Queue state and clinical records |
| Doctor & Staff | Doctor profiles, staff assignments, credentials metadata, schedules | Authentication credentials |
| Patient | Patient identity, contacts, merge candidates, consent references | Appointment-specific symptoms |
| Scheduling | Recurring schedules, chamber days, appointment slots | Live queue position |
| Serial & Queue | Serial issuance, check-in, queue position, queue events, delay/reorder | Clinical note content |
| Appointment | Booking intent, channel, cancellation/reschedule, patient/doctor/chamber link | Encounter note and prescription |
| Encounter & Clinical Records | Consultation lifecycle, participants, symptoms, diagnoses, notes, medications | Delivery provider mechanics |
| Prescription | Draft/final prescription, items, approval, rendering request | AI inference execution |
| Laboratory & Documents | Lab reports/results, uploaded documents, file metadata, versions | Patient identity ownership |
| Timeline | Immutable clinical and operational event projections | Source-of-truth mutation of clinical records |
| Follow-up | Follow-up plans, due dates, linked appointments/serials | General notification transport |
| Communication | Messages, templates, delivery attempts, consent, provider IDs | Clinical meaning of the message |
| Telemedicine | Session authorization, media session, participants, reconnection metadata | Appointment booking |
| AI Assistance | Jobs, transcripts, drafts, suggestions, provenance, approvals | Final clinical truth without approval |
| Audit & Compliance | Immutable audit events, exports, access events, retention tasks | Business workflow state |
| Billing & Subscription | Tenant plan, usage, payment intents, invoices | Clinical payment decisions |
| Localization | Locale, translation keys, search aliases, formatting policies | Clinical catalog truth |

## 4. Core workflow

1. Identify or create a patient. Duplicate detection MUST run before creating a new patient.
2. Create an appointment or walk-in request against a doctor, chamber, and chamber day.
3. Issue a `Serial` from the chamber-day sequence. The serial is the queue unit, not the appointment.
4. Check in the patient. Physical and remote patients enter the same queue with a `care_mode`.
5. Doctor or authorized staff calls the next eligible serial. A queue event records the action.
6. Start an encounter linked to exactly one serial. The encounter records physical or remote mode.
7. Capture structured symptoms, diagnoses, notes, documents, and prescription drafts. AI may assist but cannot finalize.
8. Doctor approves final clinical artifacts. Finalization creates immutable versions and timeline events.
9. Generate patient-accessible documents asynchronously and deliver through consented channels.
10. Create a follow-up plan. A follow-up may create a future appointment and serial while remaining linked to the original encounter.

## 5. MVP boundary

### MVP

- One tenant, multiple chambers, doctors, staff roles.
- Patient create/search/deduplication review.
- Advance booking and walk-in serials.
- Shared queue state machine with delay, skip, recall, no-show, and reorder audit.
- Physical encounter and remote encounter with an external video adapter.
- Structured clinical note, diagnosis reference, prescription draft/finalization, and PDF.
- Patient timeline projection.
- Follow-up plan and appointment creation.
- Email/in-app notifications plus provider-neutral SMS/WhatsApp adapter boundary.
- AI limited to doctor-triggered note draft and historical retrieval; approval required.
- Android-first patient and doctor flows.

### V1

- Resumable lab/document upload, lab report review, Bangla/Banglish search aliases, delivery receipts, SMS fallback, enhanced queue notifications, and audio-only fallback.

### V2

- Asynchronous speech-to-text and structured extraction, medication safety suggestions, bilingual prescription rendering, richer analytics, and multiple video providers.

### Future / research

- Real-time mixed-language transcription, provider-owned PSTN, call recording, automated lab extraction, advanced clinical decision support, payments, and integrations requiring legal/provider validation.

## 6. Non-functional targets

- Every sensitive read/write is tenant-scoped and authorization-checked in the service/data layer.
- Queue transitions are transactional and idempotent.
- Final clinical records are versioned and auditable.
- Large files are stored outside PostgreSQL.
- Normal logs contain no raw PHI, transcript, prescription text, or document URLs.
- Patient and doctor clients remain useful under intermittent connectivity.
- Asia/Dhaka is the default deployment timezone, while timestamps remain timezone-aware.

## Change log

### 2026-09-17 — Stage 3.1

- The statement that large files are stored outside the relational database stands; the engine is MariaDB (ADR-014) and files use the storage port (ADR-016).
- AI assistance uses the doctor's own provider credentials (ADR-017); product scope and the approval boundary are unchanged.

### 2026-09-17 — Stage 3.2

- Scope change: patient payments for consultation, appointment and telemedicine fees, and doctor/clinic subscription payments to Hakeemify, enter MVP (ADR-019). Insurance, claims and full invoicing/ERP remain out of scope. The "Billing & Subscription" context is implemented as the `payments` context.
- Payment never blocks the manual clinical workflow; prepaid chamber and telemedicine bookings hold capacity without issuing a serial until payment is verified or staff waive it.
- The medicine catalog is imported from the Stage M dataset for dev/staging with an "Unverified catalog" indicator and free-text fallback; production import is gated (ADR-020).

---

# Source: README.md

# Architecture Package

This directory is the implementation-ready architecture baseline for the new Bangladesh-first Doctor Telemedicine and Patient Continuity Platform.

## Authority and scope

The design is based on `teardown/COMBINED-TECHNICAL-TEARDOWN.md`. The reference repositories are research inputs only. This package does not copy source code, fork a repository, or claim that any unverified reference behavior is production-ready.

The architecture separates observed evidence from new design:

- **Observed:** facts verified in the teardown.
- **Adopted pattern:** an architectural idea retained from a reference.
- **New design:** a product decision created for this platform.
- **Open question:** requires validation, provider selection, clinical review, or legal/regulatory research.

## Reading order

1. `PRODUCT-ARCHITECTURE-SPEC.md` defines product scope, bounded contexts, workflows, and MVP boundaries.
2. `SYSTEM-ARCHITECTURE.md` defines runtime components, deployment, synchronous/asynchronous boundaries, storage, and observability.
3. `DOMAIN-MODEL.md` defines domain entities and state machines.
4. `DATABASE-SPEC.md` turns the domain model into relational tables, constraints, indexes, and retention rules.
5. `API-SPEC.md` defines REST contracts and authorization boundaries.
6. `SECURITY-SPEC.md` defines identity, tenant isolation, PHI controls, audit, and operational security.
7. `COMMUNICATION-SPEC.md` defines WhatsApp/SMS/email/phone/video adapters and delivery semantics.
8. `AI-SPEC.md` defines assistive AI, provenance, approval, voice, and retrieval boundaries.
9. `MOBILE-SPEC.md` defines doctor and patient Android-first clients.
10. `BANGLADESH-LOCALIZATION-SPEC.md` defines phone, language, medicine, timezone, connectivity, and chamber localization.
11. `IMPLEMENTATION-ROADMAP.md` defines dependency-aware delivery phases and acceptance criteria.
12. `ARCHITECTURE-DECISIONS.md` records the major decisions and alternatives, with an index.
    - `ADR-013-hostinger-hosting.md` … `ADR-017-per-doctor-multi-provider-ai.md` (Stage 3.1) supersede parts of ADR-003, ADR-009 and ADR-010 and extend ADR-008. `ADR-018-zamanit-sms-otp.md`, `ADR-019-aamarpay-payments-mvp.md` and `ADR-020-medicine-dataset-import.md` (Stage 3.2) extend ADR-007 and supersede the billing-Future scope. Where an ADR and a specification disagree, the ADR wins; affected specifications carry a dated change log.
13. `TRACEABILITY-MATRIX.md` maps teardown findings to requirements, models, APIs, security controls, and phases.
14. `ARCHITECTURE-REVIEW.md` is the final consistency and risk review for this stage.

## Normative language

- **MUST:** required for the architecture baseline.
- **SHOULD:** recommended unless a documented decision changes it.
- **MAY:** optional and non-blocking.
- **MVP/V1/V2/Future:** delivery boundaries, not a promise of implementation in this stage.

## Product loop

`Patient identity -> booking or walk-in serial -> shared chamber queue -> consultation/encounter -> doctor-approved prescription and notes -> patient timeline -> follow-up serial`

Physical and remote patients use the same appointment, serial, encounter, timeline, and follow-up domains. The access channel changes; the clinical identity does not.

## Change log

### 2026-09-17 — Stage 3.1

- Added ADR-013…ADR-017 and change-log entries in SYSTEM-ARCHITECTURE, DATABASE-SPEC, API-SPEC, SECURITY-SPEC, AI-SPEC, DOMAIN-MODEL, BANGLADESH-LOCALIZATION-SPEC, IMPLEMENTATION-ROADMAP, COMMUNICATION-SPEC, MOBILE-SPEC, PRODUCT-ARCHITECTURE-SPEC, ARCHITECTURE-REVIEW and TRACEABILITY-MATRIX. Original specification text is not rewritten.

### 2026-09-17 — Stage 3.2

- Added ADR-018 (Zaman IT SMS/OTP), ADR-019 (aamarPay payments MVP; supersedes billing-Future) and ADR-020 (medicine dataset import), and Stage 3.2 change-log entries in SYSTEM-ARCHITECTURE, DATABASE-SPEC, API-SPEC, SECURITY-SPEC, COMMUNICATION-SPEC, PRODUCT-ARCHITECTURE-SPEC, BANGLADESH-LOCALIZATION-SPEC, DOMAIN-MODEL, MOBILE-SPEC, IMPLEMENTATION-ROADMAP, ARCHITECTURE-REVIEW and TRACEABILITY-MATRIX. Original specification text is not rewritten.

---

# Source: SECURITY-SPEC.md

# Security Specification

## 1. Security posture

This specification defines controls; it does not claim HIPAA, GDPR, Bangladesh, or other regulatory compliance. Legal, clinical, and regulatory research is required before production.

## 2. Authentication

- Use a managed identity boundary or a dedicated auth service behind an adapter.
- Support email/password where required, Bangladesh phone OTP, optional social identity, email verification, password reset, session listing, refresh-token rotation, and device/session revocation.
- Passwords MUST use a current slow password hash with per-password salt; plaintext and reversible encryption are prohibited.
- OTPs are short-lived, single-use, rate-limited, attempt-limited, and stored hashed or in a protected ephemeral store.
- Access tokens are short-lived and audience/issuer validated. Refresh tokens rotate and are invalidated on reuse or logout.
- Recovery changes require risk-based verification and audit events.

## 3. Authorization and tenant isolation

Authorization is enforced twice:

1. API/service policy checks actor role, tenant membership, clinic/chamber assignment, patient relationship, and action capability.
2. Data-access repositories require tenant context and reject queries without it.

Minimum roles:

- `tenant_owner`: tenant configuration and membership administration.
- `clinic_admin`: clinic/chamber/staff operations.
- `doctor`: assigned patient clinical care and prescription approval.
- `nurse`: permitted clinical support; no prescription approval by default.
- `receptionist`: patient registration, appointment, serial, and limited demographics.
- `patient`: own profile, appointments, serial status, shared documents, prescriptions, and timeline.
- `billing_manager`: billing-only permissions if billing enters scope.

Sensitive permissions are explicit: `patient.read`, `patient.write`, `encounter.read`, `note.write`, `diagnosis.write`, `prescription.approve`, `document.read`, `audit.read`, `export.create`, `queue.manage`, and `ai.review`.

Cross-tenant access tests are mandatory. Frontend filtering is never a security boundary.

## 4. PHI and data protection

- TLS for all network transport.
- Encryption at rest for database, backups, object storage, and job payloads where supported.
- Field-level encryption MAY protect especially sensitive identifiers; key management remains outside application source.
- Object files use private buckets, tenant/resource authorization, short-lived signed URLs, checksum validation, MIME allowlists, and malware-scan status.
- Do not put patient names, phone numbers, diagnoses, prescriptions, transcripts, document contents, access tokens, or signed URLs in ordinary logs.
- Support redacted support views and audited privileged access.

## 5. Audit

Create append-only audit events for:

- login, logout, OTP, reset, token/session changes;
- patient search, profile read, profile change, merge request/approval;
- appointment/serial creation, state changes, reorder, no-show, recall;
- encounter start/end, note/diagnosis/prescription writes and finalization;
- AI job, draft review, suggestion approval/rejection;
- document upload, download/signing, deletion/redaction;
- communication creation, provider delivery, retries, and consent changes;
- membership/permission changes, exports, billing actions, and security incidents.

Audit entries contain actor, tenant, action, resource, outcome, timestamp, request/correlation ID, and redacted metadata. Clinical finalization and approval records are immutable versions; correction creates a new version.

## 6. Files, backups, and deletion

- Files are accessed only through an authorization-aware application endpoint that issues a short-lived URL.
- Upload sessions are scoped to tenant, patient, category, expected MIME/size, and expiry.
- Database backups are encrypted, access-controlled, monitored, and restored in scheduled drills.
- Retention, deletion, legal holds, patient export, and data residency require Bangladesh-specific legal research. Implement policy configuration rather than hard-code an unverified duration.
- Deletion jobs produce audit records and do not erase immutable audit history unless a legally reviewed retention process says otherwise.

## 7. Abuse prevention

- Rate-limit OTP, login, password reset, patient search, upload-session creation, communication sends, AI jobs, and join-token issuance.
- Apply idempotency to serial issuance, appointment booking, communication creation, prescription rendering, and job enqueueing.
- Detect brute force, enumeration, unusual exports, high-volume document access, repeated delivery failures, and suspicious provider activity.
- Use CSRF protection for browser sessions, secure headers, input validation, output encoding, dependency scanning, secret scanning, and SAST/DAST in CI.

## 8. Provider and AI security

- Provider credentials live in a managed secret store and are never sent to clients.
- Provider adapters receive minimal data and use redacted references where possible.
- Consent and channel preference are checked before communication.
- AI input selection is explicit and logged. AI providers receive only the minimum necessary content under a reviewed data-processing arrangement.
- AI output is untrusted input. Schema validation, content limits, prompt-injection defenses, provenance, doctor review, and approval authorization are required.

## 9. Operational controls

- Security events have severity and response ownership.
- Maintain dependency SBOM/license review and vulnerability triage.
- Run authorization, tenant-isolation, upload-access, audit-integrity, backup-restore, and provider-failure tests in staging.
- Legal/regulatory research required before production includes phone/OTP practices, WhatsApp consent and messaging, medical record retention/export, telemedicine consent, prescription rules, payment handling, data residency, and AI clinical governance.

## Change log

### 2026-09-17 — Stage 3.1

- Signed URLs for documents are replaced by short-lived HMAC download tokens bound to user, tenant and document version, streamed through the API (ADR-016).
- Web sessions: in-memory access token plus `__Host-` refresh cookie with CSRF double-submit and Origin checks (ADR-013 §2).
- AI provider data handling is per credential: encoded data-use policy, tenant opt-in, doctor acknowledgement, patient consent and fail-closed minimization for providers that may train on inputs; provider production gates remain OPEN until reviewed (ADR-017). No compliance claim is made.
- Rate limits and OTP state are stored in MariaDB (ADR-015). Provider API keys are envelope-encrypted with `AI_CREDENTIAL_KEK` and never returned by any API (ADR-017).

### 2026-09-17 — Stage 3.2

- SMS: POST-only calls, no key in URLs, TLS verification never disabled, plain-HTTP production use only with an expiring owner decision (`GATE-SMS-HTTP`), no PHI in SMS text (ADR-018).
- Payments: server-computed amounts; callbacks and IPN are untrusted; an intent is paid only after a gateway Search Transaction match; gateway credentials never reach clients; aamarPay mobile SDKs are not used; platform collection of patient fees is gated pending legal/financial research (ADR-019).
- Provider credentials for SMS and payments are envelope-encrypted per tenant/doctor and never readable (ADR-018 §6). Platform operators authenticate with password + OTP and are audited per request.
- No legal, financial or regulatory compliance claim is made.

---

# Source: SYSTEM-ARCHITECTURE.md

# System Architecture

## 1. Recommended shape

Use a **modular monolith plus workers** for the first production architecture:

- One REST API application containing bounded-domain modules.
- One PostgreSQL database with strict tenant-scoped repositories and migrations.
- One object-storage abstraction for documents, PDFs, images, and audio.
- One job queue and worker process for rendering, delivery, notifications, AI processing, and scanning.
- Provider adapters for video, WhatsApp, SMS, email, phone, payments, and AI.
- Doctor and patient mobile clients; a web admin/staff client may use the same API.

This preserves transaction boundaries for serials, encounters, prescriptions, timelines, and follow-ups. Split a context into a service only after measured scale, ownership, or provider isolation justifies it.

## 2. Logical components

```text
Doctor App / Patient App / Staff Web
              |
        API Gateway / REST API
              |
  Identity | Tenant | Patient | Queue | Clinical | Communication | AI
              |
       PostgreSQL + Object Storage
              |
       Job Queue -> Worker Processes
              |
 Provider Adapters: Video, WhatsApp, SMS, Email, Phone, AI, Payment
```

The API is the only trusted application boundary for clinical mutations. Mobile clients do not write directly to the database or object store without an authorized upload-session flow.

## 3. Request paths

### Synchronous transaction

Use a database transaction for:

- patient identity creation/merge approval;
- appointment booking and cancellation;
- serial issuance and queue transitions;
- encounter start/end;
- prescription approval/finalization;
- follow-up creation;
- permission changes.

Return the committed resource and an idempotency result.

### Background job

Use a retryable job for:

- prescription PDF rendering;
- email/SMS/WhatsApp delivery;
- push notification fan-out;
- document malware scanning;
- audio upload processing;
- speech-to-text and clinical extraction;
- AI retrieval/index refresh;
- lab/document processing;
- retention and export packages.

Jobs MUST carry tenant ID, actor ID where applicable, resource ID, correlation ID, attempt count, and a redacted payload reference.

### Domain event

Publish an internal event after commit for timeline projection, notifications, audit enrichment, and search indexing. Domain events are not a replacement for the source transaction.

## 4. Data and storage

- PostgreSQL is the source of truth for structured data.
- Object storage holds encrypted-at-rest file objects. PostgreSQL stores metadata, ownership, checksum, MIME type, size, version, and storage key.
- A short-lived signed URL is issued only after resource authorization.
- Redis or equivalent may provide queue/job coordination, rate limiting, short-lived OTP/session state, and cache. It is not the clinical source of truth.
- Search may begin with PostgreSQL indexes/trigram/full-text search. Add a dedicated search engine only when measured requirements justify it.

## 5. Observability

- Structured application logs with correlation ID, tenant ID hash, actor ID hash, route, status, latency, and error class.
- Metrics for queue wait time, serial transition failures, encounter starts, delivery success/failure, job age, AI latency, upload failures, and database health.
- Tracing across API, database, object storage, provider adapter, and worker job.
- Security event stream for login anomalies, authorization denial, bulk export, permission changes, and suspicious delivery behavior.
- Redaction middleware MUST remove phone, email, patient name, medical text, tokens, signed URLs, and provider secrets from ordinary logs.

## 6. Deployment baseline

- Separate development, staging, and production environments.
- Private PostgreSQL and worker network; API ingress through TLS termination and WAF/rate limiting.
- Secrets from a managed secret store or environment injection, never committed config files.
- Automated database migrations with a rollback/forward-fix procedure.
- Encrypted backups, restore drills, retention policy, and deletion workflow.
- Health checks for API, database, queue, object storage, and each enabled provider adapter.

## 7. Scalability path

1. Modular monolith with one database.
2. Read replicas or reporting projections if timeline/report queries affect transactions.
3. Dedicated worker pools for communication, AI, and document processing.
4. Split high-volume provider or AI workloads only after load evidence.
5. Preserve domain event contracts and repository interfaces so extraction does not change API semantics.

## 8. Explicit non-decisions

- No reference repository is the implementation base.
- No Jitsi, Agora, mediasoup, WhatsApp, SMS, AI, or payment provider is selected by this document.
- No call recording is enabled by default.
- No regulatory compliance claim is made.

## Change log

### 2026-09-17 — Stage 3.1

- Hosting target is Hostinger Cloud Startup: separate `api`, `worker` and static `app` sites plus staging equivalents, idle-stop mitigated by a 1-minute cron keep-alive, no inbound WebSockets (ADR-013).
- The structured source of truth is **MariaDB** (10.6 feature floor) through Prisma, not PostgreSQL. PostgreSQL trigram/full-text search is replaced by indexed normalized-column prefix search (ADR-014).
- The "Redis or equivalent" coordination store is removed. Jobs, outbox dispatch, rate limits, OTP challenges and idempotency records live in MariaDB tables (ADR-015).
- Object storage is a port with S3-compatible and private-disk adapters. Downloads use short-lived HMAC tokens streamed through the API instead of provider presigned URLs (ADR-016).
- The "private database and worker network / WAF" deployment note is replaced by Hostinger managed TLS, application rate limits and token-protected internal endpoints (ADR-013).

### 2026-09-17 — Stage 3.2

- Providers selected: **Zaman IT** for SMS/OTP delivery (ADR-018) and **aamarPay** for payments (ADR-019). The "no SMS or payment provider is selected" statement no longer applies to those two; WhatsApp, email, push and video stay unselected.
- A `payments` bounded context (fees, merchant accounts, intents, verification, ledger, refunds, payouts, subscriptions) and a shared `secrets`/`provider-credentials` layer are added. Payments never touch clinical data (ADR-019).
- Production gates `GATE-SMS-HTTP` (plain-HTTP SMS API) and `GATE-PAY-PLATFORM-COLLECTION` (platform-held patient fees) are enforced at runtime (`docs/implementation/IMPLEMENTATION-REVIEW.md` §4).

---

# Source: TRACEABILITY-MATRIX.md

# Traceability Matrix

| Teardown finding | Product requirement | Architecture decision/domain | Database model | API/security | Phase |
|---|---|---|---|---|---|
| No reference has Bangladesh serial/chamber queue | Walk-in, advance, physical/remote shared queue | ADR-005; Serial & Queue | `chamber_days`, `serials`, `check_ins`, `queue_events` | Queue transition endpoints, concurrency/idempotency, queue audit | 3 |
| TPT has tenant-scoped EHR boundaries | SaaS tenant isolation and longitudinal records | ADR-004; Tenant/Patient/Clinical | `tenants`, memberships, patient/clinical tables | Service/repository tenant checks; cross-tenant tests | 1-2 |
| OpenEMR has mature relational clinical model | Structured clinical records and history | ADR-003/006; Clinical/Timeline | encounters, symptoms, diagnoses, prescriptions, labs, timeline | Source-linked history and PHI audit | 4-6 |
| HCW has consultation/media state patterns | Physical and remote consultation in one encounter | ADR-012; Encounter/Telemedicine | `encounters`, sessions, participants | Session token authorization, reconnect, no recording default | 4/8 |
| Medigo has patient/doctor mobile split | Android-first role-specific apps with shared primitives | ADR-011; Mobile | API-backed domain tables, upload status | OAuth/OTP, offline-safe outbox, no direct DB writes | 10 |
| Medigo stores free-text prescription/report artifacts | Structured searchable prescription and labs | ADR-003; Prescription/Lab | `prescriptions`, `prescription_items`, `lab_reports`, `lab_results` | Approval/finalization and versioning | 5 |
| No reference has verified AI/voice | Assistive draft only | ADR-008; AI | `ai_jobs`, transcripts, drafts, suggestions, approvals | Doctor-only approval, provenance, redacted logs | 9 |
| WhatsApp/SMS references are hooks, not verified workflows | Provider-neutral, consented, retryable delivery | ADR-007; Communication | `communications`, attempts, preferences | Adapter/webhook/idempotency contracts | 7-8 |
| No Bangladesh medicine catalog verified | Import-ready localized medicine search | New design; Localization/Medication | `medications`, aliases, dataset version | Search API with source/version and free-text fallback | 5/V1 |
| Low bandwidth/offline not proven | Android low-bandwidth and resumable workflow | ADR-009/011; Mobile/Storage | document/upload metadata and statuses | Resumable upload, stale queue labeling, audio fallback | 8/10 |
| OpenEMR GPL; Medigo/HCW rights unknown | New codebase with legal boundaries | ADR-001; all contexts | No copied schema/source | Dependency SBOM and legal review register | 0/11 |
| Audit maturity varies; Medigo lacks audit | Clinical and PHI access auditability | Security spec; Audit | `audit_logs`, immutable versions | Audit on read/write/approval/export/access | 1-12 |
| No reference proves local payments | Provider-neutral future payment support | New design; Billing | `billing_accounts`, `payment_intents` deferred | Adapter boundary, no provider commitment | Future |
| No regulatory conclusions in teardown | Research register before production | Security/localization/open questions | Policy/config tables, not invented rules | Legal/regulatory review gate | 11-12 |

## Coverage checks

- Serial engine: Product, Domain, Database, API, Mobile, Roadmap, ADR-005.
- Patient identity and deduplication: Product, Domain, Database, API, Security, Phase 2.
- Timeline: Product, Domain, Database, API, ADR-006, Phase 6.
- Consultation/encounter separation: Product, Domain, Database, API, Telemedicine, Phase 4/8.
- Prescription approval: Domain, Database, API, AI, Security, Phase 5/9.
- Provider-neutral communication: Communication, System, API, ADR-007, Phase 7/8.
- AI human approval: AI, Security, API, ADR-008, Traceability, Phase 9.
- Bangladesh localization: Localization, Mobile, Communication, Product, Roadmap, Phase 5/8/10.
- Licensing/uncertainty: README, Product, ADR-001, Security, roadmap gate.

## Change log

### 2026-09-17 — Stage 3.1

- Rows about the relational engine, the job queue and signed URLs map to ADR-014, ADR-015 and ADR-016 respectively; AI rows additionally map to ADR-017.

### 2026-09-17 — Stage 3.2

- The row "No reference proves local payments → provider-neutral future payment support (`billing_accounts`, `payment_intents` deferred)" is superseded by ADR-019: `payment_intents` and related tables are MVP behind `PaymentGatewayPort` with the aamarPay adapter. Communication rows map to ADR-018 for SMS; medication catalog rows map to ADR-020.
