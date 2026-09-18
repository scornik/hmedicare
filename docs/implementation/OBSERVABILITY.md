# Observability Contract

**Stage 3.1 rewrite (2026-09-17).** Hostinger constraints: no vendor agent install; runtime logs visible in the hPanel viewer (latest deployment only, 5,000 lines, reset on redeploy; HOSTING-VERIFICATION #23).

**Stage 3.2 update (2026-09-17):** SMS and payment redaction patterns, metrics and alerts; medicine import metrics.

## 1. Correlation

- Every request has a `requestId` (the inbound `X-Request-ID` if it is a valid UUID, otherwise a new UUIDv7), echoed in responses and `ProblemDetails`. Jobs have a `jobId`, events an `eventId`, provider calls a `providerRequestIdHash`.
- `correlationId` and `causationId` flow across API → transaction → outbox → job → adapter → webhook.
- The pino child logger binds `requestId`/`jobId`, `correlationId`, `tenantHash` (HMAC of tenant id with `LOG_HASH_PEPPER`) and `actorHash`.

## 2. Logs

- **Format:** JSON to **stdout** (pino), one line per event. Fields: `time`, `level`, `msg`, `app` (`api`/`worker`), `env`, `bootId`, `version`, `requestId`/`jobId`, `correlationId`, `route` (template, not raw path), `method`, `status`, `latencyMs`, `tenantHash`, `actorHash`, `resourceType`, `resourceId` (UUID only), `errorClass`, `queue`, `jobType`, `attempt`.
- **Levels:** production `info`, staging `debug` (still redacted).
- **On Hostinger** the runtime log viewer shows stdout/stderr for the latest deployment only. Because of that, (a) security-relevant events are **also** persisted in `audit_logs`, and (b) optional **OTLP log export** (`OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` from hPanel env) ships the same redacted records to an external collector. The endpoint and provider are an external decision, and exports use outbound HTTPS 443 (HOST-011).
- Never log request or response bodies. Exception stacks are logged with messages passed through redaction.

## 3. Redaction

`packages/observability/src/redaction.ts` applies to logs, trace attributes, error messages, job/event payload logging and audit metadata.

1. **Key-based removal** (case-insensitive path match): `authorization`, `cookie`, `set-cookie`, `password`, `otp`, `code`, `token`, `refreshToken`, `accessToken`, `csrfToken`, `secret`, `apiKey`, `api_key`, `encryptedSecret`, `wrappedDataKey`, `signature_key`, `signatureKey`, `store_id`, `storeId`, `paymentUrl`, `payment_url`, `cus_name`, `cus_email`, `cus_phone`, `cardnumber`, `card_number`, `card_holder`, `bank_txn`, `bank_trxid`, `approval_code`, `ip_address`, `smsText`, `messageBody` (SMS text; the adapter never passes the provider form field `message` to a logger), `otpCode`, `phone`, `email`, `name`, `legalName`, `displayName`, `address`, `dateOfBirth`, `nid`, `identifier`, `note`, `chiefComplaint`, `history`, `examination`, `assessment`, `plan`, `diagnosis`, `instructions`, `transcript`, `content`, `prompt`, `messages`, `output`, `signedUrl`, `downloadToken`, `url` (query stripped).
2. **Value-pattern scrubbing** (applied to every string after key removal):

   | Pattern | Regex |
   |---|---|
   | Google API keys | `AIza[0-9A-Za-z_\-]{35}` |
   | OpenAI-style keys | `sk-(proj-)?[A-Za-z0-9_\-]{20,}` |
   | Groq keys | `gsk_[A-Za-z0-9]{20,}` |
   | Anthropic-style keys | `sk-ant-[A-Za-z0-9_\-]{20,}` |
   | OpenRouter keys | `sk-or-(v1-)?[A-Za-z0-9]{20,}` |
   | Bearer tokens | `(?i)bearer\s+[A-Za-z0-9._\-~+/]+=*` |
   | JWTs | `eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+` |
   | Generic high-entropy strings | `[A-Za-z0-9+/_\-]{32,}={0,2}`, but only in fields not on the id allow-list |
   | Bangladesh phones | `(\+?88)?0?1[3-9][0-9]{8}` (after Bangla-digit normalization) |
   | Emails | email regex |
   | NID-length digit runs | 10, 13 or 17 digits |
   | URL query strings | stripped |
   | Form/query key-value secrets (Stage 3.2) | `(?i)(api_key\|signature_key\|store_id)=[^&\s"']+` → key kept, value redacted (covers Zaman IT bodies and the aamarPay Search Transaction URL in error messages and stack traces) |
   | aamarPay payment URLs | `https://(sandbox\|secure)\.aamarpay\.com/paynow\.php\?track=[A-Za-z0-9]+` |
   | Synthetic test key shapes | `zit_fake_[0-9a-f]{32}`, `sigkey_fake_[0-9a-f]{32}` (T22) |

   Matches are replaced with `[REDACTED:<kind>]`.
3. **Allow-listed** id fields (UUIDv7, error codes, enums) pass through.

**Tests** (`observability/test/redaction.spec.ts`, plus SECURITY T1–T5): each provider key pattern (synthetic), Bangla digits phone, nested objects and arrays, `Error` objects with key material in the message, pino serializer integration, and a performance budget (< 0.2 ms per typical log line).

## 4. Metrics

- **Endpoint:** `GET /internal/metrics` on api and worker, protected by `Bearer INTERNAL_METRICS_TOKEN`, in Prometheus text exposition format (`prom-client@15.1.3`, pinned at FOUND-008).
- **Collection:** no scraper runs on Hostinger. Metrics are pulled by an external monitor (external decision), or pushed as OTLP metrics when `OTEL_ENABLED=true`.

| Metric | Type | Labels |
|---|---|---|
| `http_requests_total`, `http_request_duration_seconds` | counter/histogram | `app`, `route`, `method`, `status_class` |
| `db_pool_in_use`, `db_pool_wait_seconds` | gauge/histogram | `app` |
| `db_tx_retries_total`, `db_tx_retry_exhausted_total` | counter | `context`, `mysql_errno` |
| `queue_serial_issue_duration_seconds` | histogram | — |
| `queue_conflicts_total` | counter | `code` (`STALE_VERSION`/`QUEUE_STATE_CONFLICT`/`QUEUE_VERSION_CONFLICT`/`DUPLICATE_ACTIVE_SERIAL`) |
| **`job_lag_seconds`** | gauge | `queue` (now − oldest `QUEUED` `run_at`) |
| `jobs_claimed_total`, `jobs_completed_total`, `jobs_failed_total`, `jobs_dead_total` | counter | `queue`, `type`, `error_class` |
| `outbox_publish_lag_seconds` | gauge | — |
| `runner_heartbeat_timestamp_seconds` | gauge | `app`, `mode` |
| **`ai_jobs_total`** | counter | `provider_code`, `tier`, `status`, `error_class` |
| **`ai_provider_errors_total`** | counter | `provider_code`, `error_class` (`INVALID_CREDENTIAL`/`RATE_LIMITED`/`QUOTA_EXHAUSTED`/`MODEL_UNAVAILABLE`/`CONTENT_BLOCKED`/`SCHEMA_INVALID`/`TIMEOUT`/`PROVIDER_ERROR`/`PHI_MINIMIZATION_FAILED`/`POLICY_BLOCKED`/`AI_CREDENTIAL_REVOKED`) |
| **`ai_credentials_by_status`** | gauge | `provider_code`, `tier`, `status` (tenant-aggregated; no doctor ids) |
| `ai_provider_latency_seconds` | histogram | `provider_code` |
| `ai_minimization_categories_total` | counter | `category` |
| `ai_terms_verification_age_days` | gauge | `provider_code`, `tier` |
| `storage_upload_failures_total`, `storage_scan_rejections_total` | counter | `adapter`, `reason` |
| `storage_disk_used_bytes`, `storage_disk_budget_bytes`, `plan_disk_free_bytes` | gauge | — |
| `integrity_chain_verification_failures_total` | counter | `chain_type` |
| `backup_last_success_timestamp_seconds` | gauge | `kind` |
| `process_resident_memory_bytes`, `nodejs_heap_size_used_bytes` | gauge | `app` |
| `rate_limit_tripped_total` | counter | `scope` |
| **`sms_send_total`** (Stage 3.2) | counter | `provider`, `purpose` (`OTP`/`TRANSACTIONAL`), `outcome` (`ACCEPTED`/`REJECTED`/`PROVIDER_UNAVAILABLE`/`UNKNOWN_OUTCOME`), `error_class` (`INVALID_CREDENTIAL`/`SENDER_ID_INVALID`/`INVALID_REQUEST`/`DESTINATION_UNSUPPORTED`/`INSUFFICIENT_BALANCE`/`INVALID_DESTINATION_FORMAT`/none), `credential_scope` |
| `sms_segments_estimated_total` | counter | `encoding`, `credential_scope` |
| **`otp_delivery_total`** | counter | `outcome` (unknown-outcome rate = `UNKNOWN_OUTCOME` / all) |
| `sms_provider_latency_seconds` | histogram | `provider`, `operation` (`send`/`balance`) |
| **`sms_balance_bdt`** | gauge | `credential_scope` (`platform`; tenant balances aggregated count below threshold only) |
| `sms_credentials_below_threshold` | gauge | — |
| `sms_key_age_days` | gauge | `credential_scope=platform` |
| **`payment_verification_duration_seconds`** | histogram | `trigger`, `result` |
| **`payment_verification_mismatch_total`** | counter | `field` (`amount`/`store_id`/`mer_txnid`/`currency`/`currency_merchant`) |
| **`payment_callback_forgery_suspected_total`** | counter | `source` (`RETURN_*`/`IPN`) |
| `payment_intents_total` | counter | `purpose`, `merchant_mode`, `status` (terminal transitions) |
| `payment_intents_open` | gauge | `status` (`REDIRECTED`/`PENDING_VERIFICATION`) |
| `payment_gateway_errors_total` | counter | `operation` (`initiate`/`search`), `class` |
| `payment_late_success_total`, `payment_manual_review_open` | counter/gauge | `merchant_mode` |
| `payment_ipn_unmatched_total` | counter | — |
| `medication_import_rows_total` | counter | `file`, `result` (`inserted`/`updated`/`unchanged`/`deactivated`/`excluded_veterinary`/`rejected_*`) |
| `medication_import_duration_seconds` | histogram | `execution_path` |

No metric label contains PHI, tenant names or doctor names.

## 5. Tracing and alerts

- **Tracing:** OpenTelemetry spans (when `OTEL_ENABLED`) for HTTP, Prisma queries (no statement parameters), job execution, storage calls and provider calls. Span attributes pass through redaction.

**Alerts** (evaluated by the external monitor; thresholds in `infrastructure/monitoring/alerts.yaml`):

| Alert | Condition |
|---|---|
| API down | `/health/ready` non-200 for 3 min |
| Worker stalled | `runner_heartbeat_timestamp_seconds` older than 180 s, or `job_lag_seconds{queue="notifications"}` p95 > 90 s for 10 min |
| Dead letters growing | `jobs_dead_total` increase > 10 in 1 h |
| DB saturation | pool wait p95 > 200 ms 5 min; any `db_tx_retry_exhausted_total` spike |
| Memory | RSS > 85% of app ceiling (ADR-013 §4) for 10 min |
| Disk | storage > 75% budget; plan free disk < 20% |
| AI provider errors | `QUOTA_EXHAUSTED`/`INVALID_CREDENTIAL` rate spike per provider (information for support); `PHI_MINIMIZATION_FAILED` > 0 (review template/input) |
| Integrity | `integrity_chain_verification_failures_total` > 0 (critical) |
| Backups | no successful DB dump in 26 h (critical) |
| Security | refresh reuse, internal token rejections > 20 per 10 min, cross-tenant attempts |
| Terms age | `ai_terms_verification_age_days` > 180 (warning) |
| SMS balance (Stage 3.2) | platform `sms_balance_bdt` < `ZAMANIT_BALANCE_ALERT_BDT` (warning; critical at 25%); drop > `ZAMANIT_BALANCE_DROP_ALERT_BDT_PER_HOUR` beyond the estimate (possible key abuse, critical) |
| SMS errors | any `INVALID_CREDENTIAL` or `SENDER_ID_INVALID` (critical for platform scope); `INVALID_REQUEST`/`INVALID_DESTINATION_FORMAT` > 0 (bug); `otp_delivery_total{outcome="UNKNOWN_OUTCOME"}` rate > 5% over 30 min |
| SMS key age | `sms_key_age_days` > `ZAMANIT_KEY_MAX_AGE_DAYS` (warning) |
| SMS HTTP gate | gate decision expires in < 14 days (warning); `SMS_HTTP_GATE_REFUSED` > 0 (critical) |
| Payments | `payment_verification_mismatch_total` > 0 (critical); `payment_callback_forgery_suspected_total` > 3 in 1 h (security); `payment_intents_open{status="PENDING_VERIFICATION"}` older than 30 min > 0 (worker/reconciliation stalled); `payment_manual_review_open` > 0 for 24 h; `job_lag_seconds{queue="payments"}` p95 > 120 s |
| Medicine import | import `FAILED` or `REFUSED` (info to operator) |

Support views are redacted, and access to them is audited.
