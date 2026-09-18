# aamarPay Verification — payment gateway

**Stage 3.2 (2026-09-17).** Evidence for ADR-019.

## How to read this document

- **Documented** facts come from the official docs, read on 2026-09-17: the `aamarpay.readme.io/llms.txt` index and the markdown pages listed in §6.
- **Sandbox-observed** facts come from four read-only sandbox requests made on 2026-09-17 12:36 UTC (§4):
  - two Search Transaction lookups of a non-existent `request_id`;
  - one Search Transaction with a wrong key;
  - one `jsonpost.php` call with a deliberately invalid signature key (no payment session created).
  
  **No payment was created or made.** The live environment was not contacted.
- **UNVERIFIED** items have a default and a Stage 4 task (PAY-014 unless stated).
- **Credentials:** aamarPay publishes a shared sandbox store ID and signature key on its sandbox-credentials page. This blueprint does **not** copy them. Local development and CI read them from env (`AAMARPAY_PLATFORM_STORE_ID`, `AAMARPAY_PLATFORM_SIGNATURE_KEY`), set by a developer from that page, and CI tests use the mock gateway only. Live credentials come from aamarPay support.
- **No compliance claim.** aamarPay's own docs state PCI DSS compliance and a Bangladesh Bank PSO licence; that is their claim.

## 1. Endpoints

| Operation | Sandbox | Live | Method | Status |
|---|---|---|---|---|
| Initiate (JSON) | `https://sandbox.aamarpay.com/jsonpost.php` | `https://secure.aamarpay.com/jsonpost.php` | POST `application/json` | Documented; sandbox-observed (error path) |
| Initiate (form data) | `…/index.php` | `…/index.php` | POST form | Documented; **not used** |
| Search Transaction | `https://sandbox.aamarpay.com/api/v1/trxcheck/request.php` | `https://secure.aamarpay.com/api/v1/trxcheck/request.php` | **GET, query string** (documented sample) | Documented; sandbox-observed: **POST (form or JSON) is not accepted** (`parameter is required`) |
| IPN | merchant-hosted URL, registered with aamarPay technical support per store | same | aamarPay → merchant POST | Documented (setup only) |
| Refund | — | — | — | **Not documented** |
| Settlement report | — | — | — | **Not documented** |

- **"Invalid Store ID" pitfall** (documented common issue): sandbox credentials must be used with the sandbox base URL, and live with live. HMedic enforces that each account's `environment` equals `AAMARPAY_ENV`.

## 2. Contracts

### 2.1 Initiate Payment (JSON)

**Request fields.**
- **Required** (documented):
  - `store_id`, `signature_key`;
  - `tran_id` (unique per payment, ≤ 32 chars), `amount` (decimal, no symbols or commas, `.` separator), `currency` (uppercase, e.g. `BDT`), `desc`;
  - `cus_name`, `cus_email`, `cus_phone`;
  - `success_url`, `fail_url`, `cancel_url`;
  - `type="json"`.
- **Optional:** `cus_add1`, `cus_add2`, `cus_city`, `cus_state`, `cus_country`, `opt_a`–`opt_d`. `cus_postcode` appears in the sample request but is not in the table.

**HMedic values:**

| Field | Value |
|---|---|
| `tran_id` | `hm` + 30 Crockford-base32 random characters (32 total, 150 bits) |
| `amount` | server-computed `DECIMAL(12,2)` string, e.g. `"500.00"` |
| `currency` | `BDT` |
| `desc` | `HMEDIC-<shortRef>` |
| `cus_name` | payer display name |
| `cus_email` | per ADR-019 §5 |
| `cus_phone` | payer E.164 |
| URLs | ADR-019 §3 |
| `opt_a` | intent id |

Address fields are omitted.

**Success response** (documented sample): `{"result": "true", "payment_url": "https://sandbox.aamarpay.com/paynow.php?track=AAM…"}`. Here `result` is a **string** `"true"`.

**Error response** (sandbox-observed with an invalid signature key): HTTP 200, `Content-Type: application/json`, `{"result": false, "message": "Invalid Signature Key"}`. Here `result` is a **boolean** `false`.

**Parser rules:**
- `payment_url` present and `result` ∈ {`"true"`, `true`} → `CREATED`;
- `result` ∈ {`false`, `"false"`} → `REJECTED` with `message` mapped: `Invalid Signature Key`/`Invalid Store ID` → `MERCHANT_CREDENTIAL_INVALID`, others → `GATEWAY_REJECTED`;
- a timeout or unparseable body → `UNKNOWN_OUTCOME`.
  - `UNKNOWN_OUTCOME` is **safe to retry with the same `tran_id`** only after a Search Transaction shows no transaction.
  - Default: the intent is marked `FAILED` with `GATEWAY_UNKNOWN_OUTCOME`, and the client may create a new intent (new `tran_id`) with a new idempotency key.
  - Whether a duplicate `tran_id` is rejected is UNVERIFIED (PAY-AAM-05).

### 2.2 Redirect callback (`success_url` / `fail_url` POST)

- **Documented fields** (the "Sample Response After Redirection"):
  - `pg_service_charge_bdt`, `amount_original`, `gateway_fee`, `pg_service_charge_usd`, `pg_card_bank_name`, `pg_card_bank_country`, `card_number` (masked), `card_holder`;
  - `status_code`, `pay_status`, `success_url`, `fail_url`;
  - `cus_name`, `cus_email`, `cus_phone`;
  - `currency_merchant`, `convertion_rate`, `ip_address`, `other_currency`;
  - `pg_txnid`, `epw_txnid`, `mer_txnid`, `store_id`, `merchant_id`, `currency`, `store_amount`, `pay_time`, `amount`, `bank_txn`, `card_type`, `reason`, `pg_card_risklevel`, `pg_error_code_details`;
  - `opt_a`–`opt_d`.
- **`status_code`:** `0` initiated, `2` successful, `3` expired, `7` failed (documented).
- **Unverified details:**
  - the content type (form vs JSON) is **UNVERIFIED** (PAY-AAM-01); the endpoint accepts both;
  - whether `cancel_url` receives a POST body is UNVERIFIED;
  - the callback is **not signed** (nothing documented).
- **HMedic handling:** untrusted. Stored redacted: `cus_*`, `card_number`, `card_holder`, `ip_address` and `bank_txn` are dropped; `pg_txnid`, `mer_txnid`, `status_code` and `amount` are kept. Then verified with Search Transaction.
- **Documented note:** the sample shows `amount` in BDT differing from `amount_original` when `currency_merchant` is USD (conversion). HMedic always sends BDT. The field used for amount matching is decided in PAY-AAM-02, defaulting to Search Transaction `amount`.

### 2.3 Search Transaction

- **Request:** `GET …/trxcheck/request.php?request_id=<tran_id>&store_id=<store>&signature_key=<key>&type=json`.
- **Signature key in the URL:** the key sits in the query string. This is a provider-imposed exposure: it can land in aamarPay-side access logs and in any TLS-terminating intermediary.
- **HMedic mitigations:**
  - build the URL only inside the adapter;
  - disable request logging for this call, and redact `signature_key` in URLs (OBSERVABILITY pattern);
  - never follow redirects to non-aamarPay hosts;
  - use a 10 s timeout;
  - ask aamarPay for a POST or header-based alternative (PAY-AAM-06).
- **Success-case response** (documented sample): JSON with `pg_txnid`, `mer_txnid`, `risk_title`, `risk_level`, `cus_*`, `ship_*`, `desc`, `merchant_id`, `store_id`, `amount`, `amount_bdt`, `pay_status`, `status_code`, `status_title`, `cardnumber`, `approval_code`, `payment_processor`, `bank_trxid`, `payment_type`, `error_code`, `error_title`, `bin_*`, `date`, `date_processed`, `amount_currency`, `rec_amount`, `processing_ratio`, `processing_charge`, `ip`, `currency`, `currency_merchant`, `convertion_rate`, `opt_a`–`opt_d`, `verify_status`, `call_type`, `email_send`, `doc_recived`, `checkout_status`.
  - All values are strings; `amount: "10.00"`, `rec_amount: "9.65"`, `processing_charge: "0.35"`, `processing_ratio: "3.50"`.
  - The docs advise checking `status_code` and `amount`.
- **Non-existent `request_id`** (sandbox-observed): HTTP 200, `Content-Type: text/html`, body `{"request_id":"<id>","store_id":"<store>","status":"Invalid-Data"}` → `NOT_FOUND`.
- **Wrong signature key or wrong store ID** (sandbox-observed, both cases): HTTP 200, body plain text `Store_id & signature key not matched` → `CREDENTIAL_MISMATCH`.
- **Parser rule:** parse JSON regardless of `Content-Type` (it was `text/html` for JSON); plain-text bodies are matched exactly.

**Verification rule for `PAID`** (all must hold; strings compared exactly after trimming):

| Check | Field | Expected |
|---|---|---|
| status | `status_code` | `"2"` |
| transaction | `mer_txnid` | `intent.tran_id` |
| store | `store_id` | the merchant account's store ID |
| amount | `amount` parsed with `^\d{1,10}(\.\d{1,2})?$` → paisa | `intent.amount` paisa |
| currency | `currency` | `"BDT"` |
| merchant currency | `currency_merchant` (if present and not `Not-Available`) | `"BDT"` |

Any mismatch writes a `payment_verifications` row with `result=MISMATCH` and `mismatch_fields`, raises `payment_verification_mismatch_total` and an alert, and leaves the intent unchanged (manual review).

### 2.4 IPN

- **Documented:**
  - aamarPay sends an HTTP POST to a listener URL the merchant gives to aamarPay technical support during onboarding;
  - "each notification message … is signed by aamarPay";
  - notifications are sent **only for successful payments**;
  - the payload is the same shape as the Search Transaction sample.
- **UNVERIFIED:**
  - the signature scheme and where the signature is carried (PAY-AAM-03);
  - retry behavior and schedule (PAY-AAM-04);
  - the expected acknowledgement response (PAY-AAM-04);
  - content type;
  - whether one listener URL can serve multiple stores.
- **HMedic defaults:**
  - the IPN is an untrusted trigger;
  - dedupe by (`pg_txnid`, `status_code`, `source=IPN`);
  - always verify via Search Transaction using the intent found by `mer_txnid`;
  - respond `200 text/plain OK` after storing the event, whether or not verification succeeds. Verification runs inline with a 10 s budget; on timeout it is left to reconciliation.
  - An unknown `mer_txnid` → `200 OK`, event stored with `unmatched=true`, alert if the rate exceeds 5 per hour.

## 3. Capabilities

| ID | Item | Status | Default | Stage 4 task |
|---|---|---|---|---|
| PAY-AAM-01 | Redirect callback content type and `cancel_url` body | UNVERIFIED | accept form and JSON; cancel may be GET or POST without a body | PAY-014 sandbox payment (test card/wallet) |
| PAY-AAM-02 | Which amount field equals the requested BDT amount (`amount` vs `amount_bdt` vs `amount_original`), including any customer-borne charges | UNVERIFIED | Search Transaction `amount` = requested amount | PAY-014 sandbox payments with ≥ 2 methods |
| PAY-AAM-03 | IPN signature scheme | UNVERIFIED (claimed "signed") | not relied upon; verification by Search Transaction | PAY-014: ask integration support; if a verifiable HMAC exists, add it as an extra check (ADR-019 amendment) |
| PAY-AAM-04 | IPN retry schedule and expected response | UNVERIFIED | at-least-once; `200 OK` | PAY-014 support request + sandbox IPN (if sandbox IPN can be configured) |
| PAY-AAM-05 | Duplicate `tran_id` handling on initiate | UNVERIFIED | never reuse a `tran_id` | PAY-014 sandbox |
| PAY-AAM-06 | Search Transaction via POST or header auth | Sandbox-observed: not accepted via POST | GET with redaction | PAY-014 support request |
| PAY-AAM-07 | Refund API | **Not documented** | manual refund in the merchant panel or through support, recorded in HMedic | PAY-011; ask support |
| PAY-AAM-08 | Settlement reports (format, API, frequency) | **Not documented** | none; reconciliation by Search Transaction per intent | PAY-014: ask support; manual CSV import Future |
| PAY-AAM-09 | Supported payment methods (bKash, Nagad, Rocket, cards, internet banking) | Docs say "card systems, mobile financial systems, and local and international wallets"; specific methods **UNVERIFIED** | UI shows "Pay online (cards, mobile wallets)" without naming brands | PAY-014: observe the sandbox checkout page; ask support |
| PAY-AAM-10 | Fee fields | Documented: `processing_charge`, `processing_ratio`, `rec_amount` (Search); `store_amount`, `pg_service_charge_bdt`, `gateway_fee` (redirect) | fee = `processing_charge`, else `amount − rec_amount`; else `fee_unverified` | PAY-014 |
| PAY-AAM-11 | Live behavior of the Search Transaction credential check (used for `DOCTOR_MERCHANT` validation) | Sandbox-observed only | as sandbox; `INCONCLUSIVE` → `UNVERIFIED_UNTIL_FIRST_PAYMENT` | PAY-014 with Hakeemify's own live store (lookup of a random id; no payment) |
| PAY-AAM-12 | Payment page expiry time (when `status_code=3` occurs) | UNVERIFIED | `PAYMENT_INTENT_TTL_MINUTES` = 30; reconciliation treats "no success by TTL + 10 min" as expired | PAY-014 |
| PAY-AAM-13 | Callback source IPs | UNVERIFIED | not used for trust | — |
| PAY-AAM-14 | Mobile SDKs | Documented: the Flutter package (`aamarpay`) and Android library take store ID and signature key in app code | **Not used** (secret in client). External browser tab instead | — |
| PAY-AAM-15 | Behavior when the payer closes the tab | UNVERIFIED | reconciliation job | PAY-014 |
| PAY-AAM-16 | Rate limits on Search Transaction | UNVERIFIED | ≤ 1 lookup per intent per 30 s backoff; ≤ 60 per minute per store | PAY-014 support request |

## 4. Sandbox observations (2026-09-17 12:36 UTC)

| # | Request | Response |
|---|---|---|
| S-1 | `GET trxcheck/request.php` with a fabricated `request_id`, the published sandbox store and key, `type=json` | `200`, `Content-Type: text/html`, HSTS present, body `{"request_id":"<id>","store_id":"<sandbox store>","status":"Invalid-Data"}` |
| S-2 | `POST trxcheck/request.php` with the same fields as `application/x-www-form-urlencoded`, and again as `application/json` | `200`, body `parameter is required` (both) |
| S-3 | `GET trxcheck/request.php` with a wrong signature key; separately with a wrong store ID | `200`, body `Store_id & signature key not matched` (both) |
| S-4 | `POST jsonpost.php` (JSON) with the sandbox store ID, an all-zero signature key and otherwise valid synthetic fields (`cus_email` at `example.com`) | `200`, `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, body `{"result":false,"message":"Invalid Signature Key"}` |

## 5. Security notes

- **Every gateway call is server-side.** CORS `*` on aamarPay endpoints does not change this: a browser never holds a signature key.
- **Redaction** covers `signature_key`, `store_id` (last 4 kept), `cus_email`, `cus_phone`, `cus_name`, `card_number`, `cardnumber`, `bank_txn`, `bank_trxid`, `approval_code`, `ip`, `ip_address` and `payment_url` (hashed).
- **Hostinger egress** to `sandbox.aamarpay.com` and `secure.aamarpay.com` on 443 is covered by HOSTING-VERIFICATION #21 and checked in HOST-009.

## 6. Sources (read 2026-09-17)

`https://aamarpay.readme.io/llms.txt`, and `.md` versions of `reference/overview`, `reference/security-and-compliance`, `reference/initiate-payment-json`, `reference/initiate-payment-form-data`, `reference/search-transaction`, `reference/instant-payment-notification`, `reference/common-issues`, `reference/sandbox-credentials-1`, `reference/sample-code`, `reference/flutter-package`, `reference/android-library`, `reference/postman-collection`.
