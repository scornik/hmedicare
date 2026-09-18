# ADR-019 — Payments enter MVP with aamarPay

**Status:** Accepted (2026-09-17, Stage 3.2)
**Supersedes:**
- the "Billing is Future" resolution (consistency audit S3-13; `DATABASE-SPEC.md`/`PRODUCT-ARCHITECTURE-SPEC.md` billing scope);
- the Stage 3.1 external decision "payment provider".

**Evidence:** `docs/implementation/AAMARPAY-VERIFICATION.md`. Build contract: `docs/implementation/PAYMENT-IMPLEMENTATION.md`. **No legal, financial or regulatory compliance claim is made.**

## Context

- **The product owner selected aamarPay.** Hakeemify already holds an aamarPay merchant account. aamarPay's documentation states it holds a Bangladesh Bank Payment Service Operator licence and PCI DSS compliance; that is their claim, not ours.
- **Documented integration model** (read 2026-09-17):
  - the server POSTs JSON to `jsonpost.php` with `store_id` and `signature_key`, and receives `payment_url`;
  - the payer is redirected to aamarPay;
  - the gateway POSTs results to `success_url` / `fail_url`;
  - the merchant should call **Search Transaction** in the success endpoint;
  - IPN is available for successful payments only, configured through aamarPay support.
- **Security-relevant facts** (verification doc):
  - Search Transaction is documented, and was observed in the sandbox, as **GET with `signature_key` in the query string**;
  - IPN is described as signed, but no signature scheme is documented;
  - refunds and settlement reports have no documented API;
  - aamarPay's Flutter package and Android library take the store ID and signature key **inside the mobile app**.
- **Scope:** patient payments for consultations and telemedicine, plus doctor/clinic subscription payments to Hakeemify. Insurance, claims and complex invoicing stay Future.
- **Regulatory risk:** collecting patient fees into Hakeemify's merchant account on behalf of doctors means Hakeemify holds money owed to third parties. In Bangladesh this may be regulated activity (payment aggregation or facilitation), with tax and accounting implications. It is not researched.

## Decision

### 1. Bounded context and packages

- **`packages/payments`** (new bounded context) owns:
  - merchant accounts, fee schedules, payment intents, attempts, gateway events, verifications;
  - ledger, payouts, refunds, subscriptions and invoices.
  
  It replaces the `billing` Future placeholder.
- **Adapter packages:**
  - `packages/payment-adapters/aamarpay` implements `PaymentGatewayPort`;
  - `packages/payment-adapters/mock` is the mock gateway.
- **`packages/provider-credentials`** owns `provider_credentials`. Its envelope encryption comes from `packages/secrets` (ADR-018 §6).

```ts
interface PaymentGatewayPort {
  readonly code: 'aamarpay' | 'mock';
  initiate(input: {
    merchant: MerchantCredentialHandle; environment: 'sandbox' | 'live';
    tranId: string; amount: MoneyString; currency: 'BDT'; desc: string;
    customer: { name: string; email: string; phone: string };
    successUrl: string; failUrl: string; cancelUrl: string; optA: string;
  }): Promise<{ outcome: 'CREATED'; paymentUrl: string } | { outcome: 'REJECTED'; errorClass: PaymentErrorClass; message?: string } | { outcome: 'UNKNOWN_OUTCOME' }>;
  searchTransaction(input: { merchant: MerchantCredentialHandle; environment: 'sandbox' | 'live'; tranId: string }):
    Promise<GatewayTransactionRecord | { outcome: 'NOT_FOUND' } | { outcome: 'CREDENTIAL_MISMATCH' } | { outcome: 'UNAVAILABLE' }>;
  validateCredential(input: { merchant: MerchantCredentialHandle; environment: 'sandbox' | 'live' }):
    Promise<'VALID' | 'INVALID' | 'INCONCLUSIVE'>;
}
```

### 2. Merchant modes

| Mode | aamarPay store owner | Used for | Production gate |
|---|---|---|---|
| `PLATFORM_MERCHANT` | Hakeemify (existing account; credentials in hPanel env `AAMARPAY_PLATFORM_*`) | **Platform subscriptions (always).** Patient fees only for tenants/doctors who opt in instead of having their own store. | Patient fees: **`GATE-PAY-PLATFORM-COLLECTION` (OPEN)**. Subscriptions: none beyond live credentials. |
| `DOCTOR_MERCHANT` | the doctor or clinic (their own aamarPay store) | patient fees paid directly to that doctor/clinic | none specific (the doctor/clinic is the merchant of record) |

- **Choosing a mode.** A tenant or doctor chooses the mode **per fee type** (`payment_merchant_accounts.fee_types_enabled`). The resolution order for a patient fee is:
  1. an active doctor-owned `DOCTOR_MERCHANT` account enabling that fee type;
  2. an active clinic-owned `DOCTOR_MERCHANT` account;
  3. the tenant's `PLATFORM_MERCHANT` opt-in row, only if patient collection is allowed (below);
  4. otherwise **no online payment**, and the chamber's policy falls back to pay-at-chamber.
- **Doctor-merchant credentials** (store ID, signature key) live in `provider_credentials` (`provider_kind=PAYMENT`), envelope-encrypted. Only `storeIdLast4` / `secretLast4` are displayed. They are never returned, logged or sent to clients. No doctor can read another doctor's credential, and nobody can read their own after submission.
- **Credential validation.** Call Search Transaction with a random, never-used `request_id` against the account's environment:
  - a JSON body with `status: "Invalid-Data"` → `VALID` (store and key matched, and no transaction exists);
  - the text "Store_id & signature key not matched" → `INVALID`;
  - anything else → `INCONCLUSIVE`, and the status becomes `UNVERIFIED_UNTIL_FIRST_PAYMENT`. The first real payment is then verified with Search Transaction, and a mismatch disables the account.
  
  This behavior was **observed in the sandbox only** (2026-09-17). Live behavior is UNVERIFIED (PAY-014).
- **Environment separation.** Each account's `environment` must equal `AAMARPAY_ENV`: staging is `sandbox` only, production is `live` only. The startup and use-case checks refuse any mismatch.
- **Platform collection of patient fees is gated.**
  - `PAYMENTS_PLATFORM_COLLECTION_ENABLED` defaults to `false`.
  - With `APP_ENV=production`, it can be `true` only when the platform audit record `PAYMENTS_PLATFORM_COLLECTION_GATE_CLOSED` exists. That record references a legal/financial review (payment aggregation/facilitation status, tax, accounting, payout obligations), is recorded by `pnpm ops:record-risk-decision --gate GATE-PAY-PLATFORM-COLLECTION`, and must not be expired.
  - Otherwise `PLATFORM_MERCHANT` rows for patient fee types cannot be activated (`POLICY_BLOCKED`, reason `PLATFORM_COLLECTION_GATE_OPEN`).
  - The design is complete regardless: a settlement ledger, **manual** payout records, and platform commission configuration (`platform_commission_bps`, default **0**, a business decision).
  - Local and staging may enable it with synthetic data.

### 3. Server-authoritative flow

1. **Client request.** The client calls `POST /payments/intents {purpose, businessReference, returnChannel}` with an `Idempotency-Key`. **No amount is accepted.** An `amount` field is rejected by schema (`VALIDATION_FAILED`), which makes client-amount tampering visible in tests.
2. **Server setup.** The server authorizes the payer, resolves the business reference (appointment, subscription invoice), **computes the amount from `fee_schedules`** (or the invoice), resolves the merchant account, and creates the intent (`CREATED`) with an opaque `tran_id`. It then calls `initiate` **from the server only**. The signature key never reaches web or mobile.
3. **Redirect.** The server stores `payment_url` as a hash, sets the intent to `REDIRECTED`, and returns `paymentUrl`.
   - Web navigates to it.
   - Mobile opens it in an external Custom Tab / SFSafariViewController, never a WebView that injects credentials. **aamarPay's Flutter package and Android library are not used**, because they require the store ID and signature key on the device.
4. **Return endpoints.** `success_url` / `fail_url` / `cancel_url` = `{API_PUBLIC_URL}/api/v1/payments/aamarpay/return/{intentId}/{success|fail|cancel}`. The endpoint:
   - treats the POSTed body as **untrusted**, stores it **redacted** in `payment_gateway_events`, and moves the intent to `PENDING_VERIFICATION` if it is not already terminal;
   - loads the intent by path id **and** checks that the body's `mer_txnid` equals the intent's `tran_id` (a mismatch → event flagged `SUSPECT_FORGERY`, intent untouched);
   - calls **Search Transaction** with the **intent's own merchant credentials** (never credentials derived from the request);
   - sets `PAID` **only if every one of these holds** in the Search Transaction result:
     - `status_code = "2"`;
     - `mer_txnid = intent.tran_id`;
     - `store_id` = the merchant account's store ID;
     - `amount` (decimal string parsed exactly) = `intent.amount`;
     - `currency = "BDT"`, and `currency_merchant = "BDT"` when present;
   - redirects the browser (`303`) to `PAYMENT_RETURN_BASE_URL/payments/result/{intentId}`. The URL carries the opaque intent id only, with no status. The result page reads the status from the API.
5. **IPN.** `POST /payments/aamarpay/ipn` follows the same verify-then-transition logic. It is idempotent and tolerates at-least-once and out-of-order delivery. The IPN's own signature is **not** relied on: its scheme is undocumented, and the IPN only triggers verification.
6. **Reconciliation.** `ReconcilePaymentIntents` (every 5 min) re-verifies intents in `REDIRECTED`/`PENDING_VERIFICATION` older than 2 min, using backoff per intent. It expires intents past `expires_at` whose Search Transaction shows no success.
7. **Commit on PAID.** In **one transaction**: the intent becomes `PAID`, `payment_verifications` is inserted, balanced `ledger_entries` are written, and the outbox event `PaymentSucceeded` is emitted.
   - Consumers update appointment or subscription state asynchronously (§5).
   - **A payment event never changes clinical data**. This is a dependency rule: `payments` may not import `clinical`/`prescriptions`, and payment handlers cannot resolve clinical write use cases.

### 4. Payment intent state machine

```text
CREATED ──initiate ok──> REDIRECTED ──callback/IPN/reconcile──> PENDING_VERIFICATION ──verified success──> PAID
   │                          │                                        ├── verified failure (status 7) ──> FAILED
   │ initiate rejected        │ cancel return + not successful         ├── cancel + not successful ─────> CANCELLED
   └──> FAILED                └──> CANCELLED                           └── expires_at passed + not successful ──> EXPIRED
PAID ──refund recorded──> REFUND_PENDING ──refund confirmed (manual)──> REFUNDED
FAILED | CANCELLED | EXPIRED ──verified success (late)──> PAID with late_payment=true, manual_review_status=OPEN
```

- **Verified success always wins**, because the money moved. A late success sets `late_payment=true`. Consumers do **not** auto-confirm a business reference whose hold was released; staff resolve the open review by honoring the booking or refunding.
- **Refunds are manual**, because aamarPay documents no refund API. Staff issue the refund in the aamarPay merchant panel or through support, then record it: `REFUND_PENDING` with an evidence reference, then `REFUNDED` on confirmation. If a refund API is later verified, an ADR amendment adds it behind the same states.
- **Row version:** every transition uses `row_version`. The verification lock order is `payment_intents` row → business reference row.

### 5. Business rules

- **Payment never blocks the manual clinical workflow.** A patient already in the queue can always be consulted, and payment status is informational for clinical screens.
- **Per-chamber policy flags:**
  - `chamber_payment_mode`: `PAY_AT_CHAMBER` (default) | `PREPAID_REQUIRED` | `OPTIONAL_ONLINE`;
  - `telemedicine_payment_mode`: `PREPAID_REQUIRED` (default) | `OPTIONAL_ONLINE` | `PAY_AT_CHAMBER` (the last is not meaningful for remote care and is disallowed by CHECK for `REMOTE` bookings).
- **Prepaid bookings:**
  - The appointment is created as `PENDING_PAYMENT` with `payment_hold_expires_at = now + PAYMENT_INTENT_TTL_MINUTES`. It reserves slot capacity, and **no serial is issued**.
  - `PaymentSucceeded` → the `ConfirmPaidAppointment` job sets the appointment to `BOOKED` and issues the serial through `IssueAppointmentSerial`.
  - `PaymentExpired`/`PaymentFailed`/`PaymentCancelled` → `ReleasePaymentHold` cancels the appointment with reason `PAYMENT_NOT_COMPLETED` and frees capacity.
  - **Staff override:** `POST /appointments/{id}/payment-override {reason}` (`appointment.write`) confirms the appointment without payment. It is audited and marks `payment_waived=true`.
- **`cus_email` is required by aamarPay.** The value used is, in order:
  1. the payer's verified email if they have one;
  2. otherwise the tenant's `payment_contact_email`;
  3. otherwise the platform `PAYMENT_PLATFORM_NOREPLY_EMAIL`.
  
  **Per-patient emails are never fabricated.** The consequence, that gateway receipts may go to the clinic or the no-reply address, is documented in the payment UI copy.
- **Minimal data to the gateway:**
  - `cus_name` = the **payer's** display name (the account user, not a dependent patient);
  - `cus_phone` = the payer's verified phone;
  - `desc` = `HMEDIC-<8-char intent short ref>`;
  - `opt_a` = intent id; `opt_b`–`opt_d` unused;
  - no clinic specialty, doctor name, service description or clinical information.
- **Money:**
  - `DECIMAL(12,2)` in the database;
  - decimal **strings** in APIs and events (`"500.00"`);
  - arithmetic in the kernel `Money` value object as integer paisa (`bigint`);
  - parsing accepts only `^\d{1,10}(\.\d{1,2})?$`;
  - **no floating-point money anywhere** (lint rule `hmedic/no-float-money` on `Money`-typed fields plus schema tests).

### 6. Ledger (double-entry-lite)

- `ledger_entries` is append-only and hash-chained per tenant. Every posting group (`posting_id`) must sum to zero, checked in the use case and in the chain verification job.
- **PAID on `DOCTOR_MERCHANT`:** memo postings only (the money went to the doctor's store). `GATEWAY_RECEIVED +amount` / `MERCHANT_DIRECT_REVENUE −amount`, plus fee postings from Search Transaction `processing_charge` if present.
- **PAID on `PLATFORM_MERCHANT`, patient fee:**
  - `GATEWAY_CLEARING +amount`;
  - `GATEWAY_FEE +fee` / `GATEWAY_CLEARING −fee`;
  - `PLATFORM_COMMISSION −commission`;
  - `DOCTOR_PAYABLE −(amount − fee − commission)` (fee bearer: `PAYMENT_GATEWAY_FEE_BEARER`, default `DOCTOR`, business decision).
- **Subscription:** `GATEWAY_CLEARING +amount` / `PLATFORM_SUBSCRIPTION_REVENUE −amount`, plus fee postings.
- **Refunds and payouts** post reversing or settling entries. **Payouts are manual**: a platform operator records a bank/MFS transfer reference. No automated disbursement exists.
- **Fee:** the gateway fee is `processing_charge` from Search Transaction. If absent, fee = `amount − rec_amount`. If neither is present, the posting is flagged `fee_unverified=true`.

### 7. Hosting

- **Callback and IPN URLs** are public HTTPS on `api.<domain>`. They are unauthenticated, rate-limited, and **not** cookie endpoints, so CSRF does not apply; they are protected by server-side verification.
- **Cross-site POSTs** from the gateway carry no session cookies, and none are needed.
- **The IPN URL is registered per store with aamarPay support.** Doctor stores must request it themselves, and reconciliation covers stores without an IPN.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Trust the success POST body | Forgeable; aamarPay recommends Search Transaction |
| aamarPay Flutter/Android SDK | Puts the signature key in the app |
| Client-supplied amount | Tampering |
| Platform collects all patient fees | Unresearched regulated activity; gated instead |
| Wait for a refund API | Refunds are needed from day one; recorded manually |

## Consequences

- Payments are fully implementable and testable with the mock gateway and aamarPay sandbox fixtures.
- The signature key in the Search Transaction query string is a provider-side limitation. It is never logged on our side, and PAY-014 asks aamarPay for a POST alternative.
- Doctor-merchant mode works without any legal gate. Platform-collected patient fees stay disabled in production until `GATE-PAY-PLATFORM-COLLECTION` closes.
