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
