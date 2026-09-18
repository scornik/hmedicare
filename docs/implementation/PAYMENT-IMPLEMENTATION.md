# Payment Implementation Contract

**Stage 3.2 (2026-09-17).**

- **Decision:** ADR-019.
- **Gateway evidence:** `AAMARPAY-VERIFICATION.md`.
- **Tables:** `DATABASE-IMPLEMENTATION.md` §3.15, §3.17, §3.18 and §3.5 (appointment payment columns).

**No legal, financial or regulatory compliance claim.**

## 1. Components

| Component | Package | Responsibility |
|---|---|---|
| `Money` | `packages/kernel` | Parses `^\d{1,10}(\.\d{1,2})?$` into paisa (`bigint`); add, subtract, basis points (banker's rounding **not** used: half-up to the paisa, documented); `toString()` → `"500.00"`. No `number` API |
| `FeeResolver` | `packages/payments/src/domain` | Selects the fee schedule (§3.1) |
| `MerchantResolver` | `packages/payments/src/application` | Selects the merchant account and enforces gates (§3.2) |
| `PaymentIntentService` | `packages/payments/src/application/commands` | `CreatePaymentIntent`, `CancelSupersededIntent` |
| `PaymentVerificationService` | `packages/payments/src/application` | Search Transaction call + match rule + transition + ledger (§5) |
| `LedgerPoster` | `packages/payments/src/domain/ledger` | Builds balanced postings; appends through `AppendOnlyRepository` with chain |
| `PaymentGatewayPort` | `packages/payments/src/application/ports` | ADR-019 §1 interface |
| `AamarPayGatewayAdapter` | `packages/payment-adapters/aamarpay` | HTTPS only; JSON initiate; GET Search Transaction with URL redaction; parsers per AAMARPAY-VERIFICATION §2 |
| `MockPaymentGateway` | `packages/payment-adapters/mock` (also served by `mock-providers` at `/aamarpay/*`, with a fake hosted payment page) | Scenarios in §10 |
| `ProviderCredentialVault` | `packages/provider-credentials` | Create/validate/revoke `provider_credentials`; `resolveForAdapter(credentialId, purpose)` returns an in-process handle; the plaintext exists only inside the adapter call |
| `SecretEnvelopePort` / `AesGcmEnvelopeAdapter` | `packages/secrets` | Shared by `ai` (AI KEK) and `provider-credentials` (provider KEK) |
| `GateDecisionReader` | `packages/secrets` (platform gate reader) | Reads `platform_gate_decisions` |
| Jobs (worker) | `packages/payments/src/nest/PaymentsWorkerModule` | `ReconcilePaymentIntents`, `ConfirmPaidAppointment`, `ReleasePaymentHolds`, `GenerateSubscriptionInvoices`, `ValidateMerchantCredential` |

**Dependency rules** (dependency-cruiser; `REPOSITORY-STRUCTURE.md` §4):
- `payments` must not import `clinical`, `prescriptions`, `laboratory-documents` or `ai`;
- only `payment-adapters/*` may perform gateway HTTP calls;
- web and mobile never import payment adapters.

## 2. Configuration

- **Environment variables:** `AAMARPAY_ENV`, `AAMARPAY_BASE_URL`, `AAMARPAY_PLATFORM_STORE_ID`, `AAMARPAY_PLATFORM_SIGNATURE_KEY`, `PAYMENT_RETURN_BASE_URL`, `PAYMENT_INTENT_TTL_MINUTES` (30), `PAYMENTS_PLATFORM_COLLECTION_ENABLED` (`false`), `PAYMENT_PLATFORM_NOREPLY_EMAIL`, `PAYMENT_GATEWAY_TIMEOUT_MS` (10000), `PAYMENT_HOLD_GRACE_MINUTES` (10), `PAYMENTS_ENABLED` (`true` local/staging; production `false` until PAY-014 is done). Full list: `ENVIRONMENT-CONTRACT.md` §6.
- **Startup checks** (fail closed in staging/production):
  - `AAMARPAY_BASE_URL` is `https://sandbox.aamarpay.com` when `AAMARPAY_ENV=sandbox`, and `https://secure.aamarpay.com` when `live`;
  - staging requires `sandbox`, production requires `live`;
  - `PAYMENTS_PLATFORM_COLLECTION_ENABLED=true` in production requires the gate decision (§3.2).

## 3. Fees and merchant selection

### 3.1 Fee resolution

**Input:** tenant, purpose, appointment (doctor, chamber, care mode, source), instant `t` = booking time.

1. **Fee type:**
   - `APPOINTMENT_FEE` with care mode `PHYSICAL`/`HYBRID` → `CHAMBER_CONSULTATION`;
   - care mode `REMOTE` → `TELEMEDICINE_CONSULTATION` (purpose `TELEMEDICINE_FEE`);
   - appointment source `FOLLOW_UP` → `FOLLOW_UP` if a schedule exists, otherwise the base type;
   - `REPORT_REVIEW_FEE` → `REPORT_REVIEW`.
2. **Schedule:** the first `ACTIVE` schedule with `effective_from <= t < effective_to`, in the order `CHAMBER` (chamber) → `DOCTOR` (doctor) → `TENANT`.
3. **No schedule** → `FEE_NOT_CONFIGURED` (409). The UI falls back to pay-at-chamber. **Amount `0.00`** → `PAYMENT_NOT_REQUIRED` (409), and the booking proceeds without payment.
4. **The amount is copied onto the intent** (`amount`, `fee_schedule_id`). A later fee change never alters an existing intent.

### 3.2 Merchant resolution (patient fees)

1. Doctor-owned `DOCTOR_MERCHANT` account (appointment doctor), status `ACTIVE` or `UNVERIFIED_UNTIL_FIRST_PAYMENT`, with the fee type in `fee_types_enabled`, and `environment = AAMARPAY_ENV`.
2. Clinic-owned `DOCTOR_MERCHANT` account (appointment chamber's clinic), same conditions.
3. The tenant's `PLATFORM_MERCHANT` row with the fee type enabled, `tenant_payment_settings.platform_collection_opt_in = 1`, `PAYMENTS_PLATFORM_COLLECTION_ENABLED=true`, and, **if `APP_ENV=production`**, `GATE-PAY-PLATFORM-COLLECTION` closed (`GateDecisionReader`).
   - If only the gate fails → `POLICY_BLOCKED` (reason `PLATFORM_COLLECTION_GATE_OPEN`).
   - Activating such a row while the gate is open leaves it `BLOCKED_BY_GATE`.
4. None → `PAYMENT_METHOD_UNAVAILABLE` (409).

**Subscriptions** always use the platform merchant (env credentials) with `merchant_account_id = NULL`. There is no gate.

## 4. Creating an intent

`POST /payments/intents` — body `{purpose, businessReference: {type, id}, returnChannel}`. `Idempotency-Key` is required. **Any `amount`, `currency`, `storeId` or `merchant*` field → `VALIDATION_FAILED`** (`.strict()` schema).

**Authorization:**
- `APPOINTMENT_FEE`/`TELEMEDICINE_FEE`/`FOLLOW_UP_FEE`/`REPORT_REVIEW_FEE`:
  - a patient context for the appointment's patient: `SELF`, or a guardian with scope `MAKE_PAYMENTS`; **or**
  - staff with `payment.create` in the appointment's chamber scope (`acting_as=STAFF`).
- `SUBSCRIPTION`: tenant member with `payment.create` **and** `tenant.manage`.

**Steps:**
1. Transaction A (READ COMMITTED):
   1. lock the business reference row (appointment or invoice);
   2. check eligibility: appointment `PENDING_PAYMENT` (prepaid) or `BOOKED` with `payment_requirement=OPTIONAL` and `payment_status=PENDING`; or invoice `OPEN`/`OVERDUE`;
   3. already paid → `PAYMENT_ALREADY_PAID`; hold expired → `PAYMENT_INTENT_EXPIRED`;
   4. if an open intent exists for the reference, remember its id;
   5. resolve fee and merchant (§3), then insert the intent: `CREATED`, `tran_id`, `short_ref`, `expires_at = min(now + PAYMENT_INTENT_TTL_MINUTES, appointment.payment_hold_expires_at)`.
   
   Commit. (With an existing open intent, the insert waits for step 2's supersede and is retried; the generated unique `uq_intent_open_business` guarantees one open intent.)
2. **Supersede an existing open intent** (outside the transaction):
   1. Search Transaction for the old `tran_id`;
   2. `MATCHED_SUCCESS` → run §5 on the old intent and return `PAYMENT_ALREADY_PAID`;
   3. otherwise mark the old intent `CANCELLED` (`failure_reason=SUPERSEDED`), then insert the new one.
3. **Call `PaymentGatewayPort.initiate` outside any transaction.** Customer fields per ADR-019 §5, URLs:
   ```text
   success_url = {API_PUBLIC_URL}/api/v1/payments/aamarpay/return/{intentId}/success
   fail_url    = …/fail
   cancel_url  = …/cancel
   ```
4. Transaction B:
   - insert `payment_attempts`;
   - `CREATED` response → intent `REDIRECTED`, audit, outbox `PaymentIntentCreated`;
   - `REJECTED` → intent `FAILED` (`failure_reason`), outbox `PaymentFailed`, error `PAYMENT_GATEWAY_REJECTED` (502; `MERCHANT_CREDENTIAL_INVALID` also sets the account `INVALID` and alerts);
   - `UNKNOWN_OUTCOME` → intent `FAILED` (`GATEWAY_UNKNOWN_OUTCOME`), error `PAYMENT_GATEWAY_UNAVAILABLE` (503).
5. **Response:** `201 {intentId, status: "REDIRECTED", amount: "500.00", currency: "BDT", expiresAt, paymentUrl}`.
   - `paymentUrl` is returned **only** in this response. It is never logged, and the DB stores only its SHA-256.
   - The idempotency snapshot excludes `paymentUrl`. A replay returns the same intent with `paymentUrl: null`; a client that lost the URL calls `POST /payments/intents` again with a **new** key, which supersedes the open intent (step 2).

## 5. Return, IPN and verification

### 5.1 Return endpoint

`POST|GET /payments/aamarpay/return/{intentId}/{result}`, with `result` ∈ `success|fail|cancel`.
- **Access:** public, rate-limited (`payment_return:ip` 60/min).
- **Body parsing:** form or JSON, max 32 KB. `GET` is accepted for `cancel`, per UNVERIFIED PAY-AAM-01.
- **CSRF:** not applicable (no cookies). The route is excluded from any cookie/CSRF middleware.

**Steps:**
1. Parse `intentId`. If it is unknown, store the event as unmatched and redirect to the generic result page.
2. Insert `payment_gateway_events`:
   - `source=RETURN_*`, redacted allow-listed payload;
   - `suspect_forgery=1` if the body has `mer_txnid ≠ intent.tran_id`, or a `store_id` whose last 4 ≠ the account's;
   - a duplicate `dedupe_key` → reuse the existing event.
3. If the intent is `CREATED`/`REDIRECTED`, set it to `PENDING_VERIFICATION` (`expectedRowVersion` loop).
4. Call `PaymentVerificationService.verify(intent, trigger=RETURN, eventId)` with a 10 s budget.
5. **Always** respond `303 Location: {PAYMENT_RETURN_BASE_URL}/payments/result/{intentId}`. Status is never placed in the URL.
   - Mobile uses Android App Links / iOS Universal Links on that exact path, so the app opens on the result screen; otherwise the web page shows the result.

**Forged success POSTs.** A forged body cannot change state, because §5.3 uses only the Search Transaction response fetched with the intent's own credentials. When `suspect_forgery=1` **and** verification returns no success, `payment_callback_forgery_suspected_total` is incremented and a security audit event is written.

### 5.2 IPN endpoint

`POST /payments/aamarpay/ipn` is public and rate-limited.
1. Store the event (`source=IPN`) and match it by `mer_txnid` → `tran_id`. If there is no match, set `unmatched=1` and respond `200 OK`.
2. Call `verify(intent, trigger=IPN)` with a 10 s budget; on timeout, leave it to reconciliation.
3. Respond `200 text/plain "OK"`.

**Idempotency:** the dedupe key, plus the fact that verifying an already `PAID` intent is a no-op (it inserts a `payment_verifications` row only when the result differs from the recorded one).

### 5.3 `PaymentVerificationService.verify`

1. Load the intent and its merchant account (or the platform env credentials for subscriptions). Resolve the credential handle.
2. `searchTransaction(tran_id)` **outside** any transaction. The adapter builds the GET URL internally, disables HTTP client request logging for this call, and applies a 10 s timeout.
3. **Evaluate the result:**
   - `CREDENTIAL_MISMATCH` → account `INVALID`, alert, result recorded, intent unchanged;
   - `NOT_FOUND` / `UNAVAILABLE` / `UNPARSEABLE` → result recorded, intent unchanged (reconciliation retries);
   - a record with `status_code` ≠ `"2"` → `NOT_SUCCESSFUL`: `"7"` → `FAILED` (`GATEWAY_FAILED`), `"3"` → `EXPIRED`, `"0"` → unchanged. A `RETURN_CANCEL` trigger with `"0"` or not found → `CANCELLED`.
   - a record with `status_code = "2"` → apply the **match rule** (AAMARPAY-VERIFICATION §2.3: `mer_txnid`, `store_id`, `amount` exact in paisa, `currency`, `currency_merchant`):
     - mismatch → `MISMATCH` with `mismatch_fields`, alert `payment_verification_mismatch`, intent unchanged, `manual_review_status=OPEN`;
     - match → `MATCHED_SUCCESS`.
4. **On `MATCHED_SUCCESS`**, in one transaction (READ COMMITTED):
   1. lock the intent row, then the business reference row;
   2. if already `PAID` with the same `pg_txnid`, record nothing and stop (idempotent);
   3. insert `payment_verifications`;
   4. set the intent `PAID`, `paid_at`, `verified_pg_txnid`;
   5. if the previous status was `FAILED`/`CANCELLED`/`EXPIRED`, or the business reference is no longer awaiting payment (hold released, already paid by another intent), set `late_payment=1`, `manual_review_status=OPEN`;
   6. post ledger entries (§6);
   7. an `UNVERIFIED_UNTIL_FIRST_PAYMENT` merchant account → `ACTIVE`;
   8. audit `PAYMENT_VERIFIED`, outbox `PaymentSucceeded {intentId, purpose, businessType, businessId, late}`.
   
   Commit.
5. **Non-success transitions** use the same lock order and emit `PaymentFailed` / `PaymentExpired` / `PaymentCancelled`.
6. **Metrics:** `payment_verification_duration_seconds{trigger,result}`, `payment_verification_mismatch_total{field}`.

**Concurrency.** A return request and an IPN can arrive together. Both may call Search Transaction, but the `PAID` transition runs under the intent row lock with a status check, so exactly one ledger posting is written. This is tested.

## 6. Ledger postings

**Amount terms:**
- `A` = intent amount;
- `F` = gateway fee (`processing_charge`, else `amount − rec_amount`, else `0` with `fee_unverified=1`);
- `C` = `A × platform_commission_bps / 10000`, rounded half-up to the paisa. It applies to `PLATFORM_MERCHANT` patient fees only; `DOCTOR_MERCHANT` has no platform commission in MVP.

| Case | Postings (`account amount`) |
|---|---|
| `DOCTOR_MERCHANT` PAID | `GATEWAY_RECEIVED +A`, `MERCHANT_DIRECT_REVENUE −A`; if F > 0: `GATEWAY_FEE +F`, `GATEWAY_RECEIVED −F` |
| `PLATFORM_MERCHANT` patient fee PAID, fee bearer `DOCTOR` | `GATEWAY_CLEARING +A`, `GATEWAY_FEE +F`, `GATEWAY_CLEARING −F`, `PLATFORM_COMMISSION −C`, `DOCTOR_PAYABLE −(A − F − C)` |
| same, fee bearer `PLATFORM` | `GATEWAY_CLEARING +A`, `GATEWAY_FEE +F`, `GATEWAY_CLEARING −F`, `PLATFORM_COMMISSION −(C − F)`, `DOCTOR_PAYABLE −(A − C)` |
| Subscription PAID | `GATEWAY_CLEARING +A`, `GATEWAY_FEE +F`, `GATEWAY_CLEARING −F`, `PLATFORM_SUBSCRIPTION_REVENUE −A` |
| Refund COMPLETED | the reversal of the PAID posting's revenue/payable lines against `REFUNDS`; gateway fee reversal only if aamarPay refunds it (unknown → no fee reversal, `ADJUSTMENT` later) |
| Payout PAID | `DOCTOR_PAYABLE +X`, `PAYOUTS_CLEARING −X` per payout item |

- **Sign convention:** positive = debit-side asset or expense, negative = credit.
- **Sum-zero:** every row above sums to zero. The unit test enumerates every case, including `C = 0` and `F = 0`.
- **Guard:** if `A − F − C < 0`, the posting is rejected and an alert fires; the configuration must be fixed.

## 7. Business integration

- **Booking with prepaid required** (`CreateAppointment`):
  - applies when the chamber's `chamber_payment_mode=PREPAID_REQUIRED`, or when care mode is `REMOTE` with `telemedicine_payment_mode=PREPAID_REQUIRED`, and the fee is > 0;
  - the appointment is created as `PENDING_PAYMENT` with `payment_requirement=PREPAID`, `payment_status=PENDING` and `payment_hold_expires_at = now + PAYMENT_INTENT_TTL_MINUTES + PAYMENT_HOLD_GRACE_MINUTES`;
  - the slot's `booked_count` is incremented, **no serial is issued**, and `issueSerial` is ignored;
  - the response includes `paymentRequired: true`, `paymentHoldExpiresAt` and a server `quote {amount, currency, feeType}` from `FeeQuotePort` (display only; the intent recomputes it). The client then calls `POST /payments/intents`.
- **`OPTIONAL_ONLINE`:** the appointment is `BOOKED`, the serial is issued normally, `payment_requirement=OPTIONAL` and `payment_status=PENDING`. Payment is optional.
- **`PAY_AT_CHAMBER`:** `payment_requirement=NONE`, `payment_status=NOT_REQUIRED`. Collection at the desk is not tracked in MVP (Future cash ledger).
- **Consumer `ConfirmPaidAppointment`** (on `PaymentSucceeded` with `businessType=APPOINTMENT`):
  1. lock the appointment;
  2. if `PENDING_PAYMENT` and `late=false`: set `BOOKED`, `payment_status=PAID`, then `IssueAppointmentSerial` (queue facade `AppointmentCommandFacade`; the serial's day lock order is appointment → chamber day → serials);
  3. if already `BOOKED` (optional online): set `payment_status=PAID`;
  4. if `CANCELLED` because of `PAYMENT_NOT_COMPLETED` (late): try to re-reserve capacity and re-book. If capacity is gone, leave it `CANCELLED` and keep the intent's `manual_review_status=OPEN`, and notify the tenant's payment staff.
  - **Clinical tables are never touched.**
- **`ReleasePaymentHolds`** (every 5 min): `PENDING_PAYMENT` past `payment_hold_expires_at`, with no `PAID` intent and no `PENDING_VERIFICATION` intent younger than 10 min → `CANCELLED` (`cancel_reason=PAYMENT_NOT_COMPLETED`), `payment_status=PENDING`, capacity decremented. Outbox `AppointmentCancelled`.
- **Staff waiver:** `POST /appointments/{id}/payment-override {reason, expectedRowVersion}` (`appointment.write`):
  - `PENDING_PAYMENT` → `BOOKED`, `payment_status=WAIVED` with reason and actor, serial issued;
  - any open intent is cancelled (`SUPERSEDED`);
  - audited.
- **Reports:** `PaymentReportPort` (read-only) gives staff an informational payment status for serials and encounters. It is never a clinical gate.
- **Subscriptions:**
  - `GenerateSubscriptionInvoices` (daily 03:00 Asia/Dhaka) creates `OPEN` invoices 7 days before `current_period_end`, marks `OVERDUE` after `due_date`, and sets the subscription to `PAST_DUE`. The status is informational only.
  - On `PaymentSucceeded` for an invoice: invoice `PAID`, `paid_intent_id` set, subscription period advanced, `ACTIVE`.

## 8. Refunds, payouts, manual review

- **Refunds** (manual; PAY-AAM-07):
  - `POST /payments/intents/{id}/refunds {reason}` (`refund.manage`): intent `PAID` → `REFUND_PENDING`; inserts `refunds` `PENDING` (full amount); audit; the UI shows instructions for refunding in the aamarPay merchant panel.
    - Tenant staff may refund only `DOCTOR_MERCHANT` intents of their tenant.
    - `PLATFORM_MERCHANT` intents require a platform operator with `platform.refund.manage`.
  - `POST /refunds/{id}/complete {evidenceRef}` → refund `COMPLETED`, intent `REFUNDED`, ledger reversal, outbox `RefundRecorded`, appointment `payment_status=REFUNDED` (the appointment itself is not cancelled automatically).
  - `POST /refunds/{id}/cancel {reason}` → refund `CANCELLED`, intent back to `PAID`.
- **Payouts** (platform operator, `payout.manage`; `PLATFORM_MERCHANT` only):
  - `GET /platform/payouts/preview?tenantId=&doctorProfileId=&periodEnd=` lists unpaid `DOCTOR_PAYABLE` entries;
  - `POST /platform/payouts` creates a `DRAFT` with items;
  - `POST /platform/payouts/{id}/mark-paid {transferMethod, transferReference}` → `PAID` + ledger;
  - all audited on the tenant and platform chains. **No automated disbursement.**
- **Manual review:** `POST /payments/intents/{id}/review {resolution: HONOR|REFUND, reason}` (`payment.merchant.manage` for doctor-merchant intents; platform operator with `platform.refund.manage` for platform-merchant intents).
  - `HONOR` requires capacity or a staff override and runs the booking confirmation.
  - `REFUND` starts the refund flow.

## 9. Endpoints

| Method / path | Use case | Permission / scope | Tx | Idem |
|---|---|---|---|---|
| `POST /payments/intents` | CreatePaymentIntent | patient context (`SELF` or guardian `MAKE_PAYMENTS`) / `payment.create` (+ `tenant.manage` for subscriptions) | RC | ✓ |
| `GET /payments/intents` | ListPaymentIntents (`status`, `purpose`, `from`, `to`, `cursor`) | `payment.read` (tenant scope) | – | – |
| `GET /payments/intents/{id}` | GetPaymentIntent (status, amount, purpose, business ref, late flag, refund state; **no** gateway payload, **no** store ID) | payer user / patient context / `payment.read` | – | – |
| `POST /payments/intents/{id}/review` | ResolvePaymentReview | see §8 | RC | ✓ |
| `POST /payments/intents/{id}/refunds` · `POST /refunds/{id}/complete` · `/cancel` | refunds | `refund.manage` (see §8) | RC | ✓ |
| `POST /payments/aamarpay/return/{intentId}/{result}` (also `GET` for `cancel`) | HandleGatewayReturn | public, rate-limited, verification-protected | RC | – |
| `POST /payments/aamarpay/ipn` | HandleGatewayIpn | public, rate-limited, verification-protected | RC | – |
| `GET /tenant/fee-schedules` · `PUT /tenant/fee-schedules` | List / SetFeeSchedules (full replacement set per scope target; `expectedRowVersion` per changed row) | `fee.manage` (doctor: own `DOCTOR` scope only if granted) | RC | ✓ PUT |
| `GET /tenant/payment-merchant-accounts` · `POST /tenant/payment-merchant-accounts` · `DELETE /tenant/payment-merchant-accounts/{id}` | List / CreateMerchantAccount (`DOCTOR_MERCHANT`: body carries `storeId`, `signatureKey` write-only; `PLATFORM_MERCHANT`: opt-in row) / DisableMerchantAccount (revokes the credential) | `payment.merchant.manage` (doctor-owned: that doctor; clinic-owned and platform opt-in: `tenant_owner`/`clinic_admin` with the permission) | RR | ✓ POST |
| `POST /tenant/payment-merchant-accounts/{id}/validate` | ValidateMerchantCredential (job) | `payment.merchant.manage` | – | ✓ |
| `GET/PUT /tenant/payment-settings` | payment contact email, platform collection opt-in | `payment.merchant.manage`; commission field read-only | RR | – |
| `POST /appointments/{id}/payment-override` | WaiveAppointmentPayment | `appointment.write` + reason | RC | ✓ |
| `GET /platform/payouts/preview` · `POST /platform/payouts` · `POST /platform/payouts/{id}/mark-paid` | payouts | platform `payout.manage` | RC | ✓ POST |
| `PUT /platform/tenants/{tenantId}/payment-commission` | SetPlatformCommission | platform `payout.manage` | RR | ✓ |
| `GET /tenant/subscription` · `GET /tenant/subscription/invoices` | subscription read | `tenant.manage` or `payment.read` | – | – |

## 10. Mock gateway scenarios

The mock is selected by `PAYMENT_GATEWAY_ADAPTER=mock` (local/CI default). Tests choose the next scenario per `tran_id` through the mock control endpoint `POST /__mock/aamarpay/scenarios {tranId, scenario}`, which exists only in `mock-providers`; the manual default is `success`. No amount-based magic values are used:

| Scenario | Behavior |
|---|---|
| `success` | payment page → return `success` POST; Search `status_code "2"`, matching fields; IPN sent once |
| `fail` | return `fail`; Search `"7"` |
| `cancel` | return `cancel` (GET, no body); Search `Invalid-Data` |
| `expire` | no return; Search `"3"` after TTL |
| `amount_mismatch` | Search `"2"` with `amount` + 1.00 |
| `store_mismatch` | Search `"2"` with another `store_id` |
| `forged_success_post` | a success POST with `status_code "2"` sent **without** any gateway record (Search `Invalid-Data`) |
| `duplicate_ipn` | IPN delivered 3× (one out of order before return) |
| `search_timeout` | Search sleeps past `PAYMENT_GATEWAY_TIMEOUT_MS` twice, then succeeds |
| `initiate_invalid_key` | `{"result":false,"message":"Invalid Signature Key"}` |
| `initiate_timeout` | initiate hangs past the timeout |
| `late_success` | intent expired by the job; Search later shows `"2"` |
| `credential_check` | Search with random id → `Invalid-Data` (valid) or `Store_id & signature key not matched` (invalid) |

Response bodies mirror AAMARPAY-VERIFICATION §2 and §4 (JSON served as `text/html` for Search, plain-text mismatch body).

## 11. Tests (blocking)

**Unit:**
- `Money` parsing and arithmetic;
- fee resolution precedence;
- merchant resolution truth table (gate open/closed × opt-in × accounts × environment);
- ledger cases (§6) sum to zero;
- intent state machine (all edges, late payments);
- verification match rule (each field mismatch).

**Integration:**
- concurrent return + IPN produce exactly one `PAID` and one posting;
- the reconciliation job expires and flips late payments;
- hold release frees capacity;
- `ConfirmPaidAppointment` issues exactly one serial;
- the `open_business_key` unique prevents two open intents;
- an idempotent replay returns the same intent without `paymentUrl`.

**Security** (`SECURITY-IMPLEMENTATION.md` T18–T25): forged success POST; amount tamper; cross-tenant callback; replayed IPN; signature key never in responses, logs, bundles or snapshots; doctor cannot read another doctor's merchant credential; client amount ignored or rejected; expired intent late success flagged.

**Contract:** the aamarPay adapter against `mock-providers` on localhost, with the production parsers and an HTTPS-only check that is relaxed solely by `AAMARPAY_BASE_URL_OVERRIDE` in `APP_ENV=test`; the URL redaction test (no `signature_key` in any captured log line or error).

**E2E:**
- web: patient pays for a prepaid appointment (mock page) → result page → serial visible;
- mobile integration: external tab + deep-link result.

**Architecture:** `payments` cannot import clinical packages; the worker DI container for payment handlers cannot resolve clinical write use cases.
