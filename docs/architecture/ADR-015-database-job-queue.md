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
