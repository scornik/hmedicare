# Product Architecture Specification

## 1. Product intent

Build a new Bangladesh-first platform for doctors who operate physical chambers and also serve remote patients. The core loop is:

`Serial -> Consultation -> AI-assisted documentation/prescription -> Patient Timeline -> Lab Reports -> Follow-up`

The system MUST represent physical and remote care in one model. A remote patient is not a different patient type and a remote consultation is not a separate record system.

## 2. Scope boundaries

### In scope

- Tenant, clinic, chamber, doctor, staff, patient, and access management.
- Patient identity with normalized Bangladesh phone numbers and alternate contacts.
- Advance appointments, walk-ins, physical serials, and remote serials.
- Shared doctor queue with check-in, call, skip, recall, delay, and no-show handling.
- Physical and remote consultations represented as encounters.
- Structured symptoms, diagnoses, doctor notes, prescriptions, lab reports, documents, timeline events, and follow-ups.
- Provider-neutral notifications and communication adapters.
- AI drafts for documentation, transcription, retrieval, and suggestions, always requiring doctor approval.
- Android-first doctor/patient clients with low-bandwidth behavior.

### Out of scope for MVP

- Autonomous diagnosis or prescribing.
- Automatic medication catalog population.
- PSTN phone infrastructure owned by the platform.
- Call recording by default.
- Full insurance/claims/ERP/billing suite.
- Cross-tenant patient sharing.
- Complex microservice decomposition.
- Regulatory certification claims.

## 3. Bounded contexts

| Context | Owns | Does not own |
|---|---|---|
| Identity & Access | Users, credentials, sessions, roles, permissions, OTP | Clinical patient facts |
| Tenant & Organization | Tenants, clinics, chambers, memberships, settings | Queue state and clinical records |
| Doctor & Staff | Doctor profiles, staff assignments, credentials metadata, schedules | Authentication credentials |
| Patient | Patient identity, contacts, merge candidates, consent references | Appointment-specific symptoms |
| Scheduling | Recurring schedules, chamber days, appointment slots | Live queue position |
| Serial & Queue | Serial issuance, check-in, queue position, queue events, delay/reorder | Clinical note content |
| Appointment | Booking intent, channel, cancellation/reschedule, patient/doctor/chamber link | Encounter note and prescription |
| Encounter & Clinical Records | Consultation lifecycle, participants, symptoms, diagnoses, notes, medications | Delivery provider mechanics |
| Prescription | Draft/final prescription, items, approval, rendering request | AI inference execution |
| Laboratory & Documents | Lab reports/results, uploaded documents, file metadata, versions | Patient identity ownership |
| Timeline | Immutable clinical and operational event projections | Source-of-truth mutation of clinical records |
| Follow-up | Follow-up plans, due dates, linked appointments/serials | General notification transport |
| Communication | Messages, templates, delivery attempts, consent, provider IDs | Clinical meaning of the message |
| Telemedicine | Session authorization, media session, participants, reconnection metadata | Appointment booking |
| AI Assistance | Jobs, transcripts, drafts, suggestions, provenance, approvals | Final clinical truth without approval |
| Audit & Compliance | Immutable audit events, exports, access events, retention tasks | Business workflow state |
| Billing & Subscription | Tenant plan, usage, payment intents, invoices | Clinical payment decisions |
| Localization | Locale, translation keys, search aliases, formatting policies | Clinical catalog truth |

## 4. Core workflow

1. Identify or create a patient. Duplicate detection MUST run before creating a new patient.
2. Create an appointment or walk-in request against a doctor, chamber, and chamber day.
3. Issue a `Serial` from the chamber-day sequence. The serial is the queue unit, not the appointment.
4. Check in the patient. Physical and remote patients enter the same queue with a `care_mode`.
5. Doctor or authorized staff calls the next eligible serial. A queue event records the action.
6. Start an encounter linked to exactly one serial. The encounter records physical or remote mode.
7. Capture structured symptoms, diagnoses, notes, documents, and prescription drafts. AI may assist but cannot finalize.
8. Doctor approves final clinical artifacts. Finalization creates immutable versions and timeline events.
9. Generate patient-accessible documents asynchronously and deliver through consented channels.
10. Create a follow-up plan. A follow-up may create a future appointment and serial while remaining linked to the original encounter.

## 5. MVP boundary

### MVP

- One tenant, multiple chambers, doctors, staff roles.
- Patient create/search/deduplication review.
- Advance booking and walk-in serials.
- Shared queue state machine with delay, skip, recall, no-show, and reorder audit.
- Physical encounter and remote encounter with an external video adapter.
- Structured clinical note, diagnosis reference, prescription draft/finalization, and PDF.
- Patient timeline projection.
- Follow-up plan and appointment creation.
- Email/in-app notifications plus provider-neutral SMS/WhatsApp adapter boundary.
- AI limited to doctor-triggered note draft and historical retrieval; approval required.
- Android-first patient and doctor flows.

### V1

- Resumable lab/document upload, lab report review, Bangla/Banglish search aliases, delivery receipts, SMS fallback, enhanced queue notifications, and audio-only fallback.

### V2

- Asynchronous speech-to-text and structured extraction, medication safety suggestions, bilingual prescription rendering, richer analytics, and multiple video providers.

### Future / research

- Real-time mixed-language transcription, provider-owned PSTN, call recording, automated lab extraction, advanced clinical decision support, payments, and integrations requiring legal/provider validation.

## 6. Non-functional targets

- Every sensitive read/write is tenant-scoped and authorization-checked in the service/data layer.
- Queue transitions are transactional and idempotent.
- Final clinical records are versioned and auditable.
- Large files are stored outside PostgreSQL.
- Normal logs contain no raw PHI, transcript, prescription text, or document URLs.
- Patient and doctor clients remain useful under intermittent connectivity.
- Asia/Dhaka is the default deployment timezone, while timestamps remain timezone-aware.

## Change log

### 2026-09-17 — Stage 3.1

- The statement that large files are stored outside the relational database stands; the engine is MariaDB (ADR-014) and files use the storage port (ADR-016).
- AI assistance uses the doctor's own provider credentials (ADR-017); product scope and the approval boundary are unchanged.

### 2026-09-17 — Stage 3.2

- Scope change: patient payments for consultation, appointment and telemedicine fees, and doctor/clinic subscription payments to Hakeemify, enter MVP (ADR-019). Insurance, claims and full invoicing/ERP remain out of scope. The "Billing & Subscription" context is implemented as the `payments` context.
- Payment never blocks the manual clinical workflow; prepaid chamber and telemedicine bookings hold capacity without issuing a serial until payment is verified or staff waive it.
- The medicine catalog is imported from the Stage M dataset for dev/staging with an "Unverified catalog" indicator and free-text fallback; production import is gated (ADR-020).
