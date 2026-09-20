# Hosting Verification — Hostinger Cloud Startup

**Stage 3.1 (2026-09-17).** Evidence for ADR-013, ADR-014, ADR-015 and ADR-016.

## How to read this document

- **Documented facts** come from Hostinger's official product docs (`docs.hostinger.com`) and knowledge base (`hostinger.com/support`), read on 2026-09-17. Each item below has the source URL, page date and a status:
  - **VERIFIED:** an official source states it clearly.
  - **PARTIAL:** an official source exists but is ambiguous.
  - **UNVERIFIED:** no official source was found.
- **Engine behavior** was additionally proven by running probes against the official `mariadb:10.6` (10.6.28) and `mariadb:11.4` (11.4.13) Docker images (§3). That proves engine semantics only, **not** the Hostinger instance's version, privileges or limits.
- **Every item not VERIFIED on the real plan has a Stage 4 smoke test** (`HOST-001…HOST-013`, §5). HOST tasks run first in Stage 4. Database-dependent Foundation work may proceed on the defaults below, but is not final until HOST-001, HOST-003 and HOST-005 pass.

Quotes are short and verbatim as returned by the page reader. Re-check wording before relying on it contractually.

---

## 1. Summary

| # | Question | Result | Status | Default used by the blueprint | Fallback | Proven by |
|---|---|---|---|---|---|---|
| 1 | Database engine | **MariaDB** ("our Web and Cloud hosting plans use MariaDB") | VERIFIED | MariaDB via Prisma `mysql` provider + `@prisma/adapter-mariadb` | — | HOST-001 |
| 2 | Engine version | **MariaDB 11.8.9 on the plan** (HOST-001, 2026-09-20). Community reports had said 10.6.x | VERIFIED | Design targets the **MariaDB 10.6 feature set** (the floor); local/CI test `mariadb:10.6` and `mariadb:11.8`, the deployed series. `mariadb:11.4` dropped: neither floor nor production | — (no design change; 11.8 is a superset of the 10.6 feature set the design uses) | HOST-001 |
| 3 | `SELECT … FOR UPDATE SKIP LOCKED` | MariaDB ≥ 10.6. **Proven on 10.6.28 and 11.4.13**, but only when an index satisfies `ORDER BY`; with filesort every matched row stays locked (§3.2) | VERIFIED (engine) / UNVERIFIED (instance) | `JOB_CLAIM_STRATEGY=skip_locked` with a matching index | `conditional_update` claim (proven, §3.2) | HOST-003 |
| 4 | Enforced `CHECK` | MariaDB ≥ 10.2.1; proven (error 4025) | VERIFIED (engine) | VARCHAR + CHECK + app enum | App enum + repository validation (still tested) | HOST-003 |
| 5 | Generated columns + unique index | Proven PERSISTENT generated column + UNIQUE (NULLs allowed). **Source columns must be `VARCHAR`, not `CHAR`**: MariaDB rejects CHAR→VARCHAR expressions (error 1901, sql_mode-dependent padding) | VERIFIED (engine) | IDs stored as `VARCHAR(36)` ascii_bin | — | HOST-003 |
| 6 | `JSON` type | Alias for `LONGTEXT` with an automatic `JSON_VALID` CHECK (proven: error 4025 on invalid JSON) | VERIFIED (engine) | `JSON` columns + Zod validation on write/read | — | HOST-003 |
| 7 | Triggers / stored procedures | Import guide: SQL files must not contain "DEFINER or PROCEDURE, or TRIGGER"; SUPER needs a VPS. Privilege not stated | PARTIAL | **No triggers or procedures anywhere** (same behavior in every environment) | — | HOST-004 (informational) |
| 8 | `GET_LOCK()` | Standard function; proven on both images; no Hostinger restriction found | VERIFIED (engine) / UNVERIFIED (instance) | Singleton runner and migration lock | Lock row in `singleton_locks` with `SELECT … FOR UPDATE` + lease | HOST-004 |
| 9 | `utf8mb4` / `utf8mb4_0900_ai_ci` | utf8mb4 works (Bangla round-trip proven). `utf8mb4_0900_ai_ci` and `uca1400` **do not exist on 10.6** (error 1273); accepted on 11.4.13 | VERIFIED (engine) | `utf8mb4` + **`utf8mb4_unicode_520_ci`** tables; `ascii_bin` for ids/keys | — | HOST-001 |
| 10 | Per-user connection limit | KB limits table: "MySQL max connections per user: 100"; global 500; max query time 1800 s. An example error shows `max_connections_per_hour` = 500 (example, not a plan value) | VERIFIED / PARTIAL (per hour) | Connection budget ≤ 40 total (ADR-013 §5); long-lived pools | Reduce pools; if per-hour limit is real, keep processes warm | HOST-001 |
| 11 | DB count / size | 300 databases; **6 GB database size** (per DB vs total unclear) | VERIFIED / PARTIAL | Size alert at 4 GB total; migration signal at 5 GB | Move to VPS/managed DB (ADR-013 §7) | HOST-001 |
| 12 | Node.js on Cloud Startup | Supported; **10** Node.js apps; GitHub build-on-push or archive upload; env vars in dashboard, injected into build and runtime; saving triggers redeploy | VERIFIED | — | — | HOST-002 |
| 13 | Node.js versions | "18.x, 20.x, 22.x, 24.x" (22 default) | VERIFIED | **Node 24** pinned everywhere (Active LTS; maintenance from 2026-10-20; EOL 2028-04-30) | Node 22 (EOL 2027-04-30) | HOST-002 |
| 14 | Long-running process | "After a period without incoming traffic, your app's process is stopped automatically"; crashes auto-restart; apps must bind `process.env.PORT`. Idle period not documented; no non-HTTP process mode documented | VERIFIED (idle stop) / UNVERIFIED (duration) | Worker is an HTTP app kept warm by a 1-minute cron ping, which also runs a bounded job batch (ADR-015 mode 1+3 hybrid) | Pure cron-kick batches (mode 3) | HOST-005 |
| 15 | Memory limits per app | Not published; plan resources aggregated; hitting limits yields 503 | UNVERIFIED | `NODE_OPTIONS=--max-old-space-size` budget (ADR-013 §4) | Reduce staging footprint; migrate | HOST-005 |
| 16 | Cron jobs | Unlimited on Premium+; types "PHP" and "Custom" (any command); schedule in UTC. Min interval not stated (community: 1 min). `node` on cron PATH not documented | VERIFIED / PARTIAL / UNVERIFIED | 1-minute Custom cron: `curl -fsS -m 55 -X POST -H "Authorization: Bearer $TOKEN" https://worker.<domain>/internal/jobs/run` (token in a `chmod 600` file) | 5-minute interval (documented latency impact) | HOST-006 |
| 17 | Persistent private directory | `hbuilds/` and `public_html` "are overwritten on every deployment"; SSH restricted to home. A persistent writable dir outside those is **not documented** | UNVERIFIED | `STORAGE_ADAPTER=disk` only in staging (synthetic data); production requires the S3 adapter **or** HOST-007 passing | S3-compatible external storage | HOST-007 |
| 18 | Build step / migrations | Build command = an npm script name; 15 min install + 15 min build limits; package manager detected from lockfile (npm/yarn/pnpm); monorepo subfolders supported; "If a deployment fails, your existing live version stays in place." DB reachability during build not documented | VERIFIED / UNVERIFIED (DB at build) | `hostinger:build` npm script runs build, then guarded migration (DEPLOYMENT.md §4) | Guarded migration at worker startup before `listen()` | HOST-008 |
| 19 | Regions | Europe (FR, DE, LT, NL, UK), Asia (**India**, Indonesia, Malaysia), USA, Brazil; chosen at setup; changeable once per 30 days (IP changes). No Singapore | VERIFIED | **India** (closest listed to Bangladesh; latency unmeasured) | Malaysia/Indonesia after latency test | HOST-009 |
| 20 | Backups | Weekly (kept 6 weeks) and daily (kept 7 days) for Business tier and higher; files `.tar.gz` and DB `.sql.gz` downloadable; partial restores. Node builds/env vars coverage not documented | VERIFIED / UNVERIFIED | Plan backups + app-level encrypted off-site dumps (DEPLOYMENT.md §6) | — | HOST-010 |
| 21 | Outbound egress | "all outgoing ports are open, except 0 and 25"; cURL enabled | VERIFIED | HTTPS 443 to AI, SMS, email and storage providers; **no SMTP port 25** (email via provider HTTPS API or 587) | — | HOST-009 |
| 22 | Static front-end | "Vite on Hostinger is always static"; `vite build` → `dist`; free SSL on every domain and subdomain. SPA fallback and whether static sites count toward the 10 apps not documented | VERIFIED / UNVERIFIED | `app.<domain>` static Vite site; SPA fallback via `.htaccess` rewrite shipped in `dist` | Hash-based routing | HOST-012 |
| 23 | Runtime logs | Dashboard viewer of stdout/stderr, 5,000 lines, refreshed every 5 s, "latest deployment only — every redeploy starts a fresh log buffer"; build logs kept for last 10 builds; log file path differs between KB and docs | VERIFIED / PARTIAL | JSON logs to stdout; optional OTLP export (OBSERVABILITY.md) | — | HOST-011 |
| 24 | npm/SSH | npm runs automatically at deploy but "cannot be run through SSH"; SSH on Premium+ (port 65002) | VERIFIED | No operational task depends on running npm over SSH | — | HOST-002 |
| 25 | WebSockets / request timeout | "our Web and Cloud hosting plans only allow for outgoing connections via WebSocket"; Node request timeout not documented | VERIFIED / UNVERIFIED | **No inbound WebSockets.** Queue and job status use HTTP polling; requests stay short (< 30 s); uploads chunked | — | HOST-013 |
| 26 | Resources | 4 CPU, 4 GB RAM, 100 GB NVMe, 2M inodes, I/O 20,480 KB/s; usage "aggregated for all the websites on the hosting plan"; limits vary by purchase date (V1/V2/V3) | VERIFIED | Budgets in ADR-013 §4–§6 | — | HOST-005 |
| 27 | PostgreSQL/Redis/MongoDB | VPS only | VERIFIED | ADR-014 / ADR-015 | — | — |
| 28 | Remote MySQL | Available (allow-listed IPs or "Any Host", port 3306) | VERIFIED | **Not used** by the application (apps connect to `localhost`); never "Any Host" | Temporary single-IP allow-list for an operator restore drill only | HOST-010 |

---

## 2. Sources (official)

| Topic | URL | Page date |
|---|---|---|
| Node.js app creation, plans | https://docs.hostinger.com/node.js/creating-an-app | 2026-09-09 |
| Plan parameters and limits (apps, DB limits, connections) | https://www.hostinger.com/support/6976044-parameters-and-limits-of-hosting-plans-in-hostinger/ | 2026-09-15 |
| New Web/Cloud limits (V1/V2/V3) | https://www.hostinger.com/support/10717644-new-web-and-cloud-hosting-limits-at-hostinger/ | 2026-08-28 |
| Deploy Node.js website (versions, npm, failed deploy) | https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/ | 2026-09-15 |
| GitHub deployment | https://docs.hostinger.com/node.js/github | 2026-07-22 |
| Environment variables | https://docs.hostinger.com/node.js/environment-variables | 2026-07-22 |
| Build settings (npm script, limits, versions) | https://docs.hostinger.com/node.js/build-settings | 2026-08-17 |
| NestJS guide | https://docs.hostinger.com/node.js/overview-1/nest | 2026-07-21 |
| Node.js overview (idle stop, restart) | https://docs.hostinger.com/node.js/overview | 2026-08-17 |
| File structure (`hbuilds`, overwritten on deploy) | https://docs.hostinger.com/node.js/file-structure | 2026-09-09 |
| Deployments (latest two kept) | https://docs.hostinger.com/node.js/deployments | 2026-09-09 |
| Runtime logs | https://docs.hostinger.com/node.js/runtime-logs | 2026-07-22 |
| Vite (static) | https://docs.hostinger.com/node.js/overview-1/vite | 2026-07-22 |
| Supported databases (MariaDB; no PostgreSQL/Redis/MongoDB) | https://www.hostinger.com/support/which-databases-and-data-tools-are-supported-at-hostinger/ | 2026-08-05 |
| DBMS used (MariaDB) | https://www.hostinger.com/support/1583226-which-database-management-system-is-used-at-hostinger/ | 2026-08-05 |
| Database import restrictions (TRIGGER/PROCEDURE/SUPER) | https://www.hostinger.com/support/1864324-how-to-upload-and-set-up-your-database-at-hostinger | 2026-07-24 |
| Remote MySQL | https://www.hostinger.com/support/1583546-how-to-set-up-remote-mysql-access-in-hostinger/ | — |
| Cron jobs (count) | https://www.hostinger.com/support/1583765-how-many-cron-jobs-can-you-set-up-in-hostinger/ | 2026-08-10 |
| Cron jobs (types, UTC) | https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/ | 2026-08-10 |
| SSH access | https://www.hostinger.com/support/1583645-how-to-enable-ssh-access | 2026-09-15 |
| Server locations | https://www.hostinger.com/support/1583267-where-are-hostinger-servers-located/ | 2026-09-15 |
| Server transfer | https://www.hostinger.com/support/5577027-how-to-transfer-your-hosting-plan-to-a-different-server-in-hostinger/ | 2026-09-17 |
| Backups (download) | https://www.hostinger.com/support/5981435-how-to-download-backups-at-hostinger | 2026-09-15 |
| Backups (docs) | https://docs.hostinger.com/websites/backups | 2026-07-22 |
| Open ports | https://www.hostinger.com/support/1583736-what-ports-are-open-at-hostinger/ | 2026-08-03 |
| SSL | https://docs.hostinger.com/websites/ssl | 2026-07-21 |
| Web standards (WebSocket outgoing only) | https://www.hostinger.com/support/which-web-standards-and-connectivity-features-are-supported-at-hostinger/ | 2026-08-03 |
| Order usage aggregation | https://www.hostinger.com/support/2436138-how-to-check-order-usage-inside-my-hpanel | 2026-08-10 |
| Limits reached (503) | https://www.hostinger.com/support/1583532-what-to-do-if-your-hosting-plan-limits-are-reached-in-hostinger/ | — |

Engine documentation:
- MariaDB `FOR UPDATE … SKIP LOCKED` (10.6+): https://mariadb.com/docs/server/reference/sql-statements/data-manipulation/selecting-data/for-update
- Generated columns: https://mariadb.com/kb/en/generated-columns/
- JSON data type: https://mariadb.com/kb/en/json-data-type/
- `utf8mb4_0900_ai_ci` alias from 11.4.5: https://jira.mariadb.org/browse/MDEV-20912
- MariaDB community LTS lifecycle: https://mariadb.org/about/ (re-check, since the page reader returned inconsistent dates)

---

## 3. Engine probes (local Docker, 2026-09-17)

Images: `mariadb:10.6` → `10.6.28-MariaDB-ubu2204`; `mariadb:11.4` → `11.4.13-MariaDB-ubu2404`. Non-root application user. Scripts were run from the session scratchpad; the results below are reproduced in `packages/database/test/engine-contract/` during FOUND-004.

### 3.1 DDL and constraints

| Probe | 10.6.28 | 11.4.13 |
|---|---|---|
| `VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin` ids | ✓ | ✓ |
| Generated `active_patient_day_key VARCHAR(80) ascii_bin AS (IF(status IN ('BOOKED','WAITING') AND duplicate_override = 0, CONCAT(chamber_day_id, ':', patient_id), NULL)) PERSISTENT` + `UNIQUE` | ✓ duplicate active → 1062; override row allowed; inactive row allowed; re-activating an inactive duplicate → 1062 | ✓ same |
| Same expression with **`CHAR(36)`** source columns | ✗ **1901** (even `AS (a)`) | ✗ 1901 |
| Table-level `CONSTRAINT … CHECK (status IN (…))` | ✓ violation → 4025 | ✓ |
| Inline column-level named `CONSTRAINT … CHECK` | ✗ syntax error (use table-level) | ✗ |
| `JSON` column | `LONGTEXT` + auto CHECK `JSON_VALID`; invalid → 4025; `JSON_VALUE` works | same |
| `CREATE TRIGGER` as app user (local image) | ✓ (not representative of Hostinger; not used) | ✓ |
| `utf8mb4_0900_ai_ci` / `utf8mb4_uca1400_ai_ci` | ✗ 1273 unknown | ✓ |
| Bangla `রহিম উদ্দিন` round-trip, hex `E0A6B0E0A6B9…` | ✓ | ✓ |
| Case-insensitive match `'KARIM' = 'Karim'` under `utf8mb4_unicode_520_ci` | ✓ | ✓ |
| `DATETIME(3)` with session `time_zone='+00:00'`; `2026-09-16 18:30:00.123` UTC = local date `2026-09-17` (+06:00) | ✓ | ✓ |
| `@@tx_isolation` / `@@transaction_isolation` | `tx_isolation` only (use `SET SESSION TRANSACTION ISOLATION LEVEL …`) | both |
| `SET SESSION innodb_lock_wait_timeout=3` | ✓ | ✓ |

### 3.2 Locking and claiming

| Probe | 10.6.28 | 11.4.13 |
|---|---|---|
| `GET_LOCK('hmedic:job-runner:test',0)` / `IS_USED_LOCK` / `RELEASE_LOCK` | 1 / used / 1 | same |
| Lock wait on `SELECT … FOR UPDATE` with `innodb_lock_wait_timeout=1` | error **1205** | 1205 |
| SKIP LOCKED, index `(queue,status,priority,run_at)`, `ORDER BY priority, run_at LIMIT 2`, READ COMMITTED, two sessions | A = {5,1}, B = {2,3} ✓ (`EXPLAIN`: `ref`, `Using index`, no filesort) | same ✓ |
| SKIP LOCKED with index `(queue,status,run_at,priority)` and `ORDER BY priority, run_at` (filesort) | B = **∅** (A held locks on all matched rows) | B = ∅ |
| SKIP LOCKED plain `LIMIT 2` (no ORDER BY) | B = {3,4} ✓ | ✓ |
| Conditional update claim `UPDATE … WHERE id=? AND status='QUEUED'` twice | rows affected 1, then 0 ✓ | ✓ |

**Design consequences** (encoded in ADR-014, ADR-015 and `DATABASE-IMPLEMENTATION.md`):
1. All UUID and key columns are `VARCHAR(36)` ascii_bin, never `CHAR`.
2. CHECK constraints are table-level.
3. Every `SKIP LOCKED` claim query has an index whose column order satisfies equality predicates and then `ORDER BY` exactly. An `EXPLAIN` test fails the build if `Using filesort` appears for any claim query.
4. The collation is `utf8mb4_unicode_520_ci`.
5. Isolation is set with `SET SESSION TRANSACTION ISOLATION LEVEL` (or Prisma `isolationLevel`), never by reading `transaction_isolation`.
6. Error mapping: 1062 → unique conflict; 4025 → constraint violation; 1205/1213 → retryable `QUEUE_BUSY`.

---

## 4. Toolchain verification (local, 2026-09-17)

| Item | Result |
|---|---|
| Zod `3.25.76` + `@asteasolutions/zod-to-openapi` `7.3.4` | `OpenApiGeneratorV31` produced `openapi: 3.1.0` (nullable as `type: [..., "null"]`); `OpenApiGeneratorV3` produced `openapi: 3.0.3` (`nullable: true`) from the **same registry**. No separate downgrade tool is needed |
| Dart generator `swagger_parser` `1.44.3` (Dart SDK 3.12.2) with `json_serializable` + `retrofit`, `build_runner` | Generated client and models from the 3.0.3 document **and** from the 3.1.0 document; `dart analyze lib` → "No issues found!" for both. Sample schema: an enum, nullable fields, `date-time`, arrays, a `.strict()` request body, path params, an `Idempotency-Key` header, 201/409 responses, and a record type |
| Decision | Dart clients are generated from the **3.0 artifact** (the most-exercised path). The 3.1 input is kept as a CI smoke test so generator regressions are visible (`CI-CD.md`) |

---

## 5. Stage 4 smoke tests on the real plan (run before production; results appended here)

Each task produces a dated result row in this file, and the ADR defaults are updated through a Stage 4 audit row if the result differs.

| ID | Proves / disproves | Procedure (staging app on the real plan, synthetic data) | Pass criteria | If it fails |
|---|---|---|---|---|
| HOST-001 | Engine, version, limits | Deploy `apps/worker` staging, then call `/internal/diagnostics/db` (token-protected). It returns `SELECT VERSION()`, `@@max_user_connections`, `@@max_connections`, available collations (`SHOW COLLATION LIKE 'utf8mb4_unicode_520_ci'`), `@@sql_mode`, the current database size, and the result of opening 30 connections | MariaDB ≥ 10.6; collation available; ≥ 30 concurrent connections | < 10.6: set `conditional_update` and re-evaluate (10.5 lacks SKIP LOCKED); different limits: rebudget pools |
| HOST-002 | Node runtime | Select Node 24; deploy the monorepo `apps/api` from a subfolder with pnpm lockfile; the diagnostics endpoint reports `process.version`, `process.memoryUsage()`, `v8.getHeapStatistics().heap_size_limit` (proves `NODE_OPTIONS` honored), and loads `argon2` and `sharp` native modules | Node 24.x; heap limit matches budget; native modules load | Node 22; argon2 → `@node-rs/argon2`; sharp → reduced-assurance scanner mode (ADR-016) |
| HOST-003 | Engine contract on the instance | Run `pnpm --filter @hmedic/database test:engine-contract` against the staging DB (from the worker diagnostics runner): SKIP LOCKED two-connection claim, conditional claim, CHECK, generated unique, JSON, lock-wait timeout, READ COMMITTED | All pass | Switch `JOB_CLAIM_STRATEGY`; other failures block DB-dependent work (escalate as ADR) |
| HOST-004 | `GET_LOCK`, charset DDL, triggers (informational) | Diagnostics: `GET_LOCK` from two connections; `ALTER DATABASE … CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`; attempt `CREATE TRIGGER` on a scratch table then drop | GET_LOCK exclusive; ALTER permitted or DB already utf8mb4 | GET_LOCK fails: use `singleton_locks` row lease; ALTER denied: explicit table charsets suffice |
| HOST-005 | Process lifecycle and memory | Worker exposes `/health/live` with `uptimeSeconds` and `bootId`. Configure a 1-minute cron ping. Observe 24 h: count `bootId` changes; test with the cron disabled for 2 h to measure the idle-stop delay; induce a synthetic heap limit to observe crash-restart | Boot changes only on deploys/crashes while pinged; job lag p95 < 90 s | Pure cron-kick mode 3; document latency |
| HOST-006 | Cron | Create a Custom cron `curl … /internal/jobs/run` at `* * * * *`; verify interval from server logs; check `which node` via a cron writing to a private file | 1-minute interval honored; curl available | 5-minute interval: accept latency and increase batch size |
| HOST-007 | Persistent private directory | Create `~/hmedic-storage/staging/probe.bin` (random 1 MiB, SHA-256 recorded) from the app; redeploy twice; re-read and checksum; attempt HTTP fetch of every plausible public path; verify the path is outside `public_html` and `hbuilds` | File survives redeploys; checksum equal; never web-reachable | `STORAGE_ADAPTER=s3` required for production |
| HOST-008 | Build and migration | `hostinger:build` script: `pnpm build && pnpm db:migrate:guarded`. Test: (a) DB reachable during build; (b) a deliberately failing migration fails the deploy and the previous version keeps serving; (c) two deploys triggered back-to-back do not migrate concurrently (lock log) | (a)(b)(c) confirmed | DB unreachable at build: `MIGRATE_ON_STARTUP=true` on worker only (DEPLOYMENT.md §4.3) |
| HOST-009 | Region and egress | Plan in **India**; from Bangladesh test clients (Dhaka broadband and 4G), measure `GET /health/live` RTT p50/p95; from the app, HTTPS reachability of `generativelanguage.googleapis.com`, the chosen S3 endpoint, and SMS/email provider sandboxes | p95 RTT recorded; all egress OK | Compare Malaysia/Indonesia |
| HOST-010 | Backups and restore | Download the latest daily DB backup `.sql.gz` and the file backup; restore the DB into local `mariadb` Docker of the same series; verify row counts and checksums against a staging snapshot; confirm whether `~/hmedic-storage` is in the file backup | Restore succeeds; storage dir included (if disk adapter) | Rely on app-level off-site dumps (DEPLOYMENT.md §6) |
| HOST-011 | Logs | Emit JSON log lines incl. a synthetic API-key-shaped string; confirm viewer shows them, redaction applied, retention across redeploy (expected: reset) | Visible; redacted | Enable OTLP export |
| HOST-012 | Static web | Deploy `apps/web` to `app-staging.<domain>`: deep link `/patients/x` refresh works with `.htaccess` fallback; SSL valid; security headers from `.htaccess` present; check the app counter in hPanel | Deep links work; headers present | Hash routing; record app count |
| HOST-013 | HTTP limits | Upload a 8 MiB chunk to `PUT /documents/upload-sessions/{id}/parts/{n}`; stream a 50 MiB download; a 25 s request; CORS preflight from `app-staging`; confirm `X-Forwarded-Proto`/client IP headers | All succeed | Lower chunk size to 2 MiB; adjust timeouts |

### 5.1 Results

Recorded by `pnpm host:record-results` (dated, newest last). DB-dependent tasks stay PROVISIONAL in IMPLEMENTATION-STATUS until HOST-001, HOST-003 and HOST-005 are PASS.

| ID | Date | Result | Recorded by | Evidence |
|---|---|---|---|---|
| HOST-001 | 2026-09-20 | PASS | Ashik (Claude Code, SSH to the plan) | MariaDB 11.8.9-MariaDB-log (not the assumed 10.6). utf8mb4_unicode_520_ci available. max_connections=2000, max_user_connections=100, wait_timeout=300. 30/30 concurrent connections opened. Default isolation READ-COMMITTED, innodb_lock_wait_timeout=50. Server sql_mode=NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION (not strict); the session init sets STRICT_TRANS_TABLES and +00:00, both accepted. Run against the app schema (empty) because HOST_PROBE_DATABASE_URL points there; no dedicated probe database exists yet. |
| HOST-003 | 2026-09-20 | PASS | Ashik (Claude Code, SSH to the plan) | All engine-contract checks pass on the instance. SKIP LOCKED: two READ COMMITTED sessions claimed disjoint rows (1,2 vs 3,4). Conditional-update claim: 1 row. CHECK enforced: error 4025. PERSISTENT generated column + UNIQUE: error 1062 on the second ACTIVE. JSON accepted valid and rejected invalid with error 4025 (constraint named probe_jobs.doc, confirming LONGTEXT+JSON_VALID). Lock wait: error 1205 at innodb_lock_wait_timeout=1. Bangla utf8mb4 round trip exact. JOB_CLAIM_STRATEGY=skip_locked stands. |
| HOST-004 | 2026-09-20 | PASS | Ashik (Claude Code, SSH to the plan) | GET_LOCK is exclusive across connections: holder returned 1, a second session with timeout 0 returned 0. ALTER DATABASE ... CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci permitted. CREATE TRIGGER permitted (informational; the design uses no triggers or procedures). Singleton runner and migration lock can use GET_LOCK as designed; the singleton_locks lease fallback is not needed. |