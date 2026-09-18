# Bangladesh Localization Specification

## 1. Locale and time

- Default locale: `bn-BD` for patient-facing interfaces where selected; `en-BD` remains available for doctors/staff.
- Default deployment timezone: `Asia/Dhaka`.
- Store timestamps as timezone-aware instants; store chamber-day local date and timezone explicitly.
- Format dates, times, digits, currency, and weekdays through locale services, not string concatenation.
- Keep translation keys versioned and allow tenant-level default locale.

## 2. Phone identity

- Normalize Bangladesh numbers to E.164 where possible; preserve entered display value separately.
- Support local `01...` input and international `+880...` presentation without assuming every number is mobile.
- Store verified and unverified contact states, purpose, last verification time, and channel preference.
- Permit alternate phone, caregiver phone, and emergency contact without making them the patient identity.
- OTP provider, sender identity, delivery, abuse controls, and applicable legal requirements require provider/legal research.

## 3. Language and search

- UI supports Bangla and English; Banglish is accepted as a search/input aid, not a canonical clinical language.
- Store canonical medicine/diagnosis terms separately from localized labels and aliases.
- Search fields may include Bangla name, English name, Banglish terms, brand name, generic name, and approved aliases.
- Transliteration must be versioned and explainable; never silently change the doctor’s authored clinical text.
- PDFs may render bilingual labels and doctor-authored text according to tenant/patient preference. Font embedding and print QA are required.

## 4. Medicine catalog

The schema supports generic name, brand name, strength, dosage form, manufacturer, Bangladesh brand flag, Bangla name, Banglish aliases, and dataset version. No medication data is invented in this stage. Import requires a verified dataset, provenance, update process, deprecation policy, and clinical/pharmacy review.

A doctor may use a free-text fallback when the catalog has no match; the fallback is visibly marked and not silently mapped to a catalog item.

## 5. Chamber operations

The chamber-day model supports:

- advance booking and walk-in;
- physical, remote, and hybrid care mode;
- recurring weekly schedule and dated exceptions;
- delay notices and queue recalculation;
- no-show, skip, recall, reschedule, and cancellation;
- multiple chambers per clinic/doctor;
- remote patients entering the same queue as physical patients.

No patient-facing view exposes another patient’s identity or medical reason.

## 6. Connectivity

- API mutations are idempotent and retryable where safe.
- Uploads use resumable multipart sessions and checksums.
- Attachments are compressed client-side within a configured quality limit.
- Audio-only consultation is available when video is not viable.
- Patient can see last synchronized queue state and its timestamp when offline; stale state is clearly labeled.
- The server remains authoritative for queue position, encounter lifecycle, and prescription finalization.

## 7. Communication and payment

- SMS and WhatsApp are adapters with consent, templates, receipts, retries, and fallback.
- Email and in-app notifications remain independent fallback channels.
- Payment uses a provider-neutral interface; Bangladesh provider selection, cash/chamber settlement, refunds, and applicable regulation are open research items.

## 8. Bangladesh research register

Before production, separately research phone/OTP practices, WhatsApp Business requirements, prescription/doctor credential requirements, telemedicine consent, medical record retention/export, payment rules, data residency, SMS sender requirements, and AI clinical governance. This document does not assert compliance or invent requirements.

## Change log

### 2026-09-17 — Stage 3.1

- Research register additions (open, no compliance claim): (a) Hostinger data-center region (India selected by default) and cross-border hosting of patient data; (b) object storage and backup destination region; (c) AI provider data location, retention and terms for clinical use; (d) the **AI patient data gate**: whether minimized patient data may be sent to foreign AI providers, on which tiers, and under what consent (AIREG-001…009 in `docs/implementation/AI-PROVIDER-REGISTER.md`). References: ADR-013, ADR-016, ADR-017.
- Bangla text uses `utf8mb4` with `utf8mb4_unicode_520_ci` collation; Asia/Dhaka local dates are stored alongside UTC timestamps (ADR-014).

### 2026-09-17 — Stage 3.2

- Research register additions (open; no compliance claim): (a) **payment aggregation/facilitation** — whether Hakeemify may collect patient fees on behalf of doctors, with tax, accounting and payout obligations (`GATE-PAY-PLATFORM-COLLECTION`); (b) SMS sender ID masking rules, transactional vs promotional routes, DND and sending-hour restrictions, and whether OTP over a plain-HTTP provider API is acceptable (`GATE-SMS-HTTP`); (c) medicine data licensing and use for DGDA, the Mendeley dataset and pharmacy sources, clinician/pharmacist sample review, DGDA cross-reference (`GATE-MEDDATA-PROD`); (d) refund and consumer-protection rules for online medical-service payments. References: ADR-018, ADR-019, ADR-020.
- Payer contact data: aamarPay requires a customer email; many patients have none. HMedic never fabricates per-patient emails and uses the payer email, the clinic contact email or a platform no-reply address (ADR-019 §5).
- Medicine search supports brand, generic, Bangla and Banglish aliases, with machine-generated aliases ranked lowest; veterinary products are excluded; observed prices are labelled "observed price, may differ" and never shown as MRP (ADR-020).
