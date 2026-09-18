# Local Development Contract

**Stage 3.1 rewrite (2026-09-17).** There is no Redis and no PostgreSQL. The same engine series as production is used (ADR-014).

## 1. Prerequisites

- Node **24.21.0** (`.nvmrc`), Corepack enabled (`corepack enable`; pnpm 12.4.2 via `packageManager`).
- Docker with Compose v2.
- Optional for mobile: FVM plus the Flutter version pinned in `mobile/.fvmrc`, and the Android SDK.

## 2. Local services (`infrastructure/docker/compose.yaml`)

| Service | Image | Port | Purpose |
|---|---|---|---|
| `mariadb` | `mariadb:10.6@sha256:<pinned>` (the series moves with HOST-001) | 3306 → `127.0.0.1:3306` | app DB `hmedic_dev` + test DB template; user `hmedic_app` (non-root) |
| `minio` | `minio/minio@sha256:<pinned>` | 9000/9001 → localhost | S3 adapter only (private bucket `hmedic-dev`) |
| `mock-providers` | built from `infrastructure/docker/mock-providers/` (Node 24 image, in-repo code) | 4010 → localhost | Provider-shaped HTTP mocks: Gemini-compatible and OpenAI-compatible endpoints backed by `MockAIProvider` fixtures, SMS/email/WhatsApp/push/video mock webhooks, **(Stage 3.2)** a Zaman IT-shaped `/zamanit/api/sendsms` + `/zamanit/api/checkbalance` (POST only; scenario control), and an aamarPay-shaped `/aamarpay/jsonpost.php`, `/aamarpay/api/v1/trxcheck/request.php`, fake hosted payment page and IPN sender (PAYMENT-IMPLEMENTATION §10). Used by adapter integration tests and manual testing of real adapters against fake endpoints. **No real network calls** |

MariaDB configuration (`infrastructure/docker/mariadb/conf.d/hmedic.cnf`) mirrors production-relevant settings:
- `character-set-server=utf8mb4`
- `collation-server=utf8mb4_unicode_520_ci`
- `default-time-zone='+00:00'`
- `sql_mode=STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`
- `innodb_lock_wait_timeout=5`
- `max_connections=150`
- `max_user_connections=100` (production per-user limit)

The app user has no SUPER privilege, and triggers are not used anyway.

## 3. Root scripts (`package.json`)

| Script | Does |
|---|---|
| `pnpm install` | install (frozen lockfile in CI) |
| `pnpm infra:up` / `pnpm infra:down` / `pnpm infra:reset` | compose up (wait for healthchecks) / down / down -v |
| `pnpm db:migrate` | `prisma migrate deploy` via `db:migrate:guarded` (same lock path as production) |
| `pnpm db:migration:new <name>` | `prisma migrate dev --create-only` then `db:migration:normalize` |
| `pnpm db:migration:lint` | charset/collation/generated/CHECK/composite-FK/no-trigger checks |
| `pnpm db:seed` / `pnpm db:seed --verify` / `pnpm db:reset` | synthetic seed / assertions / drop + migrate + seed |
| `pnpm dev` | turbo: `apps/api` (watch), `apps/worker` (watch), `apps/web` (Vite) |
| `pnpm dev:api` / `pnpm dev:worker` / `pnpm dev:web` | individual processes |
| `pnpm contracts:generate` | OpenAPI 3.1 + 3.0 artifacts, TS client |
| `pnpm test` / `pnpm test:unit` / `pnpm test:integration` / `pnpm test:concurrency` / `pnpm test:security` / `pnpm test:e2e` | suites (Testcontainers starts its own MariaDB/MinIO unless `TEST_USE_COMPOSE=true`) |
| `pnpm lint` / `pnpm format` / `pnpm format:check` / `pnpm typecheck` / `pnpm depcruise` | quality |
| `pnpm build` | turbo build all |
| `pnpm mobile:bootstrap` / `pnpm mobile:generate-api` / `pnpm mobile:analyze` / `pnpm mobile:test` | shell into `mobile/` (Melos) |

A root `Makefile` is **optional** and may only wrap these scripts one-to-one (`make dev` → `pnpm dev`). No logic lives in `make`.

## 4. Runtime modes locally

| Variable | Default locally | Options |
|---|---|---|
| `JOB_RUNNER_MODE` | `embedded` in `apps/api` when running `pnpm dev:api` alone; `off` in api + `worker` in `apps/worker` when running `pnpm dev` | `off`, `worker`, `embedded`, `cron` |
| `JOB_CLAIM_STRATEGY` | `skip_locked` | `conditional_update` |
| `STORAGE_ADAPTER` | `s3` (MinIO) | `disk` (`STORAGE_DISK_ROOT=./.local/storage`, outside `apps/*/dist`) |
| `AI_ENABLED_PROVIDER_CODES` | `mock` | add `gemini`/`openai` **only** with `AI_PROVIDER_BASE_URL_OVERRIDE_<CODE>=http://localhost:4010/<code>` (mock-providers service) — never real keys in local `.env` |
| `APP_ENV` | `development` | |
| `SMS_PROVIDER` / `OTP_PROVIDER` | `mock` / `mock` | `zamanit` / `sms` only against `ZAMANIT_BASE_URL=http://localhost:4010/zamanit/api` (mock-providers), with fake keys |
| `PAYMENT_GATEWAY_ADAPTER` | `mock` | `aamarpay` with `AAMARPAY_BASE_URL_OVERRIDE=http://localhost:4010/aamarpay` (mock) **or** the real aamarPay sandbox with the published sandbox credentials set in `.env.local` by the developer (manual testing only) |

**Cron mode simulation:** `pnpm dev:cron` runs a tiny loop that `POST`s `/internal/jobs/run` every 60 s with the local cron token (to reproduce Hostinger mode 3 latency).

## 5. Workflow

1. `cp .env.example .env.local` (ignored). Local-only safe defaults; `pnpm secrets:generate-local` fills random local KEKs, peppers and tokens.
2. `pnpm infra:up`
3. `pnpm db:migrate && pnpm db:seed`
4. `pnpm dev`
5. Web at `http://localhost:5173` (API `http://localhost:3000/api/v1`; CORS allows the Vite origin locally; the refresh cookie uses `__Host-` only over HTTPS, so locally the cookie name is `hm_rt_dev`, `Secure=false`, `SameSite=Lax`, controlled by `AUTH_COOKIE_DEV_MODE=true`, which is refused when `APP_ENV` is not `development`).
6. `pnpm mobile:bootstrap` and run Flutter apps against `http://10.0.2.2:3000` (Android emulator).
7. `pnpm test`

No paid credentials, provider keys or real patient data are required or permitted.

**Stage 3.2 opt-in steps:**
- **Real medicine catalog (dev only):** `pnpm meddata:import --dir tools/medicine-data/dist/medicine-dataset-20260917-4 [--dry-run]`. It is read as data files, takes about 50k rows, and is refused when `APP_ENV=production`.
- **Return URLs:** the local return URL base is `http://localhost:3000/api/v1/payments/aamarpay/return/...`. The real aamarPay sandbox cannot reach localhost, so sandbox payment tests run on staging (PAY-014) or through a developer-run tunnel that is never committed.
- **Real SMS** is never sent locally except by the SMS-008 live smoke command (`ZAMANIT-VERIFICATION.md` §4).
