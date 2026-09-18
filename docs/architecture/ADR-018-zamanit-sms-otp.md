# ADR-018 — Zaman IT as the first SMS and OTP delivery adapter

**Status:** Accepted (2026-09-17, Stage 3.2)
**Extends:** ADR-007 (communication provider abstraction). **Resolves:** the Stage 3.1 external decision "Production OTP/SMS provider".
**Evidence:** `docs/implementation/ZAMANIT-VERIFICATION.md`. **No compliance claim** is made.

## Context

- The product owner selected **Zaman IT** (Bangladesh) as the SMS provider. The following facts come from the provider dashboard and are treated as input, not verified by us:
  - send endpoint `http://103.89.240.228/api/sendsms`, balance endpoint `http://103.89.240.228/api/checkbalance`;
  - `api_key` parameter; regenerating the key in the dashboard invalidates the old key immediately;
  - GET and POST accepted;
  - send parameters `api_key`, `type` (`text` | `unicode`), `phone` (`88017XXXXXXXX`, several joined with `+`), `senderid`, `message`;
  - error codes 1001–1007;
  - prepaid BDT balance.
- **The published base URL is plain HTTP on a bare IP**, and the provider's sample code disables TLS verification.
- The provider's public web page sits behind a bot-verification interstitial and was not read. A search-index snippet of it claims "only delivered SMS are charged"; that claim is UNVERIFIED.
- Stage 3.1 designs OTPs as generated, HMAC-hashed, expired and verified by HMedic (`AUTH-IMPLEMENTATION.md`), with synchronous delivery after commit.
- The provider exposes no idempotency key, so a timeout can mean "sent".

## Decision

### 1. Ports and ownership

```text
identity-access: OtpService ──> OtpDeliveryPort ──> SmsOtpDelivery (communication public facade)
                                                     └─> SmsProvider port ──> ZamanItSmsAdapter | MockSmsAdapter
communication:   DeliverCommunication job ──> SmsProvider port (same adapters)
```

- **HMedic owns the OTP lifecycle.** Zaman IT only transports text. `OtpDeliveryPort` (identity-access) and `SmsProvider` (communication) are separate ports, and the Stage 3.1 `OtpProvider` port is renamed `OtpDeliveryPort`.
- **Adapter packages:** `packages/communication-adapters/zamanit` and `packages/communication-adapters/mock` (SMS mock).
- **OTP always uses the platform account.** Authentication happens before any tenant context exists.

```ts
interface SmsProvider {
  readonly code: 'zamanit' | 'mock';
  send(input: {
    credential: SmsCredentialHandle;                        // resolved server-side; secret never leaves the process
    destination: E164Phone;                                  // canonical +8801XXXXXXXXX
    text: string;                                            // rendered template, no PHI
    purpose: 'OTP' | 'TRANSACTIONAL';
    correlationId: string;
  }): Promise<SmsSendResult>;
  checkBalance(credential: SmsCredentialHandle): Promise<SmsBalanceResult>;
}
type SmsSendResult =
  | { outcome: 'ACCEPTED'; providerMessageId?: string; segmentsEstimated: number; encoding: 'text' | 'unicode' }
  | { outcome: 'REJECTED'; errorClass: SmsErrorClass; providerCode?: string }
  | { outcome: 'PROVIDER_UNAVAILABLE'; errorClass: 'PROVIDER_UNAVAILABLE' }   // provably not sent (connect/DNS failure before request bytes)
  | { outcome: 'UNKNOWN_OUTCOME'; errorClass: 'UNKNOWN_OUTCOME' };           // timeout after send, 5xx, unparseable body
```

### 2. Transport security

- **Always `POST`, with an `application/x-www-form-urlencoded` body. Never `GET`.** With GET, the key would appear in URLs, proxy logs, provider access logs and Hostinger logs. An ESLint rule in the adapter package forbids `method: 'GET'` and query-string construction containing `api_key`.
- **TLS verification is never disabled.** `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED` and custom insecure agents are forbidden by lint and by a startup check.
- **If an HTTPS endpoint becomes available, it is mandatory.** `ZAMANIT_BASE_URL` must then be `https://`, and the adapter refuses `http://` unless `ZAMANIT_ALLOW_INSECURE_HTTP=true`.
- **Until then, the HTTP risk is explicit.** The API key, the recipient phone number and the message text (including OTP codes) travel **unencrypted** between the Hostinger data center and the provider IP. Anyone on the network path can read or tamper with them.
- **Production gate `GATE-SMS-HTTP` (OPEN).** With `APP_ENV=production`, the adapter refuses an `http://` base URL unless:
  - `ZAMANIT_ALLOW_INSECURE_HTTP=true`; **and**
  - a platform audit record `SMS_HTTP_TRANSPORT_RISK_ACCEPTED` exists. It is written by `pnpm ops:record-risk-decision --gate GATE-SMS-HTTP --owner <name> --expires <date>`, which requires DB operator access and appends to the platform audit chain, and it must not be expired.

  Without both, OTP delivery fails closed and an alert fires. The gate is listed in `IMPLEMENTATION-REVIEW.md` §4 and requires an **explicit owner decision**. Engineering cannot close it.
- **Mitigations (all mandatory):**
  1. Ask the provider for HTTPS with a hostname, and for IP allow-listing of the Hostinger egress IP (`docs/implementation/zamanit-provider-request.md`).
  2. Keep OTPs short-lived with strict limits: `OTP_TTL_SECONDS` default **180** (max 300), `max_attempts` 5, a new challenge on every resend (the previous one is superseded), and resend limited by `otp:phone` 3 per 15 min and 10 per day.
  3. Rotate keys on schedule: `ZAMANIT_KEY_MAX_AGE_DAYS` (90) triggers an alert. The runbook `runbooks/zamanit-key-rotation.md` covers the fact that regeneration invalidates the old key immediately: rotate off-peak, update hPanel env at once (the redeploy takes minutes), then verify with `checkbalance`.
  4. Alert on balance anomalies: the balance is below `ZAMANIT_BALANCE_ALERT_BDT`, or it drops more than `ZAMANIT_BALANCE_DROP_ALERT_BDT_PER_HOUR` beyond expected spend (possible key abuse).
  5. **No PHI in SMS text**, whatever the transport (§5).
  6. Staff and doctor accounts can require password + OTP step-up, so an intercepted OTP alone never grants staff access (`requireOtpForStaff` remains a second factor, not a first factor).

### 3. Formats, encoding and segments

- **Phone:**
  - canonical storage stays `+8801[3-9]XXXXXXXX` (E.164);
  - the adapter strips the `+` to produce `8801XXXXXXXXX` (13 digits) and rejects anything that does not match `^8801[3-9][0-9]{8}$` **before** any network call, with `INVALID_DESTINATION_FORMAT`;
  - **one recipient per request.** Multi-recipient `+` joins are not used, because per-recipient outcomes and mixed valid/invalid behavior are unverified.
- **Encoding:** `type=text` when every character is in the GSM-7 default alphabet or its extension table; otherwise `type=unicode`. Any Bangla character forces `unicode`.
- **Segment estimate** (documented rule, stored as `segments_estimated`, labelled an estimate until ZAMANIT-VER-07 confirms billing):
  - GSM-7: ≤ 160 septets → 1 segment, otherwise ⌈septets / 153⌉. Extension characters (`^{}\[~]|€`) count as 2.
  - Unicode (UCS-2): ≤ 70 UTF-16 code units → 1 segment, otherwise ⌈units / 67⌉.
- **Templates are designed to stay within one segment** where possible: an OTP fits in 1 segment in both English and Bangla, and CI asserts this for the rendered longest case.

### 4. Error mapping and retries

| Code / condition | Normalized class | Retry | Side effects |
|---|---|---|---|
| 1001 | `INVALID_CREDENTIAL` | No | credential → `INVALID`; critical alert (platform) or tenant notice |
| 1002 | `SENDER_ID_INVALID` | No | credential `sender_id_status=INVALID`; alert |
| 1003 | `INVALID_REQUEST` | No | bug alert |
| 1004 | `INVALID_REQUEST` | No | bug alert |
| 1005 | `DESTINATION_UNSUPPORTED` | No | fallback channel only if authorized by consent and preferences |
| 1006 | `INSUFFICIENT_BALANCE` | No | credential → `SUSPENDED_BALANCE`; queued SMS jobs for that credential rescheduled to the next balance check; `SmsBalanceLow` event; alert |
| 1007 | `INVALID_DESTINATION_FORMAT` | No | bug alert (the adapter should have rejected it first) |
| connect error / DNS failure before request bytes are written | `PROVIDER_UNAVAILABLE` | Yes, ADR-015 backoff (max 5) for transactional; OTP: no automatic retry (user resends) | — |
| timeout after the request was sent, HTTP 5xx, unparseable 2xx body | `UNKNOWN_OUTCOME` | see below | attempt `possible_duplicate=true` if retried |

**Duplicate safety:**
- **OTP:** never auto-retry after `UNKNOWN_OUTCOME` or `PROVIDER_UNAVAILABLE`.
  - The API still returns `202` with the generic hint "if the code does not arrive, request a new one".
  - A resend creates a **new** challenge and supersedes the old one, within the resend limits.
- **Transactional notifications** (serial called, appointment reminder, payment receipt):
  - at most **one** automatic retry after `UNKNOWN_OUTCOME`;
  - the retry attempt row carries `possible_duplicate=true`;
  - no further retries.
- **Bulk or campaign SMS:** out of MVP scope. There is no endpoint.

**Response parsing:** the success body format is UNVERIFIED (ZAMANIT-VER-02/03).
- **Until SMS-002 captures real fixtures**, the parser classifies:
  - any response containing one of the codes 1001–1007 as a code value → the mapped class;
  - HTTP 2xx without such a code → `ACCEPTED` with `providerMessageId` absent;
  - anything else → `UNKNOWN_OUTCOME`.
- **Enabling the adapter in production** requires the SMS-002 fixture-based parser (success marker and message-id extraction where present). This is part of `GATE-SMS-HTTP`'s checklist.

### 5. Content rules

- **Templates** are versioned files `packages/communication/src/templates/sms/<key>.<locale>.v<n>.txt` in `bn-BD` and `en-BD`.
- **Allowed placeholders only:** `{appName}`, `{otpCode}`, `{otpMinutes}`, `{serialNumber}`, `{localTime}`, `{localDate}`, `{clinicSmsName}`, `{shortLink}`.
  - A template lint rejects any other placeholder.
  - `{clinicSmsName}` is a tenant-configured display name (default the clinic name), so clinics whose name reveals a specialty can choose a neutral name.
- **Never included:** diagnosis, prescription, medication, lab, note, doctor specialty or any other clinical content, and no patient names.
- **Short links** are opaque (`https://app.<domain>/s/<22-char random token>`), map to an in-app route that requires login, and expire (`communication_short_links`).

### 6. Credentials

| Mode | Owner | Storage | Used for |
|---|---|---|---|
| `PLATFORM_ACCOUNT` (default) | Hakeemify | env `ZAMANIT_API_KEY`, `ZAMANIT_SENDER_ID` (hPanel) | all OTPs; tenant notifications unless the tenant has its own account |
| `TENANT_ACCOUNT` (optional) | a clinic or doctor tenant | `provider_credentials` row (`provider_kind=SMS`, `provider_code=zamanit`), envelope-encrypted with `PROVIDER_CREDENTIAL_KEK` (same pattern as ADR-017 §4; AAD = `credentialId\|tenantId\|providerKind\|providerCode`) | that tenant's transactional notifications |

- `provider_credentials` is a generalized table for non-AI provider secrets (SMS and payment). AI credentials stay in `ai_provider_credentials` (ADR-017), because they carry AI-specific policy columns. Both use the shared `SecretEnvelopePort` in the new `packages/secrets` package. The key encryption keys are separate: `AI_CREDENTIAL_KEK` and `PROVIDER_CREDENTIAL_KEK`.
- **What the API returns:** DTOs expose only `id`, `providerCode`, `status`, `secretLast4`, the non-secret `senderId`, `validatedAt` and `lastErrorClass`. **The key is never returned, logged, queued or exported.**
- **Validation** uses `checkbalance`, which sends nothing and costs nothing: a balance response → `ACTIVE`; 1001 → `INVALID`.
- **Sender ID status** stays `UNVERIFIED` until the first accepted send, because Zaman IT exposes no sender-ID check.

### 7. Balance monitoring

- **`CheckSmsBalance` job** (maintenance queue, every `ZAMANIT_BALANCE_CHECK_MINUTES` = 60, singleton):
  - calls `checkbalance` for the platform account and every `ACTIVE` or `SUSPENDED_BALANCE` tenant credential;
  - stores `sms_balance_snapshots`;
  - emits `SmsBalanceLow` below the threshold (platform: `ZAMANIT_BALANCE_ALERT_BDT`; tenant: the credential's `balance_alert_bdt`);
  - reactivates `SUSPENDED_BALANCE` credentials once the balance is above the threshold.
- **Dashboard:**
  - the platform operator sees `GET /platform/sms/balance`;
  - a tenant sees its own credential balance;
  - daily spend estimate = sum of negative balance deltas per Asia/Dhaka day, cross-checked with Σ `segments_estimated` × `ZAMANIT_PRICE_PER_SEGMENT_BDT` (optional business config). It is labelled an estimate.
- The balance response format is UNVERIFIED (ZAMANIT-VER-02). The parser accepts a documented set of shapes captured in SMS-002 and otherwise stores `parse_status=UNPARSED` and alerts.

### 8. Configuration

`ZAMANIT_BASE_URL`, `ZAMANIT_API_KEY`, `ZAMANIT_SENDER_ID`, `ZAMANIT_TIMEOUT_MS` (default 10000), `ZAMANIT_BALANCE_ALERT_BDT`, `ZAMANIT_LIVE_SMOKE` (default `false`), plus the gate and operational variables above (`ENVIRONMENT-CONTRACT.md` §6).

### 9. Testing

- **Mock adapter** (`communication-adapters/mock`, also served by `mock-providers`): success; each of 1001–1007; connect failure; timeout after send; HTTP 500; unparseable body; balance response; balance below threshold.
- **Contract tests** run the Zaman IT adapter against the mock server over HTTP. They check form encoding, POST only, no key in the URL or logs, phone conversion, encoding choice and segment estimates.
- **Live smoke** (SMS-008): **one** controlled message.
  - Runs only when `ZAMANIT_LIVE_SMOKE=true`, on a developer workstation or staging.
  - Destination is the developer-supplied `ZAMANIT_LIVE_SMOKE_TO`, and the text is fixed and non-clinical.
  - **Never in CI.** The CI workflow sets `ZAMANIT_LIVE_SMOKE=false`, and the test aborts when `CI=true`.

## Alternatives considered

| Alternative | Why not now |
|---|---|
| Keep mocks only | Real OTP login cannot go live |
| Use GET as in the provider sample | Key leakage into URLs and logs |
| Disable TLS verification (provider sample) | Forbidden; it gives a false sense of security with no benefit |
| Provider-generated OTP | Moves verification trust to a plaintext-HTTP provider; HMedic keeps the hashed OTP lifecycle |
| WhatsApp OTP | No provider selected; stays behind the same `OtpDeliveryPort` |

## Consequences

- Real OTP and SMS notifications can be implemented and tested entirely with mocks. Only one gated live message is ever sent in Stage 4.
- Production use over HTTP depends on an explicit, expiring owner decision (`GATE-SMS-HTTP`).
- A second SMS provider can be added behind `SmsProvider`, without domain changes, if Zaman IT cannot provide HTTPS.
