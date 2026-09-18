# Stage 3.2 Changelog — Provider Selection: Zaman IT SMS/OTP, aamarPay Payments, Medicine Dataset Import

**Date:** 2026-09-17. **Scope:** documentation, ADRs, contracts and backlog only.

**Stage constraints, all observed:**
- no product code was written;
- no real credentials appear anywhere;
- no SMS was sent;
- no payment was created or made;
- reference repositories and Stage M outputs were not modified;
- no legal, financial or regulatory compliance claim is made.

## 1. Why

Stage 3.1 left three external decisions open. The product owner has now made them:
- **SMS/OTP:** Zaman IT.
- **Payments:** aamarPay, with payments entering MVP.
- **Medicine data:** import the Stage M dataset.

Each decision carries risks that must be encoded, not just documented:
- a plain-HTTP bare-IP SMS API;
- untrusted gateway callbacks, and a signature key in a query string;
- possibly regulated collection of patient fees by the platform;
- an `UNVERIFIED` medicine dataset.

## 2. Evidence gathered in this stage

| Source | What was done | Result |
|---|---|---|
| Zaman IT dashboard facts (brief) | Recorded as INPUT | `ZAMANIT-VERIFICATION.md` §1 |
| `zaman-it.com/sms-api/` | Fetch attempted once; the page returned a bot-verification interstitial. **Not bypassed** | Search-index snippet only ("only delivered SMS are charged", GET sample), recorded UNVERIFIED |
| aamarPay docs | `llms.txt` plus 12 markdown pages read | `AAMARPAY-VERIFICATION.md` §1–§3, §6 |
| aamarPay sandbox | 4 read-only requests: non-existent Search Transaction id, Search via POST (form and JSON), wrong key/store, `jsonpost.php` with an invalid signature key. **No payment session created** | Search is GET-only; JSON served as `text/html`; plain-text credential mismatch; initiate error format `{"result":false,…}` (§4) |
| Stage M dataset `medicine-dataset-20260917-4` | Read `latest.json`, the card, checksums and schemas; recomputed schema hashes; counted veterinary rows (732), `unmapped` forms (552) and price precision (58 OK); measured key lengths | ADR-020, PRESCRIPTION §5, DATABASE §3.8 column sizes |
| npm registry | `ajv` 8.20.0, `ajv-formats` 3.0.1 | TECHNOLOGY-STACK |

## 3. ADRs created

| ADR | Decision | Supersedes / extends |
|---|---|---|
| **ADR-018** Zaman IT SMS/OTP | `SmsProvider` + `OtpDeliveryPort`; POST-only; TLS never disabled; `GATE-SMS-HTTP`; error mapping; duplicate safety; platform and tenant credentials; balance monitoring; content rules | Extends ADR-007; resolves the OTP/SMS provider decision |
| **ADR-019** aamarPay payments MVP | `payments` context; `PLATFORM_MERCHANT` / `DOCTOR_MERCHANT`; server-authoritative flow; Search Transaction verification; state machine; ledger; manual refunds and payouts; `GATE-PAY-PLATFORM-COLLECTION` | **Supersedes audit S3-13 "billing is Future"**; resolves the payment provider decision |
| **ADR-020** Medicine dataset import | Stage M schemas as the pinned import contract; upsert by `canonical_key`; never delete; veterinary exclusion; environment gate + four attestations; search and prescribing rules | Resolves the dataset import mechanism (data stays `UNVERIFIED`) |

## 4. Documents

### 4.1 Created

`docs/architecture/ADR-018-zamanit-sms-otp.md`, `ADR-019-aamarpay-payments-mvp.md`, `ADR-020-medicine-dataset-import.md`; `docs/implementation/ZAMANIT-VERIFICATION.md`, `zamanit-provider-request.md`, `AAMARPAY-VERIFICATION.md`, `PAYMENT-IMPLEMENTATION.md`, `STAGE-3.2-CHANGELOG.md` (this file).

### 4.2 Updated — architecture (index and dated change logs only; original text untouched)

- `ARCHITECTURE-DECISIONS.md`: index rows ADR-018…020; ADR-007 status and note.
- `### 2026-09-17 — Stage 3.2` change-log entries in:
  - SYSTEM-ARCHITECTURE, DATABASE-SPEC, API-SPEC, SECURITY-SPEC, COMMUNICATION-SPEC, PRODUCT-ARCHITECTURE-SPEC;
  - BANGLADESH-LOCALIZATION-SPEC (research register: payment aggregation, SMS sender/route/DND rules and the HTTP OTP question, medicine data licensing and review, refund/consumer rules);
  - DOMAIN-MODEL, MOBILE-SPEC, IMPLEMENTATION-ROADMAP, ARCHITECTURE-REVIEW, TRACEABILITY-MATRIX, README.
- `COMBINED-ARCHITECTURE-SPEC.md` regenerated.

### 4.3 Updated — implementation

| Document | Change |
|---|---|
| ARCHITECTURE-CONSISTENCY-AUDIT | Precedence; rows **C-21…C-34**; S3-13 superseded; external decisions updated |
| COMMUNICATION-IMPLEMENTATION | §6 SMS: credential selection, delivery outcome table, templates, short links, balance, tests |
| AUTH-IMPLEMENTATION | `OtpDeliveryPort` (renamed), Zaman IT delivery outcomes (no auto-resend), TTL 180 s, §2.6 platform operators |
| DATABASE-IMPLEMENTATION | `money` rules + `smoney`; migrations 0015–0018; 0005/0008/0012 amendments; catalog redesign; payment, subscription, provider credential, gate, SMS tables; §4 integrity lists; TTL jobs; tests |
| API-IMPLEMENTATION | Platform context header; callback rules; money strings; medication search/import routes; SMS credential and balance routes; §3.11 payments; §3.12 platform routes; 14 new error codes + `POLICY_BLOCKED` reasons; OTP row fixed (C-27) |
| AUTHORIZATION-MATRIX | `ROLE_PERMISSIONS_VERSION` 2; payment/fee/merchant/refund/SMS permissions; platform catalog; §1.1 platform operator; §5 rows (Billing Future row replaced); §5.1 operator matrix; guardian `MAKE_PAYMENTS`; tests |
| DOMAIN-SERVICE-CONTRACTS | `RequestOtp`, `CreateAppointment` amended; §7 SMS, §8 payments, §9 medication catalog |
| EVENT-ARCHITECTURE | Payment/SMS/catalog events, jobs, handler subscriptions, payload rules |
| PRESCRIPTION-IMPLEMENTATION | Catalog search ranking and indicators; no dose prefill; `catalog_snapshot`; §5 import (inputs, pinned schema hashes, algorithm, execution, tests) |
| PAYMENT-IMPLEMENTATION | **New** (§4.1) |
| SECURITY-IMPLEMENTATION | Controls rows; threats **T18–T32**; security events |
| OBSERVABILITY | Redaction keys and patterns (`api_key=`, `signature_key=`, `store_id=`, payment URLs); SMS/OTP/payment/import metrics; alerts |
| TEST-IMPLEMENTATION | SMS, payments, import suites; live smoke excluded from CI; fixture credential rules; blocking suites |
| SEED-DATA | §2.5 synthetic catalog, fees, merchants, intents in all states, holds, subscriptions, payouts, SMS credentials/snapshots, operator; assertions |
| ENVIRONMENT-CONTRACT | §4 OTP/provider KEK/operator; §6 rewritten (§6.1–§6.4 SMS, aamarPay, medicine import); removals; CI rule |
| LOCAL-DEVELOPMENT | mock-providers Zaman IT and aamarPay routes; runtime modes; opt-in real catalog import; sandbox notes |
| DEPLOYMENT | Rotation rows (Zaman IT key, aamarPay key, provider KEK, short-link pepper); deployment gates; §9 provider operations |
| MOBILE-IMPLEMENTATION | §10 patient payments (external tab, App/Universal Links, server status only); routes; doctor editor catalog indicator; OTP resend UX; tests |
| WEB-IMPLEMENTATION | Routes `/settings/payments`, `/settings/fees`, `/settings/sms`, `/payments`, result page, `/subscription`, `/platform/*`; Playwright flows |
| MODULE-BOUNDARIES | `payments`, `provider-credentials`, `secrets` rows; catalog/SMS ownership; facade C-24 |
| REPOSITORY-STRUCTURE | New packages; contexts list; depcruise rules `payments-no-clinical`, `secrets-restricted`, `provider-adapters-not-in-contexts` |
| TECHNOLOGY-STACK | Zaman IT/aamarPay via `fetch`; Money; `ajv@8.20.0` + `ajv-formats@3.0.1`; shared envelope encryption; `flutter_custom_tabs` |
| AI-IMPLEMENTATION | `SecretEnvelopePort` moved to `packages/secrets` |
| QUEUE-IMPLEMENTATION | Prepaid bookings: no serial until paid or waived; payment never gates transitions |
| CI-CD | Providers job; live smoke/sandbox excluded; no provider secrets in GitHub |
| BUILD-CONTRACT | Stage 3.2 MUST / MUST NOT rules; synthetic-data rule clarified for the reference catalog |
| IMPLEMENTATION-BACKLOG | SMS-001…009, ID-007, PAY-001…015, MEDDATA-001…006, WEB-004, MOB-005; amended ID-003, CLIN-004, RX-001, COM-002, SEC-001, OPS-001, RELEASE-001 |
| IMPLEMENTATION-REVIEW | §2.1 Stage 3.2 readiness gate; §3.1 UNVERIFIED → task; §4 risk and gate register; stack; residual risks |
| README | Precedence, evidence docs, reading order, provider rules, data rule |
| COMBINED-IMPLEMENTATION-BLUEPRINT | Regenerated |

## 5. Backlog additions (placement)

| Where | Tasks |
|---|---|
| Phase 2b (after identity, **before real OTP go-live**) | SMS-001 (secrets, provider credentials, gates), SMS-002 (free Zaman IT probes), SMS-003 (port + mock), SMS-004 (adapter), SMS-005 (OTP delivery), SMS-008 (one gated live SMS), ID-007 (platform operators) |
| Phase 4b (**after scheduling/queue**) | PAY-001…012 (schema/Money, fees, merchants, gateway mock, aamarPay adapter, intents, verification + ledger, holds/confirmation, reconciliation, refunds, payouts, subscriptions), PAY-014 (sandbox verification) |
| Phase 7 (**alongside RX-001**) | MEDDATA-001…005 (catalog schema, importer + CLI, job/admin/gates, search, editor safeguards) |
| Phase 9 | SMS-006 (transactional SMS), SMS-007 (tenant credentials, balance), PAY-013 (payment notifications) |
| Phase 11 | WEB-004, MOB-005 |
| Phase 12 | SMS-009 (`GATE-SMS-HTTP`), PAY-015 (`GATE-PAY-PLATFORM-COLLECTION`), MEDDATA-006 (`GATE-MEDDATA-PROD`) |

(SMS-006/007 keep their numbers although they sit in Phase 9: they depend on the communication tables from COM-001.)

## 6. Self-consistency sweep

Run from `docs/` over `architecture/*.md` and `implementation/*.md` (excluding the generated `COMBINED-*` files, which mirror their sources), case-insensitive.

| Term / check | Remaining occurrences | Disposition |
|---|---|---|
| `billing is Future`, `no MVP billing` | audit C-21 (quotes S3-13); ADR-019 supersedes line | **Intentional** (supersession records). S3-13 row updated; DATABASE-IMPLEMENTATION billing line, MODULE-BOUNDARIES `billing` row, AUTHORIZATION-MATRIX "Billing (Future)" row and ENVIRONMENT `PAYMENT_PROVIDER … Future` all **resolved**. Original architecture text (PRODUCT-ARCHITECTURE-SPEC Future list "payments", TRACEABILITY-MATRIX deferred payment row, DATABASE-SPEC) carries Stage 3.2 change logs. ARCHITECTURE-REVIEW "advanced payments, claims" Future remains valid |
| OTP/SMS provider described as unselected | ARCHITECTURE-REVIEW "Which identity/OTP provider and Bangladesh SMS route…" (original open question), BANGLADESH-LOCALIZATION-SPEC "OTP provider … require provider/legal research" (legal part still true), SYSTEM-ARCHITECTURE "No … SMS … or payment provider is selected by this document" (original) | **Intentional**: each file has a Stage 3.2 change log answering it. AUTH-IMPLEMENTATION ("providers are Future"), ENVIRONMENT (`OTP_PROVIDER` "once selected") and the audit external-decision row are **resolved** |
| `invent medicine`, `invented` | BUILD-CONTRACT MUST NOT; DATABASE-IMPLEMENTATION "No invented rows"; PRESCRIPTION "never invents data"; DATABASE-SPEC, BANGLADESH-LOCALIZATION-SPEC and TRACEABILITY-MATRIX originals | **Intentional** (prohibitions, still valid) |
| `empty import-ready catalog`, "empty catalog valid", "import separate" | audit C-23 (quote); ADR-020 consequence "Production keeps an empty catalog until all four gates are attested" | **Intentional**. Backlog RX-001 and IMPLEMENTATION-REVIEW §4 **resolved** |
| `GET` usage for SMS | ADR-018, BUILD-CONTRACT, SECURITY T27, ZAMANIT-VER-13, audit C-22 — all prohibitions or records of the provider sample; `GET /tenant/sms-credentials/{id}/balance` is our own API | **Intentional**; no document prescribes GET to Zaman IT |
| Floating-point money types | none prescribed. Mentions are prohibitions (DATABASE §1.1/§6, BUILD-CONTRACT, TEST, ADR-019). The Stage M dataset's JSON-number prices are converted with a 2-decimal check (ADR-020 §2) | **Intentional** |
| Real-looking API keys / store IDs | No provider key shapes. The aamarPay published sandbox store ID and key are **not** reproduced (the verification doc refers to the page). 64-hex strings in PRESCRIPTION §5.2 are **SHA-256 checksums of schema files**, not secrets. `103.89.240.228` is the provider's published endpoint, not a credential. Env examples use `<ZAMANIT_API_KEY>`, `<AAMARPAY_SIGNATURE_KEY>`; test shapes are `zit_fake_…`, `sigkey_fake_…` | **Intentional** |

**Additional consistency fixes made during the sweep:**
- API OTP row "job → OTP adapter" corrected (C-27).
- Veterinary rule widened to `manufacturer.value` (the dataset carries "(Veterinary)" in the value, not only in alternatives).
- ADR-020 `report` column name aligned to `counts`.
- A pipe in a markdown table cell replaced (`synthetic:` prefix).
- Redaction key `message` replaced by `smsText`/`messageBody`, so error messages are not dropped.

## 7. Items deliberately left UNVERIFIED

See `IMPLEMENTATION-REVIEW.md` §3.1 (Zaman IT ZAMANIT-VER-01…17, aamarPay PAY-AAM-01…16, platform collection legality, medicine dataset gates, SFTP staging path, catalog search performance). Each has a default and a Stage 4 task. None blocks the start of Stage 4.
