# Communication Implementation Contract

**Stage 3.1 update (2026-09-17).**
- Delivery runs on the MariaDB job queue (ADR-015); Redis is not used.
- OTP delivery is synchronous (AUTH-IMPLEMENTATION).
- No inbound WebSockets (ADR-013).
- Tables: `DATABASE-IMPLEMENTATION.md` migration 0012.

**Stage 3.2 update (2026-09-17).** **Zaman IT** is the first real SMS adapter (ADR-018; evidence `ZAMANIT-VERIFICATION.md`). SMS contract: §6.

## 1. Ports

```ts
interface CommunicationProvider {
  send(input: SendCommunicationInput): Promise<ProviderSendResult>;
  verifyWebhook(input: WebhookInput): Promise<ProviderReceipt | null>;
  mapStatus(input: ProviderStatus): NormalizedDeliveryStatus;
}

interface WhatsAppProvider extends CommunicationProvider {}
// SMS uses the dedicated SmsProvider port (ADR-018 §1), not CommunicationProvider:
// send(credential, destination, text, purpose, correlationId) / checkBalance(credential)
interface EmailProvider extends CommunicationProvider {}
interface PushProvider extends CommunicationProvider {}
interface PhoneProvider {
  createCallIntent(input: CallIntentInput): Promise<CallIntentResult>;
}
interface TelemedicineProvider {
  createSession(input: CreateSessionInput): Promise<ProviderSession>;
  issueParticipantToken(input: IssueTokenInput): Promise<ParticipantToken>;
  endSession(input: EndSessionInput): Promise<void>;
  recordParticipantEvent(input: ParticipantEventInput): Promise<void>;
}
```

- Interfaces live in `packages/communication/src/application/ports`.
- Concrete SDKs and HTTP calls live only in `packages/communication-adapters/*` (dependency-cruiser enforced).
- Mock adapters are mandatory for local development and CI.

## 2. Worker behavior

- A `CommunicationDeliveryRequested` outbox event becomes a job on queue `notifications`, with concurrency key `communication:<communicationId>`.
- The job payload holds ids only: no phone numbers, message text or PHI.
- The job handler `DeliverCommunication` (worker only):
  1. Loads the communication and re-checks current consent and preferences.
  2. Selects the adapter and inserts a `communication_attempts` row in a short transaction.
  3. Calls the provider **outside** any database transaction.
  4. Maps the response, then commits status and receipt with `expectedRowVersion`.
- **Transient errors** use ADR-015 backoff. Provider rate-limit signals reschedule the job as `WAITING_RATE_LIMIT` with the provider's retry hint.
- **Permanent errors** set `FAILED` and may enqueue an authorized fallback channel as a new communication intent.
- **Duplicate job execution** after a lease expiry is harmless: the attempt row is unique on `(tenant_id, communication_id, attempt_number)`, and the adapter receives an idempotency key derived from it where the provider supports one.
- **OTP messages are not queued.** They are sent synchronously after the OTP challenge commits, so a stalled worker cannot block login.

## 3. Mock behavior

- Mock providers support these deterministic scenarios:
  - success;
  - transient failure;
  - permanent failure;
  - rate-limit;
  - delivery receipt;
  - duplicate webhook.
- They never send external messages and use synthetic provider ids.
- In local development they run inside the `mock-providers` compose service.

## 4. Webhooks

- Provider webhooks arrive at the **api** app over HTTPS (`POST /webhooks/{providerAdapter}`).
- The route authenticates the signature and deduplicates the provider event id in `provider_webhook_events` (UNIQUE `(provider_adapter, provider_event_id)`).
- It maps the status to a communication attempt and writes an audit event.
- Webhook handlers do not directly alter appointments, serials, prescriptions or encounters.

## 5. No provider commitment

- **SMS:** Zaman IT is selected (ADR-018). Its production use over plain HTTP is behind `GATE-SMS-HTTP`.
- **Other channels:** WhatsApp, email, push and video providers remain external decisions.
- **Mocks first:** every adapter proves its contract with mocks before live use.
- **Egress:** outbound provider hosts must be reachable from the Hostinger plan (HOST-009 egress check; SMS-002 for the Zaman IT IP on port 80).

## 6. SMS (Zaman IT, ADR-018)

### 6.1 Credential selection

| Purpose | Credential |
|---|---|
| OTP (identity-access, synchronous) | always `PLATFORM_ACCOUNT` (env) |
| Tenant transactional SMS | the tenant's `ACTIVE` `provider_credentials` row (`provider_kind=SMS`) if one exists; otherwise `PLATFORM_ACCOUNT` |

- A credential in `SUSPENDED_BALANCE`, `INVALID`, `DISABLED` or `REVOKED` is **not** silently replaced by the platform account. The communication is rescheduled (balance) or fails with the class shown to tenant staff. This avoids charging Hakeemify for a tenant that chose its own account.
- `ProviderCredentialVault.resolveForAdapter` returns an in-process handle. The plaintext key exists only inside the adapter call and is never passed to job payloads.

### 6.2 Delivery job rules

- **Concurrency and rate:** concurrency key `sms:<credentialScope>:<credentialId|platform>` with limit `ZAMANIT_MAX_CONCURRENCY` (2), plus the rate limit `ZAMANIT_MAX_SENDS_PER_MINUTE` (30) per credential via `rate_limit_counters`. When over the limit, the job goes to `WAITING_RATE_LIMIT` (ADR-015).
- **Before calling the adapter:**
  - the template is rendered (§6.3) and its placeholder lint is re-checked at runtime;
  - the destination is the patient's verified contact, converted by the adapter (`8801XXXXXXXXX`).
- **Outcome mapping (ADR-018 §4):**

| Adapter outcome | Attempt `status` | Communication | Retry |
|---|---|---|---|
| `ACCEPTED` | `SENT` | `SENT` (terminal; `DELIVERED` only if a DLR source is later verified, ZAMANIT-VER-04) | — |
| `REJECTED` (`INVALID_CREDENTIAL`, `SENDER_ID_INVALID`, `INVALID_REQUEST`, `INVALID_DESTINATION_FORMAT`) | `FAILED` | `FAILED` | no |
| `REJECTED` (`DESTINATION_UNSUPPORTED`) | `FAILED` | `FAILED`, then a fallback intent if consent and preferences allow | no |
| `REJECTED` (`INSUFFICIENT_BALANCE`) | `FAILED` | `RETRY_SCHEDULED` with `run_at` = next balance check; credential `SUSPENDED_BALANCE` | after reactivation, max `SMS_BALANCE_RETRY_MAX_HOURS` (24), then `FAILED` |
| `PROVIDER_UNAVAILABLE` | `FAILED` | `RETRY_SCHEDULED` | ADR-015 backoff, max 5 attempts |
| `UNKNOWN_OUTCOME` | `UNKNOWN` | first time: `RETRY_SCHEDULED` (one retry; next attempt `possible_duplicate=1`); second time: `SENT` with `outcome_class=UNKNOWN_OUTCOME` (no further retry) | at most 1 |

- `communication_attempts.status` gains `UNKNOWN`. Metrics: `sms_send_total{outcome,error_class,credential_scope}`.
- **Bulk and campaign sends do not exist** (no route, no job type).

### 6.3 Templates

- **Location:** `packages/communication/src/templates/sms/<key>.<bn-BD|en-BD>.v<n>.txt`, registered in `templates/sms/index.ts` with `maxSegments`.
- **Template keys (MVP):** `otp_login`, `otp_phone_verify`, `serial_called`, `serial_near`, `appointment_reminder`, `appointment_confirmed`, `appointment_cancelled`, `payment_received`, `payment_link` (staff-assisted payment; short link to `PAYMENT_INTENT`).
- **Allowed placeholders:** `{appName}`, `{otpCode}`, `{otpMinutes}`, `{serialNumber}`, `{localTime}`, `{localDate}`, `{clinicSmsName}`, `{shortLink}`.
- **CI checks:**
  - no other placeholder;
  - no forbidden words list (diagnos*, prescri*, medicine names from the synthetic catalog, lab, test result, and Bangla equivalents);
  - the longest rendering fits `maxSegments` (OTP: 1).
- **`{clinicSmsName}`** = `clinics.sms_display_name`, falling back to `clinics.name`.
- **Short links** (`communication_short_links`): 22-char random token (base62), HMAC-stored, TTL per template (default 7 days), login required, no PHI in the URL.

### 6.4 Balance and credentials

- **`CheckSmsBalance`** (maintenance, singleton, every `ZAMANIT_BALANCE_CHECK_MINUTES`): ADR-018 §7. It writes `sms_balance_snapshots` and emits `SmsBalanceLow` (payload: credential scope, credential id or `platform`, threshold crossed; **no amount**).
- **Routes:**
  - `GET/POST/DELETE /tenant/sms-credentials` (`sms.credentials.manage`): POST body `{apiKey, senderId, balanceAlertBdt?}` (the `apiKey` is write-only); DELETE revokes;
  - `POST /tenant/sms-credentials/{id}/validate` runs `checkbalance` (free);
  - `GET /tenant/sms-credentials/{id}/balance` shows the latest snapshot.
- `GET /platform/sms/balance` (platform permission `ops.sms.read`) returns the platform account's latest snapshots, a 30-day trend, and the daily spend estimate labelled "estimate".

### 6.5 Tests

- **Mock and contract:** every row of §6.2; POST-only form encoding; key absent from URL, logs, attempt rows, jobs and dead letters; phone conversion (`+8801711…` → `8801711…`; `01711…`, `+91…` and Bangla digits unnormalized → rejected before the call); encoding selection (English, Bangla, emoji → unicode, GSM extension characters); segment estimates at the boundaries (160/161, 70/71, 153×2 +1); balance parsing including `UNPARSED`.
- **Duplicate safety:** an OTP `UNKNOWN_OUTCOME` produces zero automatic resends; a transactional `UNKNOWN_OUTCOME` produces exactly one retry, flagged `possible_duplicate`.
- **Gate:** `APP_ENV=production` + `http://` base URL + no gate decision → OTP delivery refused, alert; with an expired decision → refused.
- **Live smoke:** SMS-008 only (`ZAMANIT-VERIFICATION.md` §4). It is never in CI.

## Provider mock foundation (2026-10-10, local)

CommunicationProvider and channel-specific email/WhatsApp/push ports are now exported from the communication context. The mock adapter package implements deterministic acceptance, transient failure, permanent failure and rate limiting. Accepted attempts replay by tenant/idempotency key; changed inputs are rejected and caller mutation cannot change the stored result. Mocks retain only input hashes and synthetic responses, never destinations or rendered text.

Receipts authenticate the exact raw body with HMAC-SHA256 and constant-time comparison, bound payload size and reject malformed/unknown fields. Duplicate receipts return the same event identity so the future webhook repository can enforce its unique key. This verifies adapter behavior only: database deduplication, receipt status transitions, API webhook routes, compose-service wiring and real provider selection remain open. No queue, consent enforcement or external delivery is enabled by this foundation. SMS and synchronous OTP continue using their existing dedicated port.

## Queued follow-up delivery core (2026-10-10)

Section 0012 now creates communications, attempts, effective preferences, append-only provider webhook events and the short-link foundation. Telemedicine is reserved separately in 0022 (C-59); existing applied migrations remain untouched. Provider event/message IDs are opaque external identifiers, explicitly exempt from the UUID length lint while remaining ascii_bin. A webhook payload hash protects immutable receipt identity.

The API embedded/cron runner and standalone worker register DeliverCommunication on notifications. In non-production they also scan up to 100 due follow-up tasks every minute, selecting email first and WhatsApp only when email was suppressed before sending. Every channel requires live consent and a verified active contact; OPT_IN does not grant consent. Worker consent/contact/preference checks use the patient owner's port; plan/task/date/withdrawal checks use the follow-up owner. Tasks are consumed with a row-version condition. Moving a consumed reminder to a later date creates new work. No real provider is selected for this path; production scanning and mock webhook acceptance are disabled.

Intents and their request event commit together. Attempts are inserted in a short transaction before provider I/O, which runs outside the transaction. A lost response or overlapping lease reuses the same attempt key. Accepted mock message IDs are derived from tenant/attempt identity so restarts cannot collide. Transient errors retry up to five failures, rate limits use the existing WAITING_RATE_LIMIT path, and permanent failures stop. Repeated unresolved provider exceptions finish with an UNKNOWN attempt and a failed intent rather than claiming acceptance. Row-version checks discard stale completions.

Signed webhooks verify original raw request bytes, deduplicate on adapter/event identity and advance delivery/read state monotonically. A late failure only changes SENT, never DELIVERED/READ. An early unmapped receipt can be replayed without editing its append-only ledger. Invalid/changed signatures are rejected; no provider body, destination or clinical prose is persisted in jobs, audit or timeline metadata. Current webhook adapters are mocks only and are disabled in production.

API: GET patients/{id}/communications (latest 50 safe summaries), GET/PUT patients/{id}/communication-preferences, POST webhooks/communication/{providerAdapter}. Patient context requires VIEW_RECORDS for reads and GIVE_CONSENT for guardian preference changes; staff use communication.read/send. PUT repeats preserve the same effective preference row. Writes/read summaries are audited with the actor. OpenAPI and TypeScript/Dart clients contain 135 operations. Communication timeline anchors inherit source encounter withdrawal masking.

Remaining COM/SMS work: remaining transactional SMS business triggers and account settings UI; short-link generation/resolution; authorized failure fallback; other business notification triggers; in-app/push delivery; native communication UI; external email/WhatsApp/push selection and compose mock-service wiring. The short-link table alone does not enable public links. H-7 still covers native-speaker review of Bangla. This core sends only in-process mock notifications.

The web patient page now shows delivery status and channel preferences, gated by communication.read/send. Records and controls clear on authorization failure. SMS templates cover eight transactional purposes in both locales, with pinned versions, content checks and segment budgets. A tested SMS outcome policy defines one retry after unknown outcome, duplicate-risk flags, bounded provider-unavailable retries and 24-hour balance suspension. These SMS rules are not yet connected to queued delivery.
Transactional SMS account selection now lives in the credential owner. It selects the latest tenant-owned Zaman IT account, including blocked or revoked rows, and returns PLATFORM_ACCOUNT only when no tenant account has ever been configured. A replacement pending validation blocks an older active handle. Tenant secret handles recheck selection, status and row version immediately before decrypting. This port is not yet connected to transactional SMS jobs. OTP account selection remains unchanged.

Worker recovery now marks an intent FAILED when its provider is no longer configured. No attempt is invented for an unsent intent; an existing SENDING attempt becomes UNKNOWN because its earlier request may have been accepted. The status change, audit and outbox event commit together and terminal replay makes no duplicate event.
## Transactional follow-up SMS worker (2026-10-10)

Follow-up intent creation, consent/preferences and verified PHONE contact resolution now support sms. Non-production scanners select from configured email/WhatsApp channels, then SMS when earlier channels are suppressed before sending. The DeliverCommunication dispatcher enqueues DeliverTransactionalSms with only communication/account identifiers, a pinned tenant/platform account and sms:<scope>:<credentialId|platform> concurrency key. Platform composition enforces ZAMANIT_MAX_CONCURRENCY; a DB-backed hashed credential counter enforces ZAMANIT_MAX_SENDS_PER_MINUTE. Production scanning and this new SMS composition remain disabled pending release enablement. Existing synchronous OTP behavior is unchanged.

Before every paid send the worker reloads live consent, minimum policy version, preferences, verified contact, plan and source encounter eligibility. Text uses the intent's pinned template version and locale, segment budget and content checks. Provider I/O runs outside the preparation transaction. Attempts persist scope/account, normalized outcome, encoding, estimated segments and possible_duplicate, with privacy-safe audit/outbox and send metrics. Acceptance means SENT; no delivery receipt is fabricated. Mock message IDs use attempt identity so process restarts cannot collide.

SMS has no provider idempotency guarantee: the first unknown permits exactly one retry, flagged possible_duplicate. A second unknown ends with the documented SENT/UNKNOWN combination; the attempt remains explicitly uncertain. The allowed retry does not expand into further retries on provider-unavailable or balance rejection. Unavailable sends otherwise stop after five failures. A lost/aborted worker's SENDING attempt waits four minutes before becoming UNKNOWN and using that same single-retry allowance. Stale completions cannot overwrite a newer communication version.

Insufficient balance suspends tenant credentials and uses rate-limit waits without blind resends. A resumed/platform account must pass a free parsed positive balance check before another send; unresolved balance expires after 24 hours. Invalid credentials/sender IDs invalidate tenant accounts. Pending, disabled, revoked or replaced accounts fail rather than use the platform. Short links are not generated yet: the generic reminder asks the recipient to log in and includes no patient name, clinical details or target URL.

Still open: other transactional SMS triggers, short-link generation and authenticated resolution, authorized channel failure fallback, SMS account-management UI, external email/WhatsApp/push adapters, native notification/follow-up screens and production enablement. SMS-006/007 are not declared fully complete by this follow-up increment.
## Tenant SMS account settings (2026-10-10)

Tenant owners with sms.credentials.manage can add an encrypted Zaman IT key, list masked account metadata, validate it with a free balance check, read the latest balance and revoke it. Validation joins the status, snapshot and audit in one transaction after provider I/O; a changed version or concurrent revocation rejects the result. Unparsed balances never activate a pending account. Free validation leaves sender-ID verification unchanged and sends no SMS. Repeated revocation preserves the secret tombstone.

The web settings page clears the key immediately on submission, never stores it in browser storage, and clears account records after an authorization failure. The platform balance endpoint requires the existing operator context, permission and authentication guards. It returns at most 10,000 safe snapshots from 30 days, a truncation flag and daily estimates based on observed balance declines; top-ups are excluded, and this is not a billing ledger. TypeScript and Dart clients now expose 141 operations.

SMS-006/007 remain partial: other business triggers, short links, authorized fallback, operator/outcome UI, native settings and production enablement remain open. Scheduled balance alerting remains the existing CheckSmsBalance maintenance behavior. No external SMS or deployment was performed.
Validation: 508 unit/architecture tests passed. All 70 targeted integration tests passed on MariaDB 11.8 (42 communication, eight credential vault, 20 HTTP); the 42 communication and eight vault tests passed on 10.6, followed by all 20 HTTP tests in the corrected platform-context rerun. Both SMS settings browser flows passed, including immediate key clearing, permission denial and record removal after access loss; the 390-pixel phone screenshot was reviewed. Affected TypeScript builds/test compilation, Dart client analysis, repository lint, dependency boundaries (474 modules/2,020 dependencies), secret scan, 20 migration lint checks, applied-migration immutability and 141-operation OpenAPI parity passed. The initial HTTP failure was an incorrect fixture expecting permission rejection while sending a tenant header to a platform route; application authorization was unchanged.
## Follow-up short-link core (2026-10-10)

CommunicationShortLinks now issues uniformly random 22-character base62 tokens and stores only a domain-separated HMAC in the existing short-link table. Expiry is bounded to seven days. Resolution takes a caller-authorized live patient context, rechecks the active patient, communication and owner follow-up/encounter source in the normal lock order, then returns only the patient timeline target. It rechecks expiry after lock waits, records first use once across concurrent opens and audits by row ID without the token. Key rotation invalidates older tokens.

This is an internal foundation, not a completed login or redirect flow. No HTTP route or client landing page exposes it, and outgoing messages still omit short links. Authenticated API composition, account-context selection after login, client navigation, SMS integration and expired-row maintenance remain open. Additive migration 0023 extends the target-type check constraint while retaining every existing target type. No external dependency or production deployment is included.
Validation: all 51 communication integration tests passed on both MariaDB 10.6 and 11.8 after applying migration 0023, including nine short-link cases and all existing SMS/account/delivery cases. Forty architecture checks and 14 migration-tooling unit tests passed. Communication build/test compilation, lint/format, dependency checks (475 modules/2,027 dependencies), 21 migration lint checks, applied-migration immutability and secret scanning passed. The first run exposed the missing target constraint; the next exposed two fixture problems (BigInt serialization and a withdrawn encounter missing its mandatory reason). Those were corrected without weakening application checks.
## Authenticated reminder-link landing (2026-10-10)

The authenticated communication-link API now resolves only a live SELF or guardian VIEW_RECORDS patient context. The optional dedicated SHORT_LINK_PEPPER enables resolution; missing configuration disables the endpoint. The web /r/:token landing preserves its exact path through login, lets the user choose an authorized patient context and opens that patient's timeline. Patient requests carry explicit tenant/context headers independently of remembered staff tenancy. Link failures, revoked access and failed context refresh hide patient data. Tokens are not persisted in browser storage. Typed OpenAPI and Dart clients now cover 142 operations.

Validation: the existing 20 HTTP cases passed on MariaDB 10.6 and 11.8, and all four new authorization/expiry/configuration cases passed on both after correcting an expiry fixture. The full 508 unit/architecture checks passed; five web unit checks include the safe return-path case. Ten existing browser cases and all three new reminder-link cases passed. The 390-pixel phone screenshot was reviewed. TypeScript builds, Dart analysis, lint, dependency checks (480 modules/2,051 dependencies), generated-contract parity, 21 migration checks, migration immutability and secret scanning passed.

Outgoing SMS links and expired-row maintenance remain open. This work is on codex/timeline-foundation, unmerged and undeployed; no external SMS was sent.
