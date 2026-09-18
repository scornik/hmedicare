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
