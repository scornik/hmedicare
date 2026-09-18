# Bangladesh Gap Analysis

The references do not demonstrate a Bangladesh-first workflow. The gaps below are product/design requirements to research, not invented regulatory conclusions.

| Target need | Evidence in references | Gap |
|---|---|---|
| Rural doctor chamber and serial queue | HCW has consultation waiting state; TPT has waitlist/check-in | No verified serial number, counter, walk-in registration, chamber day, token display, no-show, or offline queue model |
| Remote Dhaka patient | Telemedicine concepts exist in HCW/TPT | No Bangladesh geography, patient routing, local provider directory, or rural/urban workflow |
| Bangladesh phone numbers | Generic phone fields and Twilio dependency | No Bangladesh normalization/OTP/provider policy; phone consultation is not proven |
| WhatsApp | HCW enum/template and Twilio dependency | No verified WhatsApp Business message/call workflow, consent, template approval, delivery status, or fallback |
| Bangla/Banglish | Generic `Language` in HCW; no Bangla-specific source found | No Bangla UI, Banglish clinical input, transliteration, search ranking, or bilingual PDF |
| Bangladesh medicines | TPT `Drug` and interaction concepts | No Bangladesh brand/generic catalog, local strengths/forms, availability, or medicine autocomplete |
| Local lab reports | TPT `LabOrder`/documents; no exact LabReport/LabResult found | No local lab upload normalization, result extraction, reference ranges, or longitudinal result display |
| Prescription format | TPT prescription/e-prescribing entities | No Bangladesh format, bilingual instructions, doctor registration fields, pharmacy delivery, or patient-readable WhatsApp PDF |
| Low bandwidth/intermittent connectivity | No verified offline sync or adaptive media implementation | Requires explicit Android-first/PWA strategy, retry/outbox, compressed attachments, audio-first fallback, and call recovery |
| Android-first patients | Medigo and DocPilot both have Flutter Android/iOS scaffolding; Medigo has patient/doctor separation and Agora mobile calls | No tested low-end Android UX, installable PWA, offline cache, or release evidence; Medigo dependencies are obsolete and no offline sync is implemented |
| SMS fallback | HCW models SMS and reminders; TPT reminder channel supports SMS | No verified provider failover, message idempotency, delivery receipts, or Bangladesh sender setup |
| Payments | HCW Stripe; TPT Stripe/Airwallex schema | No Bangladesh payment provider or cash/chamber payment flow; separate business/legal research required |
| Timezone/localization | TPT has report schedule timezone JSON comment; generic dates elsewhere | No Bangladesh timezone default, Bangla numerals/date formats, local holidays, or chamber operating calendar |
| Follow-up | TPT follow-up encounter type; HCW reminders | No dedicated follow-up plan, due date, adherence tracking, or serial-linked follow-up workflow |

## Separate research flags
Phone/WhatsApp practices, medical licensing/prescription rules, data residency/retention, telemedicine consent, payment regulation, SMS sender requirements, and AI clinical governance require separate Bangladesh legal/regulatory and clinical review. This document makes no regulatory determination.
