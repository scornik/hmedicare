# Zaman IT Verification — SMS/OTP provider

**Stage 3.2 (2026-09-17).** Evidence for ADR-018.

## How to read this document

- **Status values:**
  - **INPUT:** given by the product owner from the Zaman IT dashboard; not independently verified.
  - **UNVERIFIED:** unknown; the default below applies until the proving task records a result.
  - **VERIFIED:** confirmed by a recorded Stage 4 test. There are none yet.
- **Nothing was sent or queried in Stage 3.2.** No API key was used. The provider's marketing page (`zaman-it.com/sms-api/`) sits behind a bot-verification interstitial and was **not** read. A search-index snippet of it claims "only delivered SMS are charged" and gives a GET URL sample; both are recorded as UNVERIFIED.
- **Verification in Stage 4 has three layers, all never in CI:**
  - **Free probes (SMS-002):** `checkbalance` only. No message is sent and nothing is charged. Run from the staging worker diagnostics endpoint, so they also prove Hostinger egress.
  - **One controlled live send (SMS-008):** gated by `ZAMANIT_LIVE_SMOKE=true`. It sends exactly **one** message to the developer-supplied `ZAMANIT_LIVE_SMOKE_TO`, with fixed non-clinical text "HMedic test <random 6 chars>". The test aborts when `CI=true`.
  - **Provider questions:** sent with `zamanit-provider-request.md`. Answers are recorded here with date and responder.
- **Result recording:** fixtures are captured **redacted** (key and phone removed) into `packages/communication-adapters/zamanit/test/fixtures/verified/`, and each result is appended to §3.

## 1. Known inputs

| # | Fact | Status | Source |
|---|---|---|---|
| I-1 | Send endpoint `http://103.89.240.228/api/sendsms` | INPUT | dashboard |
| I-2 | Balance endpoint `http://103.89.240.228/api/checkbalance` | INPUT | dashboard |
| I-3 | Auth by `api_key` parameter; key is regenerable; regeneration invalidates the old key immediately | INPUT | dashboard |
| I-4 | GET and POST accepted | INPUT | dashboard |
| I-5 | Send params: `api_key`, `type` (`text`\|`unicode`), `phone` (`88017XXXXXXXX`, several joined by `+`), `senderid`, `message` (URL-encode special characters) | INPUT | dashboard |
| I-6 | Error codes 1001 wrong API key, 1002 wrong sender ID, 1003 type must be text/unicode, 1004 only GET/POST, 1005 prefix inactive, 1006 insufficient balance, 1007 must use country code 88 | INPUT | dashboard |
| I-7 | Prepaid balance in BDT | INPUT | dashboard |
| I-8 | Base URL is plain HTTP on a bare IP; sample code disables TLS verification | INPUT | dashboard sample |

## 2. Unknowns

| ID | Unknown | Why it matters | How Stage 4 verifies | Default assumption | Fallback |
|---|---|---|---|---|---|
| ZAMANIT-VER-01 | Does an HTTPS endpoint or hostname exist? | Key, phone and OTP travel in plaintext over HTTP (`GATE-SMS-HTTP`) | (a) provider request email; (b) SMS-002 probe: `POST https://103.89.240.228/api/checkbalance` with TLS verification **on**, and HTTPS on any hostname the provider supplies; record certificate subject and validity | **No HTTPS.** Adapter supports both; production over HTTP requires the owner risk decision | Switch `ZAMANIT_BASE_URL` to HTTPS the day it exists (mandatory); or add a second SMS provider with HTTPS behind `SmsProvider` |
| ZAMANIT-VER-02 | Exact success response format (body, content type) for `checkbalance` and `sendsms` | Parser correctness, balance monitoring, message-id capture | SMS-002: `checkbalance` via POST form body (free), capturing status, headers and redacted body. SMS-008: one live send, same capture. Also `checkbalance` with a deliberately wrong key → expect 1001 format | Error = body contains a 1001–1007 code; send success = HTTP 2xx without such a code (`ACCEPTED`, no message id); balance = first decimal number in a `balance`-like field, else `UNPARSED` + alert | Keep the tolerant parser; production enablement waits for captured fixtures (ADR-018 §4) |
| ZAMANIT-VER-03 | Is a message ID returned? | Correlating delivery reports; support tickets | SMS-008 capture | **No message id** (`provider_message_id` NULL) | Correlate by our attempt id and timestamp only |
| ZAMANIT-VER-04 | Do delivery reports (DLR) or callbacks exist? | Normalized `DELIVERED` state; "charged only if delivered" claim | Provider request; dashboard inspection for a DLR/webhook setting; SMS-008 observe the dashboard report for the test message | **No DLR.** Terminal state is `SENT` (accepted), never `DELIVERED`/`READ` (COMMUNICATION-SPEC: `READ` only with evidence) | If a pull-based report API exists, add a `PollSmsDeliveryReports` job; if a callback exists, add `POST /webhooks/zamanit` with signature/IP check |
| ZAMANIT-VER-05 | Rate limits (per second/minute) | OTP bursts, reminder batches | Provider request. **No load test** against the live API | Client-side limit `ZAMANIT_MAX_SENDS_PER_MINUTE` = 30 per credential via `job_concurrency_leases` + `rate_limit_counters` | Lower the limit; spread reminders over time |
| ZAMANIT-VER-06 | Maximum recipients per request | Bulk efficiency (not needed in MVP) | Provider request | Irrelevant: **one recipient per request** | — |
| ZAMANIT-VER-07 | Text/unicode segment lengths and billing per segment | Cost estimate; template sizing | Provider request; SMS-008 note the dashboard charge for a known-length message | GSM-7 160/153, UCS-2 70/67; billed per segment; `segments_estimated` labelled an estimate | Adjust the rule constants and relabel |
| ZAMANIT-VER-08 | Masking vs non-masking sender ID rules and approval time | Whether messages show "HMedic" or a number; go-live lead time | Provider request; dashboard Messaging > Sender ID status | Non-masking until an approved masking sender ID exists; approval time unknown, so go-live plan allows ≥ 2 weeks | Use the approved non-masking sender; OTP text includes the app name |
| ZAMANIT-VER-09 | OTP/transactional route vs promotional route | Delivery priority, DND filtering, sending-hour restrictions | Provider request | Account uses a transactional route; no promotional content is ever sent | Request route change; add a second provider for OTP |
| ZAMANIT-VER-10 | IP allow-listing support | Limits damage from key theft (key readable on the HTTP path) | Provider request; record the Hostinger egress IP from HOST-009 | **Not available** | Key rotation schedule + balance-drop alert (ADR-018 §2) |
| ZAMANIT-VER-11 | Idempotency or deduplication | Duplicate SMS after timeout | Provider request | **None** (duplicate-safety rules in ADR-018 §4) | — |
| ZAMANIT-VER-12 | Behavior when `phone` contains mixed valid/invalid numbers | Partial-send semantics | Provider request only (no live test; it costs money and needs extra numbers) | Irrelevant: single recipient, and the adapter pre-validates format | — |
| ZAMANIT-VER-13 | POST body encoding accepted (form vs JSON vs multipart) | Transport correctness without GET | SMS-002: `checkbalance` via `application/x-www-form-urlencoded` POST; if that is rejected with 1004 or an error, try `multipart/form-data`. **Never** fall back to GET | form-urlencoded | multipart; if only GET works, `GATE-SMS-HTTP` stays OPEN, a provider request is sent, and SMS is not enabled in production |
| ZAMANIT-VER-14 | Timeout and latency from the Hostinger India region to the provider IP | `ZAMANIT_TIMEOUT_MS`, OTP UX | SMS-002: 20 `checkbalance` calls spaced 30 s apart from staging worker diagnostics; record p50/p95 | 10 s timeout | Raise to 15 s; show the resend hint sooner |
| ZAMANIT-VER-15 | Does the key appear in provider-side logs or dashboard reports? | Key exposure beyond the network path | Provider request | Assume yes (treat the key as exposed); rotation schedule | — |
| ZAMANIT-VER-16 | Is the Hostinger egress IP stable (needed for any allow-list)? | Allow-listing viability | HOST-009 records the egress IP twice, a week apart; Hostinger docs note IP changes on region change | Stable unless the region changes | Allow-listing not used |
| ZAMANIT-VER-17 | Charged only for delivered SMS (search-snippet claim)? | Cost model | Provider request; compare the balance delta after SMS-008 | Charged per accepted segment | — |

## 3. Results log

| Date | Task | Item(s) | Result | Fixture / evidence | Recorded by |
|---|---|---|---|---|---|
| — | — | — | No results yet (Stage 4) | — | — |

### 3.1 SMS-002 free-probe procedure (implemented in Stage 4)

1. On the **staging** worker only, set `DIAGNOSTICS_ENABLED=true` and a fresh `INTERNAL_DIAGNOSTICS_TOKEN` (config refuses diagnostics in production), plus the platform `ZAMANIT_*` variables.
2. From a workstation: `WORKER_URL=https://worker-staging.<domain> INTERNAL_DIAGNOSTICS_TOKEN=… pnpm ops:capture-sms-probe`. The script refuses plain http (except localhost) and CI.
3. The worker (`GET /internal/diagnostics/sms-balance`, bearer token, 6/min) runs one `checkbalance` via POST form body with the same transport rules as the adapter, then a TLS handshake to `<host>:443` **with verification on** (ZAMANIT-VER-01). Certificate subject/validity are recorded only when verification succeeds.
4. The capture is redacted twice. The worker replaces the key and phone-shaped runs and caps the body at 2 KiB. The script re-checks for the token, `api_key=` and phone numbers, and refuses to write on any hit. It writes `packages/communication-adapters/zamanit/test/fixtures/verified/<date>-checkbalance.json` and prints the §3 row to append.
5. For the ZAMANIT-VER-02 wrong-key case, repeat once with a deliberately invalid `ZAMANIT_API_KEY` on staging (expect 1001), then restore the real key.
6. Set `DIAGNOSTICS_ENABLED=false` again when done.

## 4. Live smoke procedure (SMS-008)

1. **Preconditions:**
   - SMS-002 is done and the parser is updated from its fixtures;
   - `ZAMANIT_ALLOW_INSECURE_HTTP=true` is set **only** in the developer shell or staging;
   - the developer's own phone is in `ZAMANIT_LIVE_SMOKE_TO`, provided via env and never committed.
2. **Run:**
   ```bash
   ZAMANIT_LIVE_SMOKE=true pnpm --filter @hmedic/communication-adapters-zamanit test:live-smoke
   ```
   The test refuses to run if `CI=true`, if the destination is missing or not a valid BD mobile, or if it has already sent once within 10 minutes (lock file in `.local/`).
3. **Checks:**
   - exactly one POST;
   - no key in any log line (captured and scanned);
   - response classified `ACCEPTED`;
   - message received;
   - dashboard charge observed (ZAMANIT-VER-07/17).
4. Record the results in §3. Delete the local capture after redaction.
