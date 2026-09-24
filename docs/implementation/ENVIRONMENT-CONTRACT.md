# Environment Contract

**Stage 3.1 rewrite (2026-09-17).** **Stage 3.2 update (2026-09-17):** §4 (OTP delivery, platform operators, provider credential KEK), §6 rewritten (Zaman IT SMS, aamarPay payments), §6.3 medicine import, §10 removals. **All example values are placeholders such as `<ZAMANIT_API_KEY>`; no real credential appears in this document.**

- **Source of truth:** `packages/config/src/env.schema.ts` (Zod). Startup parses `process.env`, applies defaults, and **fails closed** in `staging`/`production` for missing required variables or disallowed values.
- **Where values live:**
  - production and staging: set in **hPanel** per Node.js app. They are injected into build and runtime; saving triggers a redeploy (HOSTING-VERIFICATION #12).
  - local: `.env.local` (ignored).
- `.env.example` lists names with safe local defaults only.

**Legend:**
- **REQ-PROD:** required in production **and** staging (distinct values per environment).
- **OPT:** optional, default shown.
- **LOCAL:** local/test only; refused, or ignored with a startup error, in staging/production.

Column **Apps** lists the Hostinger apps that need the variable (`api`, `worker`, `web` build).

## 1. Application and runtime

| Variable | Class | Apps | Default / format | Notes |
|---|---|---|---|---|
| `APP_ENV` | REQ-PROD | api, worker | `development`\|`test`\|`staging`\|`production` | |
| `APP_VERSION` | OPT | api, worker | git SHA from build | set by build script |
| `PORT` | REQ-PROD (set by Hostinger) | api, worker | — | bind `process.env.PORT` |
| `NODE_OPTIONS` | REQ-PROD | api, worker | prod api `--max-old-space-size=640`; prod worker `--max-old-space-size=448`; staging api `--max-old-space-size=256`; staging worker `--max-old-space-size=192`; local unset | ADR-013 §4; HOST-002 verifies it is honored |
| `API_PUBLIC_URL` | REQ-PROD | api, worker | `https://api.<domain>` | |
| `WEB_PUBLIC_URL` | REQ-PROD | api | `https://app.<domain>` | |
| `WORKER_PUBLIC_URL` | REQ-PROD | worker | `https://worker.<domain>` | |
| `CORS_ALLOWED_ORIGINS` | REQ-PROD | api | comma list; prod `https://app.<domain>` | no wildcard (startup check) |
| `TRUST_PROXY` | OPT | api, worker | empty (local); Hostinger proxy address/CIDR from HOST-013 | comma list of IPs, CIDRs or `loopback`|`linklocal`|`uniquelocal`; `X-Forwarded-For` is honored only when the immediate peer matches; empty = ignored. Replaces `TRUST_PROXY_HOPS`, which is refused at startup (Stage 5, audit C-48) |
| `DEFAULT_TIMEZONE` | OPT | api, worker | `Asia/Dhaka` | |
| `DEFAULT_LOCALE` | OPT | api, worker | `bn-BD` | |
| `LOG_LEVEL` | OPT | api, worker | `info` (prod), `debug` (staging/local) | |
| `LOG_HASH_PEPPER` | REQ-PROD | api, worker | 32 random bytes base64 | |
| `WEB_DIST_DIR` | OPT | api | — | DEPLOY-001 / ADR-023. Directory of the built web client. When set, this app serves it at `/` and the client is same-origin, so no CORS applies to it. **Use an absolute path:** the deployed process starts in the home directory, not the application root, so a relative path resolves elsewhere. A path with no `index.html` is logged as an error and the API keeps serving without the client, rather than refusing to start. Unset it to run an API-only app with the client hosted elsewhere |
| `PRE_MIGRATION_DUMP_DIR` | OPT | api, worker | `~/hmedic-db-dumps` | DEPLOY-002. Where the automatic pre-migration dump is written. Refused if it resolves inside the application directory, which the next deploy replaces |
| `REAL_PATIENT_DATA_ALLOWED` | OPT | api, worker | `false` | DEPLOY-004 gate. `true` only in production, and only once password recovery exists (D-18), the open HOST items are closed and a restore drill has been completed. Refused with `SMS_PROVIDER=mock`. Reported at `/health/ready` |
| `DIAGNOSTICS_ENABLED` | OPT | worker | `false` | `true` only during HOST tasks on staging |

## 2. Database and job runner

| Variable | Class | Apps | Default | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | REQ-PROD | api, worker | `mariadb://user:pass@localhost:3306/db` | separate DB user per environment |
| `DATABASE_POOL_MAX` | OPT | api, worker | prod api 12, prod worker 6, staging api 4, staging worker 3, local 10 | ADR-013 §5 budget |
| `DATABASE_POOL_MIN_IDLE` | OPT | api, worker | 1 | keep connections warm |
| `DATABASE_CONNECT_TIMEOUT_MS` / `DATABASE_ACQUIRE_TIMEOUT_MS` | OPT | api, worker | 10000 / 5000 | |
| `DB_LOCK_WAIT_TIMEOUT_SECONDS` | OPT | api, worker | 5 | per session |
| `DB_TX_RETRY_MAX` | OPT | api, worker | 3 | 1205/1213 retries |
| `JOB_RUNNER_MODE` | REQ-PROD | api, worker | prod api `off`; prod worker `worker`; local see LOCAL-DEVELOPMENT | `off`\|`worker`\|`embedded`\|`cron` (ADR-015 §7) |
| `JOB_CLAIM_STRATEGY` | OPT | worker (and api if embedded) | `skip_locked` | `conditional_update` fallback (HOST-003) |
| `JOB_RUNNER_MAX_CONCURRENCY` | OPT | worker | prod 2, staging 1 | |
| `JOB_POLL_INTERVAL_MS` / `JOB_POLL_MAX_INTERVAL_MS` | OPT | worker | 1000 / 5000 | |
| `JOB_CRON_BATCH_MAX` / `JOB_CRON_TIME_BUDGET_SECONDS` | OPT | worker | 25 / 45 | |
| `JOB_RETENTION_SUCCEEDED_DAYS` / `JOB_RETENTION_FAILED_DAYS` | OPT | worker | 14 / 90 | |
| `OUTBOX_RETENTION_DAYS` | OPT | worker | 30 | |
| `IDEMPOTENCY_TTL_HOURS` | OPT | api | 24 | |
| `INTERNAL_CRON_TOKEN` | REQ-PROD | worker (api if embedded/cron) | 32 random bytes | also written to the host cron header file |
| `INTERNAL_METRICS_TOKEN` | REQ-PROD | api, worker | 32 random bytes | |
| `INTERNAL_DIAGNOSTICS_TOKEN` | OPT | worker | 32 random bytes | required when `DIAGNOSTICS_ENABLED=true` |
| `MIGRATE_ON_STARTUP` | OPT | worker | `false` | fallback only if HOST-008 shows no DB access at build (DEPLOYMENT §4.3) |
| `MIGRATION_LOCK_TIMEOUT_SECONDS` | OPT | build script | 600 | |

## 3. Object storage and scanning

| Variable | Class | Apps | Default | Notes |
|---|---|---|---|---|
| `STORAGE_ADAPTER` | REQ-PROD | api, worker | `s3` local; staging `disk`; production `s3` (unless HOST-007 passes and disk is chosen) | ADR-016 |
| `STORAGE_DISK_ROOT` | REQ-PROD when `disk` | api, worker | e.g. `/home/<user>/hmedic-storage/staging` | absolute; outside web roots and `hbuilds` |
| `STORAGE_DISK_FORBIDDEN_ROOTS` | OPT | api, worker | `public_html,hbuilds` path fragments | startup check |
| `STORAGE_DISK_BUDGET_GB` | OPT | worker | 40 | alerts 60/75% |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | REQ-PROD when `s3` | api, worker | MinIO values locally | provider = external decision |
| `UPLOAD_PART_SIZE_BYTES` | OPT | api | 5242880 | max 8388608 |
| `UPLOAD_SESSION_TTL_MINUTES` | OPT | api | 60 | |
| `UPLOAD_ALLOWED_TYPES_JSON` / `UPLOAD_MAX_BYTES_JSON` | OPT | api, worker | FILE-STORAGE §3 defaults | |
| `DOWNLOAD_TOKEN_SECRET` | REQ-PROD | api | 32 random bytes | |
| `DOWNLOAD_TOKEN_TTL_SECONDS` | OPT | api | 60 | |
| `MALWARE_SCANNER` | REQ-PROD | worker | `mock` local; `baseline` staging/prod | `external` Future |
| `SCANNER_PDF_MAX_PAGES` | OPT | worker | 200 | |

## 4. Auth and crypto

| Variable | Class | Apps | Default | Notes |
|---|---|---|---|---|
| `JWT_ISSUER`, `JWT_AUDIENCE` | REQ-PROD | api | `https://api.<domain>`, `hmedic-api` | |
| `JWT_ACCESS_TTL_SECONDS` | OPT | api | 600 | |
| `JWT_SIGNING_KEY_ID`, `JWT_SIGNING_PRIVATE_KEY` | REQ-PROD | api | Ed25519 PKCS#8 PEM (newlines as `\n`) | |
| `JWT_VERIFICATION_KEYS` | REQ-PROD | api | JSON `{kid: publicPem}` | rotation |
| `REFRESH_TOKEN_PEPPER`, `OTP_PEPPER`, `RATE_LIMIT_PEPPER`, `CSRF_SECRET` | REQ-PROD | api (+worker for rate limits if used) | 32 random bytes each | |
| `SESSION_IDLE_TIMEOUT_HOURS_WEB` / `_MOBILE` | OPT | api | 12 / 720 | |
| `SESSION_ABSOLUTE_TIMEOUT_DAYS_WEB` / `_MOBILE` | OPT | api | 7 / 90 | |
| `ARGON2_MEMORY_KIB` / `ARGON2_TIME_COST` / `ARGON2_PARALLELISM` | OPT | api | 19456 / 2 / 1 | tuned at HOST-002 |
| `OTP_PROVIDER` | REQ-PROD | api | `mock` local/CI; `sms` staging (only during SMS-008) and production | `sms` routes OTP through `SmsOtpDelivery` → `SMS_PROVIDER` (ADR-018) |
| `OTP_TTL_SECONDS` | OPT | api | **180** (max 300) | shortened for the HTTP SMS transport risk |
| `PLATFORM_OPERATOR_SESSION_IDLE_MINUTES` | OPT | api | 30 | AUTH §2.6 |
| `PROVIDER_CREDENTIAL_KEK`, `PROVIDER_CREDENTIAL_KEK_ID` | REQ-PROD | api, worker | 32 random bytes base64 / e.g. `prod-k2026-09` | envelope KEK for `provider_credentials` (separate from `AI_CREDENTIAL_KEK`) |
| `PROVIDER_CREDENTIAL_KEK_PREVIOUS`, `PROVIDER_CREDENTIAL_KEK_PREVIOUS_ID` | OPT | api, worker | unset | only during rotation (`ReencryptProviderCredentials` job) |
| `PROVIDER_CREDENTIAL_FINGERPRINT_PEPPER` | REQ-PROD | api | 32 random bytes | duplicate detection |
| `SHORT_LINK_PEPPER` | REQ-PROD | api, worker | 32 random bytes | `communication_short_links.token_hash` |
| `AUTH_COOKIE_DEV_MODE` | LOCAL | api | `false` | non-`__Host-` cookie over HTTP; refused unless `APP_ENV=development` |
| `PHI_FIELD_KEK`, `PHI_FIELD_KEK_ID` | REQ-PROD | api, worker | 32 random bytes | patient identifiers |
| `PUSH_TOKEN_KEK`, `PUSH_TOKEN_KEK_ID` | REQ-PROD | api, worker | 32 random bytes | |

## 5. AI

| Variable | Class | Apps | Default | Notes |
|---|---|---|---|---|
| **`AI_CREDENTIAL_KEK`** | REQ-PROD | api, worker | 32 random bytes base64 | envelope KEK (ADR-017 §4) |
| **`AI_CREDENTIAL_KEK_ID`** | REQ-PROD | api, worker | e.g. `k2026-09` | |
| `AI_CREDENTIAL_KEK_PREVIOUS` / `AI_CREDENTIAL_KEK_PREVIOUS_ID` | OPT | api, worker | unset | only during rotation |
| `AI_CREDENTIAL_FINGERPRINT_PEPPER` | REQ-PROD | api | 32 random bytes | |
| `AI_ENABLED_PROVIDER_CODES` | REQ-PROD | api, worker | local/CI `mock`; staging `mock,gemini`; production empty until a register production gate closes | |
| **`AI_FREE_TIER_ALLOWED_DEFAULT`** | OPT | api | **`false`** | default for new tenant policies |
| `AI_FREE_TIER_PRODUCTION_GATE_CLOSED` | OPT | api, worker | `false` | may be `true` only after AIREG-001 closes (register) |
| **`AI_TRANSCRIPTION_ENABLED`** | OPT | api, worker | **`false`** | MVP |
| **`AI_PLATFORM_MANAGED_ENABLED`** | OPT | api, worker | **`false`** | designed, disabled |
| `AI_MAX_CONCURRENCY_PER_CREDENTIAL` | OPT | worker | 1 (max 4) | |
| `AI_PROVIDER_TIMEOUT_SECONDS` | OPT | worker | 60 | |
| `AI_RATE_LIMIT_MAX_WAIT_SECONDS` | OPT | worker | 900 | |
| `AI_MAX_FALLBACKS_PER_JOB` | OPT | worker | 1 | |
| `AI_SCHEMA_RETRY` | OPT | worker | 1 | |
| `AI_MAX_OUTPUT_BYTES` | OPT | worker | 65536 | |
| `AI_DRAFT_TTL_HOURS` / `AI_DRAFT_GRACE_HOURS_AFTER_COMPLETE` | OPT | worker | 72 / 24 | |
| `AI_CANCEL_ON_ENCOUNTER_COMPLETE` | OPT | api | `true` | |
| `AI_RETRIEVAL_DEFAULT_LOOKBACK_DAYS` / `AI_RETRIEVAL_MAX_LOOKBACK_DAYS` | OPT | worker | 730 / 3650 | |
| `AI_RETRIEVAL_DEFAULT_MAX_ITEMS` / `AI_RETRIEVAL_MAX_ITEMS` / `AI_RETRIEVAL_MAX_ITEMS_PER_SOURCE_TYPE` | OPT | worker | 20 / 50 / 10 | |
| `AI_RETRIEVAL_MAX_PROJECTION_LAG_SECONDS` | OPT | worker | 60 | |
| `AI_TERMS_MAX_AGE_DAYS` | OPT | api, worker | 180 | |
| `AI_PROVIDER_BASE_URL_OVERRIDE_<CODE>` | LOCAL | api, worker | unset | points adapters at `mock-providers`; refused outside development/test |

## 6. Communication, telemedicine, payments

### 6.1 Channels

| Variable | Class | Apps | Default | Notes |
|---|---|---|---|---|
| `SMS_PROVIDER` | REQ-PROD | api, worker | `mock` local/CI/staging; `zamanit` production | ADR-018 |
| `EMAIL_PROVIDER`, `WHATSAPP_PROVIDER`, `PUSH_PROVIDER`, `VIDEO_PROVIDER` | REQ-PROD | api, worker | `mock` | value `mock` is permitted in staging; production requires a selected provider for enabled channels or the channel disabled (external decisions) |
| `<PROVIDER>_API_KEY` / `<PROVIDER>_WEBHOOK_SECRET` | REQ-PROD when that provider is not `mock` | api, worker | — | email/WhatsApp/push/video only |

### 6.2 Zaman IT SMS (ADR-018; `ZAMANIT-VERIFICATION.md`)

| Variable | Class | Apps | Default / format | Notes |
|---|---|---|---|---|
| `ZAMANIT_BASE_URL` | REQ-PROD when `SMS_PROVIDER=zamanit` | api, worker | `http://103.89.240.228/api` (published; plain HTTP) → `https://<host>/api` once available | the adapter appends `/sendsms`, `/checkbalance`; `http://` in production requires `GATE-SMS-HTTP` |
| `ZAMANIT_API_KEY` | REQ-PROD when `zamanit` | api, worker | `<ZAMANIT_API_KEY>` | platform account; hPanel only; regeneration invalidates the old key immediately (runbook) |
| `ZAMANIT_API_KEY_ISSUED_ON` | REQ-PROD when `zamanit` | worker | `YYYY-MM-DD` | drives `sms_key_age_days` |
| `ZAMANIT_SENDER_ID` | REQ-PROD when `zamanit` | api, worker | `<ZAMANIT_SENDER_ID>` | from dashboard Messaging > Sender ID |
| `ZAMANIT_TIMEOUT_MS` | OPT | api, worker | 10000 | ZAMANIT-VER-14 |
| `ZAMANIT_ALLOW_INSECURE_HTTP` | OPT | api, worker | `false` | must be `true` for any `http://` base URL; production additionally needs the gate decision |
| `ZAMANIT_BALANCE_ALERT_BDT` | OPT | worker | `500.00` (business value to confirm) | platform threshold; tenant thresholds per credential |
| `ZAMANIT_BALANCE_DROP_ALERT_BDT_PER_HOUR` | OPT | worker | `200.00` | abuse detection |
| `ZAMANIT_BALANCE_CHECK_MINUTES` | OPT | worker | 60 | `CheckSmsBalance` |
| `ZAMANIT_KEY_MAX_AGE_DAYS` | OPT | worker | 90 | rotation alert |
| `ZAMANIT_MAX_CONCURRENCY` / `ZAMANIT_MAX_SENDS_PER_MINUTE` | OPT | worker | 2 / 30 | per credential |
| `ZAMANIT_PRICE_PER_SEGMENT_BDT` | OPT | worker | unset | spend estimate only (business config) |
| `SMS_BALANCE_RETRY_MAX_HOURS` | OPT | worker | 24 | |
| `ZAMANIT_LIVE_SMOKE` | LOCAL | test command | `false` | `true` only for SMS-008 on a developer machine or staging shell; the test aborts when `CI=true` |
| `ZAMANIT_LIVE_SMOKE_TO` | LOCAL | test command | `<DEVELOPER_PHONE_E164>` | never committed |

### 6.3 aamarPay payments (ADR-019; `PAYMENT-IMPLEMENTATION.md`; `AAMARPAY-VERIFICATION.md`)

| Variable | Class | Apps | Default / format | Notes |
|---|---|---|---|---|
| `PAYMENTS_ENABLED` | OPT | api, worker | `true` local/staging; production `false` until PAY-014 | |
| `PAYMENT_GATEWAY_ADAPTER` | REQ-PROD | api, worker | `mock` local/CI; `aamarpay` staging/production | |
| `AAMARPAY_ENV` | REQ-PROD when `aamarpay` | api, worker | `sandbox` staging; `live` production (startup check) | |
| `AAMARPAY_BASE_URL` | REQ-PROD when `aamarpay` | api, worker | `https://sandbox.aamarpay.com` / `https://secure.aamarpay.com` | must match `AAMARPAY_ENV` |
| `AAMARPAY_PLATFORM_STORE_ID` | REQ-PROD when `aamarpay` | api, worker | `<AAMARPAY_STORE_ID>` | local/staging: the **published sandbox** values, copied by a developer from the aamarPay sandbox-credentials page into `.env.local`/hPanel, never committed; production: live values from aamarPay support |
| `AAMARPAY_PLATFORM_SIGNATURE_KEY` | REQ-PROD when `aamarpay` | api, worker | `<AAMARPAY_SIGNATURE_KEY>` | same |
| `AAMARPAY_BASE_URL_OVERRIDE` | LOCAL | api, worker | unset | points the real adapter at `mock-providers`; refused outside `APP_ENV=development\|test` |
| `PAYMENT_RETURN_BASE_URL` | REQ-PROD | api | `https://app.<domain>` | result page and App/Universal Link host |
| `PAYMENT_INTENT_TTL_MINUTES` | OPT | api, worker | 30 | |
| `PAYMENT_HOLD_GRACE_MINUTES` | OPT | worker | 10 | |
| `PAYMENT_GATEWAY_TIMEOUT_MS` | OPT | api, worker | 10000 | |
| `PAYMENTS_PLATFORM_COLLECTION_ENABLED` | OPT | api, worker | **`false`** | production `true` requires `GATE-PAY-PLATFORM-COLLECTION` closed |
| `PAYMENT_PLATFORM_NOREPLY_EMAIL` | REQ-PROD | api | `no-reply@<domain>` | `cus_email` fallback (ADR-019 §5) |
| `PAYMENT_GATEWAY_FEE_BEARER_DEFAULT` | OPT | api | `DOCTOR` | business decision; per-tenant override |

### 6.4 Medicine dataset import (ADR-020)

| Variable | Class | Apps | Default | Notes |
|---|---|---|---|---|
| `MEDICATION_IMPORT_PRODUCTION_ALLOWED` | OPT | api, worker | **`false`** | production also needs four attestations |
| `MEDICATION_DATASET_STORAGE_PREFIX` | OPT | worker | `platform/medicine-datasets/` | |
| `MEDICATION_IMPORT_BATCH_SIZE` | — | — | 500 | **Not read from the environment.** Fixed as `IMPORT_BATCH_SIZE` in the importer: the value trades transaction size against lock duration, and the safe range is narrow enough that a deployment-time knob would mostly be a way to get it wrong |
| `MEDICATION_IMPORT_EXCLUDE_VETERINARY` | OPT | worker, CLI | `true` | |

## 7. Backups

| Variable | Class | Apps | Default |
|---|---|---|---|
| `BACKUP_DESTINATION` | REQ-PROD | worker | `mock` local; production external (decision) |
| `BACKUP_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY_ID` | REQ-PROD | worker | 32 random bytes |
| `BACKUP_DB_DUMP_CRON_UTC` | OPT | worker | `30 20 * * *` (02:30 Asia/Dhaka) |
| `BACKUP_RETENTION_DAILY` / `_WEEKLY` / `_MONTHLY` | OPT | worker | 14 / 8 / 12 |
| `BACKUP_DESTINATION_*` credentials | REQ-PROD when not mock | worker | — |

## 8. Observability

| Variable | Class | Apps | Default |
|---|---|---|---|
| `OTEL_ENABLED` | OPT | api, worker | `false` |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` | OPT (required if `OTEL_ENABLED`) | api, worker | — |

## 9. Web build (public only)

| Variable | Class | Default |
|---|---|---|
| `VITE_API_BASE_URL` | REQ-PROD | `https://api.<domain>/api/v1` |
| `VITE_APP_ENV` | REQ-PROD | `production`\|`staging` |
| `VITE_BUILD_ID` | OPT | git SHA |

The build refuses any `VITE_*` name matching `SECRET|KEY|TOKEN|PASSWORD`.

## 10. Removed (Stage 3 → 3.1)

`REDIS_URL`, `JOB_QUEUE_PREFIX`, `AI_PROVIDER`, `AI_API_KEY` (AI keys are per doctor and stored encrypted in the DB, never in environment variables), `S3_BUCKET_DOCUMENTS` (renamed `S3_BUCKET`), `METRICS_PORT` (metrics on the app port behind a token), `SENTRY_DSN` (no vendor SDK; OTLP optional), `SIGNED_URL_TTL_SECONDS` (replaced by `DOWNLOAD_TOKEN_TTL_SECONDS`), `OTP_SECRET` (replaced by `OTP_PEPPER`), `ARGON2_MEMORY_KB` (renamed `ARGON2_MEMORY_KIB`).

**Stage 3.1 → 3.2:** `PAYMENT_PROVIDER` (replaced by `PAYMENT_GATEWAY_ADAPTER` + `AAMARPAY_*`); generic `SMS_API_KEY`-style names for SMS (replaced by `ZAMANIT_*`).

## 11. Rules

- Production and staging values are never reused across environments (a startup check compares key-ID prefixes: `APP_ENV` embedded in `*_KEK_ID`).
- Mobile and web bundles receive public configuration only.
- Secrets never appear in logs, seed data, fixtures, CI output or generated API contracts.
- **Stage 3.2:** CI never receives `ZAMANIT_*` keys, `AAMARPAY_*` credentials (not even the published sandbox values) or `ZAMANIT_LIVE_SMOKE=true`. CI uses `SMS_PROVIDER=mock` and `PAYMENT_GATEWAY_ADAPTER=mock`.
- Rotation procedures: DEPLOYMENT §7.
