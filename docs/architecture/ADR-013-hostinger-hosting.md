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
