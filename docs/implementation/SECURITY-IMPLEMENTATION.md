# Security Implementation Contract

**Stage 3.1 rewrite (2026-09-17).** **Stage 3.2 update (2026-09-17):** SMS transport risk, payment verification, provider credentials, platform operators and dataset import controls (T18–T32). **No compliance claim.** These are engineering controls. Legal and regulatory research gates remain open (`AI-PROVIDER-REGISTER.md` §4; Bangladesh research register).

## 1. Controls

| Area | Control |
|---|---|
| Identity | Argon2id; hashed OTP/reset/refresh tokens (HMAC with peppers); EdDSA JWT with `kid` rotation; refresh rotation and reuse detection; `token_version` revocation (AUTH-IMPLEMENTATION) |
| Web transport | `__Host-` httpOnly Secure cookies on `api.<domain>`; access token in memory; CSRF signed double-submit + Origin check on cookie endpoints; strict CORS allow-list; HSTS; CSP on web static host (ADR-013 §2) |
| Authorization | PolicyEngine (role map version + grants/denials); AssignmentPolicy (5 rules); PatientContextResolver (accounts/guardianship scope); repository tenant scoping; **composite tenant FKs** (ADR-014) |
| Data at rest | Hostinger disk encryption is **not assumed** (UNVERIFIED). Application-level encryption: AI credentials (envelope, ADR-017), patient identifier values (`PHI_FIELD_KEK`), push tokens (`PUSH_TOKEN_KEK`), backups (`BACKUP_ENCRYPTION_KEY`). Key IDs versioned; rotation jobs |
| Files | Private storage adapters only; short-lived HMAC download tokens; `nosniff`/attachment/sandbox CSP on downloads; baseline content-policy scanner with documented limits (ADR-016) |
| Append-only integrity | No triggers (host restriction); repository-level enforcement + lint + hash chains + daily verification (ADR-014) |
| Rate limiting | DB-backed limits on auth, OTP, search, upload sessions, download tokens, communications, AI job creation, AI credential creation, join tokens, cron/metrics endpoints |
| Internal endpoints | `INTERNAL_CRON_TOKEN`, `INTERNAL_METRICS_TOKEN`, `INTERNAL_DIAGNOSTICS_TOKEN`: ≥ 32 random bytes, distinct per environment, constant-time compare, rate-limited, never logged; tokens stored on the host in `chmod 600` files for cron |
| Secrets | hPanel environment variables (production/staging separate); `.env*` never committed; gitleaks in CI; startup validation fails closed in production; no secrets in web bundles or mobile apps |
| AI | Per-doctor credentials; secrets never readable; effective data-use policy from reviewed metadata; tenant opt-in + acknowledgement + consent + fail-closed minimization; raw media blocked for may-train; provider production gates (ADR-017) |
| Logging | Redaction (OBSERVABILITY §3); PHI-free job payloads and event payloads (CI tests) |
| Provider credentials (Stage 3.2) | SMS API keys and aamarPay store ID + signature key: platform ones in hPanel env only; tenant/doctor ones envelope-encrypted in `provider_credentials` (`PROVIDER_CREDENTIAL_KEK`, AAD-bound); write-only DTO fields; last-4 display; never in jobs, events, logs, audit metadata, idempotency snapshots, exports or client bundles |
| SMS transport (Stage 3.2) | POST form bodies only (no GET, key never in URLs); TLS verification never disabled; HTTPS mandatory once available; **plain-HTTP production use behind `GATE-SMS-HTTP`** (expiring owner decision); short OTP TTL (180 s), 5 attempts, resend limits; key rotation ≤ 90 days; balance-drop alert; no PHI in SMS templates (lint) |
| Payments (Stage 3.2) | Server-computed amounts; server-only gateway calls; callbacks and IPN untrusted; `PAID` only after Search Transaction match on status, `mer_txnid`, store, amount and currency with the intent's own merchant credentials; one open and one paid intent per business reference (generated uniques); append-only hash-chained ledger; `signature_key` redaction in URLs; no gateway SDK in mobile apps; platform collection of patient fees behind `GATE-PAY-PLATFORM-COLLECTION` |
| Platform operators (Stage 3.2) | Explicit per-operator permission subset; password + OTP per session; 30 min idle timeout; platform-chain audit of every request; no PHI routes; gate decisions only via CLI with DB access |
| Medication catalog (Stage 3.2) | Checksum and pinned schema-hash verification before writes; production import gated by four attestations + flag; catalog never used for dosing text |
| Supply chain | Exact pins + lockfiles; `pnpm audit --prod`; OSV-Scanner; SBOM (CycloneDX) on release; actions pinned by SHA |
| Backups | Encrypted app-level dumps off-site + plan backups; restore drills audited (DEPLOYMENT §6) |
| Migrations | Guarded by `GET_LOCK('hmedic:migrate:<env>')` + pre-migration encrypted dump; expand-only DDL (DEPLOYMENT §4) |

## 2. Threat-model tests (blocking in CI unless marked staging)

### 2.1 Carried forward

- UUID guessing and cross-tenant resource access (API and composite FK layers).
- Patient sees another patient's queue/timeline/document; guardian without scope; expired or PENDING guardianship.
- Staff approves a prescription outside assignment; nurse approves an AI suggestion.
- Replayed refresh token / OTP / reset token.
- Upload MIME spoofing; public object access; download-token expiry and reuse.
- Provider webhook forgery or duplicate.
- Prompt injection through document or transcript content (AI fixture).
- AI worker attempts a final clinical write (DI container resolution test).
- PHI leakage through errors, traces, job payloads, event payloads and support views.
- Brute-force OTP/login; bulk patient enumeration (rate limits, uniform responses).

### 2.2 Added in Stage 3.1

| # | Threat | Test |
|---|---|---|
| T1 | **API key exfiltration through logs** | Create a credential with synthetic keys shaped like real provider keys (`AIza` + 35 chars, `sk-` + 48 chars, `gsk_` + 52 chars, generic 40-char base64); drive create/validate/use/revoke/error paths; capture all pino output (API, worker, runner) → assert none of the key strings, last-8 substrings or base64 of the key appear |
| T2 | **…through errors** | Force the provider mock to echo the key in its error body → API error `ProblemDetails`, `ai_jobs.error_class/error_reason` and audit metadata contain no key material |
| T3 | **…through job payloads** | Assert `jobs.payload` and `dead_letters.payload` JSON for `ValidateAICredential`/`RunAIJob` contain only ids (schema test + DB scan for key strings) |
| T4 | **…through exports** | Tenant data export (when implemented) and `GET /doctors/*/ai/credentials` DTOs contain no `encryptedSecret`, `wrappedDataKey` or secret; the DTO schema forbids these fields; snapshot scan for key strings |
| T5 | **…through audit metadata** | `audit_logs.metadata` for all AI credential actions contains only `credentialId`, `providerCode`, `tier`, `secretLast4`, status |
| T6 | **Doctor A uses doctor B's credential** | `POST /encounters/{id}/ai/note-draft {credentialId: B's}` by doctor A → `FORBIDDEN`; direct handler invocation with mismatched `doctor_profile_id` → policy rejection; no provider call |
| T7 | **Clinic admin reads a doctor's secret** | Clinic admin **with** `ai.credentials.manage`: list/get/replace/revoke succeed; every response lacks secret fields; no route returns ciphertext or plaintext; attempting `?include=secret` → `VALIDATION_FAILED`; route enumeration test asserts no route maps to secret decryption for API callers |
| T8 | **Identifiers sent to may-train provider** | Free-tier (`MAY_TRAIN_OR_REVIEW`) credential with tenant opt-in, ack and consent; source note contains the synthetic patient name (Latin + Bangla + Banglish), phone (`+8801…`, `01…`, Bangla digits), NID-length digits, email, address fragment, exact dates, clinic and doctor names → the provider mock's captured request contains **none** of them; residual-leak variant (inject an unknown-format phone) → `PHI_MINIMIZATION_FAILED` with **zero** provider calls; missing opt-in / ack / consent each → zero calls |
| T9 | **Raw media to may-train provider** | Transcription or document-image request with a may-train credential → `POLICY_BLOCKED`, zero calls |
| T10 | **Cron endpoint without token** | `POST /internal/jobs/run` with no token, wrong token, token for the other environment, timing-varied tokens → 401; no job claimed; rate limit engages; the `/internal/metrics` and `/internal/diagnostics` equivalents behave the same |
| T11 | **Disk-adapter path traversal** | Keys with `../`, `..%2f`, absolute paths, null bytes, Unicode dot variants; a symlink planted inside the root pointing outside; part numbers out of range → all rejected; no file outside root is created or read (filesystem snapshot comparison) |
| T12 | **Direct access to storage paths** | Staging HOST-007 probe: HTTP GET of `/hmedic-storage/…`, `/../hmedic-storage/…`, `/.uploads/…` on all app and web domains → 404/403; MinIO: unsigned GET → 403; presigned URL after expiry → 403 |
| T13 | **Migration run by two deploys concurrently** | Start two `db:migrate:guarded` processes against one container with a slow synthetic migration → exactly one applies; the other waits then no-ops (`prisma migrate status` clean) or exits `MIGRATION_LOCKED` after `MIGRATION_LOCK_TIMEOUT_SECONDS`; one pre-migration dump recorded |
| T14 | KEK rotation | Re-encrypt job moves all rows to the new `key_id`; old KEK removal leaves no undecryptable active rows; wrong AAD fails decryption |
| T15 | Hash chain tampering | Direct SQL update of an `audit_logs`/`queue_events` row → `VerifyAppendOnlyChains` raises `INTEGRITY_CHAIN_BROKEN` |
| T16 | Provider production gate | `APP_ENV=production` + gemini metadata `productionGate: OPEN` → credential cannot become `ACTIVE`; `AI_FREE_TIER_PRODUCTION_GATE_CLOSED=false` forces `free_tier_ai_allowed=false` |
| T17 | CSRF | Refresh without header, with a mismatched cookie, or from a foreign `Origin` → `CSRF_FAILED`; bearer endpoints ignore cookies |

### 2.3 Added in Stage 3.2

| # | Threat | Test |
|---|---|---|
| T18 | **Forged payment success POST** | Mock scenario `forged_success_post`: POST to `/payments/aamarpay/return/{intentId}/success` with `status_code=2`, matching `mer_txnid` and amount, while the gateway has no record → intent stays `PENDING_VERIFICATION`; no ledger rows; `payment_callback_forgery_suspected_total` +1 when fields mismatch; same body to `/ipn` → no state change |
| T19 | **Amount-tampered callback** | Scenario `amount_mismatch` (gateway record amount ≠ intent) → `payment_verifications.result=MISMATCH`, `mismatch_fields=["amount"]`, intent not `PAID`, alert; a callback body with an altered `amount` but a correct gateway record → `PAID` at the **intent** amount only (body ignored) |
| T20 | **Callback for another tenant's intent** | Return URL with tenant B's intent id and tenant A's `mer_txnid` → `suspect_forgery`, verification uses intent B's merchant credentials and `tran_id` only, no change to either intent; IPN with an unknown `mer_txnid` → `unmatched`, 200 |
| T21 | **Replayed / duplicated IPN** | Scenario `duplicate_ipn` (3 deliveries, one before the return) plus concurrent return → exactly one `PAID` transition, one ledger posting, one `PaymentSucceeded`, one serial issued |
| T22 | **Signature key / API key leakage** | Synthetic merchant credentials (`sigkey_fake_<32 hex>`, store `store_fake_<8>`) and SMS keys (`zit_fake_<32 hex>`) driven through create/validate/initiate/search/send/balance/error paths; scan pino output, `ProblemDetails`, `jobs`/`dead_letters` payloads, `audit_logs.metadata`, `idempotency_records.response_snapshot`, `payment_*` rows, OpenAPI examples, the web `dist/` bundle and the Flutter build output → no key, no store ID beyond last 4; the Search Transaction URL appears nowhere |
| T23 | **Doctor reads another doctor's merchant credential** | Doctor A: list/get/validate/disable doctor B's merchant account → `FORBIDDEN`; no DTO for any role contains `storeId`/`signatureKey`; `?include=secret` → `VALIDATION_FAILED` |
| T24 | **Client-supplied amount** | `POST /payments/intents` with `amount`, `currency` or `storeId` in the body → `VALIDATION_FAILED`; with a valid body the intent amount equals the fee schedule even after the client edits the booking UI |
| T25 | **Expired intent paid late** | Scenario `late_success`: the job expires the intent and releases the hold; a later IPN verifies success → intent `PAID`, `late_payment=1`, `manual_review_status=OPEN`, the appointment is **not** silently re-booked without capacity; without a verified gateway record an expired intent never becomes `PAID` |
| T26 | **Platform collection gate** | `APP_ENV=production`, `PAYMENTS_PLATFORM_COLLECTION_ENABLED=true`, no/expired `GATE-PAY-PLATFORM-COLLECTION` decision → platform-merchant patient fee accounts `BLOCKED_BY_GATE`, intents `POLICY_BLOCKED`; subscriptions unaffected |
| T27 | **SMS key in URL / GET usage** | Adapter unit test with an HTTP interceptor: every Zaman IT call is `POST` with `application/x-www-form-urlencoded`; request URL has no query string; ESLint fixture using `method: 'GET'` or `?api_key=` in the adapter package fails lint; `NODE_TLS_REJECT_UNAUTHORIZED=0` at startup → process refuses to start |
| T28 | **SMS HTTP production gate** | `APP_ENV=production`, `ZAMANIT_BASE_URL=http://…`, no or expired `GATE-SMS-HTTP` decision → OTP delivery refused (`202` generic to the user, alert, zero provider calls); `ZAMANIT_ALLOW_INSECURE_HTTP=false` → refused even with a decision |
| T29 | **PHI in SMS** | Template lint rejects forbidden placeholders and words; rendering every template with synthetic data containing a diagnosis string in unrelated fields → rendered text contains none of it |
| T30 | **OTP duplicate / unknown outcome** | Mock `timeout_after_send` → zero automatic resends; the challenge stays `PENDING`; user resend creates a new challenge and supersedes the old; limits enforced |
| T31 | **Platform operator abuse** | Operator without a permission → `FORBIDDEN`; tenant membership granted a platform permission → rejected on write; request with both platform and tenant headers → `PLATFORM_CONTEXT_REQUIRED`; operator session without OTP → `FORBIDDEN`; platform routes return no PHI (response schema scan) |
| T32 | **Tampered medicine dataset** | Modified line in `medications.jsonl` → `MEDDATA_CHECKSUM_MISMATCH`, zero catalog writes; modified schema file with updated checksum file → `MEDDATA_SCHEMA_UNSUPPORTED`; production import without four attestations → `POLICY_BLOCKED` |

## 3. Security events and response

The security event stream is `audit_logs` rows with `action` in the security set:
- `AUTH_*_FAILED`, `REFRESH_REUSE`, `RATE_LIMIT_TRIPPED`;
- `AUTHZ_DENIED_ANOMALY`, `CROSS_TENANT_ATTEMPT`;
- `AI_CREDENTIAL_*`, `AI_POLICY_CHANGED`, `PHI_MINIMIZATION_FAILED`;
- `INTEGRITY_CHAIN_BROKEN`, `INTERNAL_TOKEN_REJECTED`;
- `BACKUP_FAILED`, `RESTORE_DRILL`;
- (Stage 3.2) `PAYMENT_CALLBACK_FORGERY_SUSPECTED`, `PAYMENT_VERIFICATION_MISMATCH`, `MERCHANT_CREDENTIAL_*`, `SMS_CREDENTIAL_*`, `SMS_HTTP_GATE_REFUSED`, `GATE_DECISION_RECORDED`, `PLATFORM_OPERATOR_GRANTED`/`_REVOKED`, `MEDDATA_IMPORT_REFUSED`, `MEDDATA_GATE_ATTESTED`.

Alerts are defined in `OBSERVABILITY.md` §5. Incident runbooks live in `infrastructure/hostinger/runbooks/` (Stage 4 OPS tasks).
