# Bangladesh Telemedicine Reference Repository Teardown

**Inspection date:** 2026-09-17  
**Scope:** Medigo, OpenEMR, HCW@Home, TPT Doctor, and DocPilot  
**Purpose:** Standalone handoff for a future AI session. This is architectural analysis only. No product implementation was started and no source code was copied.

## Contents

1. [Executive Findings](#executive-findings)
2. [Repository Inventory](#repository-inventory)
3. [Architecture Comparison](#architecture-comparison)
4. [Data Model Comparison](#data-model-comparison)
5. [Telemedicine Comparison](#telemedicine-comparison)
6. [Prescription Comparison](#prescription-comparison)
7. [AI Comparison](#ai-comparison)
8. [Security Comparison](#security-comparison)
9. [License Matrix](#license-matrix)
10. [Reusability Matrix](#reusability-matrix)
11. [Bangladesh Gap Analysis](#bangladesh-gap-analysis)
12. [Final Recommendations](#final-recommendations)
13. [Inspection Limits](#inspection-limits)

## Executive Findings

There is no single repository that supplies the intended Bangladesh-first workflow:

`Serial -> Consultation -> AI-assisted documentation/prescription -> Patient Timeline -> Lab Reports -> Follow-up`

The evidence supports a hybrid architectural study followed by a new implementation:

- **OpenEMR:** strongest mature EHR and practice-management reference. It has a large relational clinical model, FHIR/REST/OAuth surfaces, prescription/drug/document workflows, audit infrastructure, and ComLink telehealth. It is GPL-3.0-or-later and architecturally broad/legacy.
- **TPT Doctor:** strongest modern tenant-scoped EHR model. It separates `Tenant`, `User`, `StaffMember`, `Patient`, `Appointment`, `Encounter`, clinical artifacts, documents, notifications, and audit records.
- **HCW@Home:** strongest directly evidenced consultation/media orchestration. It has consultation states, participants, invitations, messages, reminders, and explicit mediasoup entities.
- **Medigo:** strongest complete patient/doctor mobile split among the recovered mobile references, with Firebase-backed booking/chat and Agora audio/video. Its clinical artifacts are shallow free-text documents, dependencies are old, and client-side Firestore writes create major security concerns.
- **DocPilot:** useful Flutter shared-package/mobile-shell reference, but no backend, clinical data model, auth flow, AI, or telemedicine implementation was verified.
- **AI/voice:** no repository contains a verified speech-to-structured-clinical-documentation or LLM-assisted prescribing workflow.
- **Bangladesh-specific workflow:** no repository provides serial/chamber queue, Bangla/Banglish clinical input, Bangladesh medicine catalog, local lab normalization, or WhatsApp/SMS fallback as a complete verified workflow.

## Repository Inventory

| Repository | URL | License | Stack | Data/backend | Communication | Build/testing/maintenance |
|---|---|---|---|---|---|---|
| Medigo | https://github.com/amlannandy/Medigo.git | No `LICENSE` found in parent or fetched submodules | Flutter 1-era Dart patient/doctor apps; React 17/TypeScript/Redux admin | Firebase Auth, Firestore, Storage, Messaging; no custom server or relational DB | Agora RTC; Firestore nested appointment messages | Flutter default widget tests; CRA/Jest admin scripts; no CI/Docker. Parent `96e1b10` from 2021; submodules: Admin `0078e66`, Doctor `968d40a`, User `85cb7f5`. |
| OpenEMR | https://github.com/openemr/openemr.git | `LICENSE`: GPL v3; `composer.json`: `GPL-3.0-or-later` | PHP 8.3+, Composer, JavaScript/Node, Laminas/Symfony/Doctrine | MySQL/MariaDB relational schema; REST, FHIR, SMART-on-FHIR/OAuth | ComLink telehealth, direct messaging, PHPMailer, fax/SMS modules | Composer/npm, PHPUnit, Jest, PHPStan, Rector, BATS, acceptance/integration tests, extensive GitHub Actions and Docker. Current `master` object `72b2e454`. |
| HCW@Home | https://github.com/hcw-home/hcw-home.git | No repository-level license found | NestJS/TypeScript backend; Angular admin/patient/practitioner clients | PostgreSQL/Prisma | Socket.IO, mediasoup, Twilio dependency, Cloudinary dependency, SMS/EMAIL/WHATSAPP values | Yarn locks, Docker Compose, per-app READMEs/Makefiles; latest visible commit `72572b8f` from 2025. |
| TPT Doctor | https://github.com/tpt-solutions/tpt-doctor.git | MIT, exact `LICENSE`, copyright 2024 | NestJS/TypeScript API; pnpm monorepo with web and patient portal | PostgreSQL/Prisma, UUIDs, `uuid-ossp`, `pgcrypto`; tenant-scoped schema | Socket.IO dependency; telemedicine model; notification package | pnpm workspace, CI/AWS/security workflows, Docker, Ansible, Prometheus; latest visible commit `2b1478a` from 2026. |
| DocPilot | https://github.com/xkaper001/DocPilot.git | MIT `LICENSE`; duplicate `MIT License` file | Dart/Flutter doctor and patient apps plus `docpilot_core` | No backend/database found | No verified auth/API/realtime/storage | Flutter tests/lints/build_runner/flutter_gen; no service deployment architecture; latest visible commit `61b5413` from 2026. |

Major declared dependencies include HCW `mediasoup ^3.16.0`, Socket.IO `^4.8.1`, Twilio `^5.7.1`, Stripe `^18.4.0`, Cloudinary, and Prisma `^6.6.0`; TPT Prisma/PostgreSQL and Socket.IO; DocPilot `go_router ^16.2.5`, `flutter_svg ^2.2.1`, and Flutter tooling; Medigo Agora `^1.0.12`, Firebase packages from the 2020-era Flutter ecosystem, React 17, Redux, and Firebase 8.8.0 in the admin.

## Architecture Comparison

### Medigo

The recovered clone is in `reference-repos/medigo-analysis/`; the original `reference-repos/Medigo` checkout was not modified. It contains:

- Flutter `MedigoUser` patient app.
- Flutter `MedigoDoctor` doctor app.
- React/Redux/TypeScript `MedigoAdmin` app.
- Firebase as the backend. `UserDatabaseService.dart` reads `users`, `doctors`, `clinics`, `appointments`, `prescriptions`, and `medicalreports`. `AppointmentProvider.dart` writes appointment fields and nested `messages`.
- Firebase email/password authentication, verification, reset, Google sign-in, and Facebook sign-in.
- Client-side Firestore mappers: `Doctor`, `MedigoUser`, `Clinic`, `Appointment`, `MedicalReport`, and `Prescription`.
- Appointment records contain doctor/user IDs, date/time, Agora channel ID, audio/video flags, last message, timestamps, and read markers.
- Booking links report, medical-report, and prescription documents to an appointment ID.
- Agora audio/video calls use Firestore channel and active-call flags. There is no server call-state machine, waiting room, recording model, or durable call-event model.
- `MedicalReport.data` and `Prescription.data` are free-text strings. There are no structured diagnosis, symptom, medication, prescription-item, lab-result, follow-up, or audit entities.
- Admin fetches and mutates Firestore directly. No custom API boundary or authorization middleware was found.

### OpenEMR

OpenEMR is source-inspectable from local git objects despite a sparse working tree. Its layers include PHP interface/library code, Composer services, REST/FHIR controllers, SQL schema/migrations, custom modules, portal/templates, and JavaScript assets. Key paths are `composer.json`, `src/`, `apis/`, `interface/`, `sql/`, `FHIR_README.md`, and `Documentation/api/`.

Its relational model includes `patient_data`, `users`, `facility`, `openemr_postcalendar_events`, `forms`, `drugs`, `drug_templates`, `prescriptions`, `documents`, `clinical_notes`, `clinical_plans`, `lists`, `transactions`, `audit_master`, and `audit_details`. It separates patient demographics, users/providers, facilities, scheduling, forms, clinical notes, conditions/problems, medications, prescriptions, documents, billing, reporting, and audit.

REST routes, FHIR R4, SMART-on-FHIR documentation, OAuth/API token tables/tests, GACL authorization, ComLink telehealth, direct messaging, and fax/SMS modules are present. The system is mature but broad, legacy-oriented, operationally complex, and GPL-licensed.

### HCW@Home

HCW separates Angular admin, patient, and practitioner clients from a NestJS backend and Prisma schema. It is consultation-first. `Consultation` owns participants, messages, payment, reminders, feedback, mediasoup routers/transports, invitations, and media events. Its statuses include `DRAFT`, `SCHEDULED`, `WAITING`, `ACTIVE`, `COMPLETED`, `CANCELLED`, and `TERMINATED_OPEN`.

Patients and practitioners share `User` rows differentiated by `UserRole`; `Organization`, `Group`, `Speciality`, `PractitionerAvailability`, and `TimeSlot` surround the consultation model. There is no structured patient/EHR/prescription/medication/diagnosis/lab model in the inspected schema. `Consultation.symptoms` is free text. `DeletedConsultationLog` and media events exist, but no general immutable audit model was found.

### TPT Doctor

TPT is a pnpm monorepo with `apps/api`, `apps/web`, `apps/patient-portal`, and packages for `auth`, `database`, `encryption`, `compliance`, `audit-log`, `notifications`, `shared`, and `config`.

`Tenant` owns staff, patients, appointments, encounters, prescriptions, labs, documents, messages, notifications, payments, and audit logs. `User` is Auth0-linked by `auth0Id`; `StaffMember` carries roles and permissions. `Patient` has MRN, demographics, contact data, conditions, allergies, immunizations, medications, documents, appointments, encounters, prescriptions, lab orders, and telemedicine sessions.

`Appointment` and `Encounter` are distinct. `EncounterType` includes `TELEMEDICINE`, `FOLLOW_UP`, and `CONSULTATION`. `DiagnosisCode`, `MedicalCondition`, `Allergy`, `PatientMedication`, `Prescription`, `LabOrder`, `Document`, `TelemedicineSession`, `PatientConsent`, `AuditLogEntry`, `DecisionSupportRule`, and `DrugInteraction` are explicit. No dedicated serial model or verified voice/AI workflow was found.

### DocPilot

DocPilot contains shared Flutter `docpilot_core`, `docpilot_doctor`, and `docpilot_patient` applications. It provides Flutter routing, assets, fonts, themes, and mobile scaffolding. No backend, database, clinical persistence, auth, API client, realtime, storage, AI, or telemedicine implementation was verified.

## Data Model Comparison

| Concept | Medigo | OpenEMR | HCW@Home | TPT Doctor | DocPilot |
|---|---|---|---|---|---|
| Patient | `MedigoUser`, `users/{uid}` | `patient_data` | `User` with patient role | `Patient` | None found |
| Doctor | `Doctor`, `doctors/{id}` | `users` and provider/facility relationships | `User` with practitioner role | `StaffMember` | None found |
| Clinic | `Clinic`, `clinics/{id}` | `facility` | `Organization`, `Group` | `Tenant`, `ClinicRoom` | None found |
| Appointment | `Appointment`, `appointments/{id}` | `openemr_postcalendar_events` | `TimeSlot`; no appointment model | `Appointment` | None found |
| Serial/Queue | None; appointment booking only | Calendar/event scheduling, no Bangladesh chamber serial | None; `waitingParticipants` is only a counter | `WaitlistEntry`, `CheckInRecord`; no serial number | None found |
| Consultation | No dedicated entity; appointment/chat surface | Encounter/form/clinical-note tables plus ComLink session tables | `Consultation` | `Encounter`, `TelemedicineSession` | None found |
| Diagnosis | None | Problems/conditions/lists and FHIR Condition mappings | None; symptoms free text | `DiagnosisCode`, `MedicalCondition` | None found |
| Symptom | None | Forms/notes/list data; no single symptom entity confirmed | `Consultation.symptoms` | No dedicated model | None found |
| Medication | None | `drugs`, `drug_templates`, medication/list structures | None | `Drug`, `PatientMedication` | None found |
| Prescription | `Prescription`, appointment-linked, free-text `data` | `prescriptions` and drug/prescription paths | None | `Prescription`, `PbsPrescription`, `UkEpsPrescription` | None found |
| PrescriptionItem | None | No exact table asserted | None | No exact model | None found |
| LabReport | `MedicalReport`, `medicalreports/{appointmentId}`, free-text data; `reports` query flow | Documents/clinical procedure results/lab-related tables | None | No exact `LabReport`; `LabOrder`, `LabPanel`, `ExternalLabConfig`, `Document` | None found |
| LabResult | None; no result schema | Clinical procedure/document structures; no exact table asserted | None | No exact model | None found |
| Document | Firebase Storage declared; no durable document entity | `documents`, clinical note/document tables/categories | None found | `Document`, folders/tags/versions, `MyHealthRecordDocument` | None found |
| Communication | Appointment nested messages, last-message/read timestamps | Direct messaging, `direct_message_log`, fax/SMS, ComLink notifications | `Message`, read receipts, invitations, media events | `Message`, `TelemedicineChatMessage`, `Notification` | None found |
| FollowUp | None | Reminder/calendar mechanisms; no exact entity | No dedicated model | Follow-up encounter type and reminders | None found |
| Notification | Firebase Messaging/local notifications; no entity | `automatic_notification` and telehealth notification services | `UserNotificationSetting`, `ConsultationReminder` | `Notification`, reminders, templates | None found |
| AuditLog | None | `audit_master`, `audit_details`, audit logger/event sinks | Deleted consultation log only | `AuditLogEntry`, `PatientMergeLog` | None found |

No complete inspected model contains Bangladesh serials, Bangla/Banglish fields, a Bangladesh medicine catalog, or a complete lab-result structure.

## Telemedicine Comparison

| Capability | Medigo | OpenEMR | HCW@Home | TPT Doctor | DocPilot |
|---|---|---|---|---|---|
| Video | Agora RTC Engine `^1.0.12`; Flutter joins channels | ComLink telehealth controllers/session repository/telehealth SQL | Mediasoup entities and dependency | `TelemedicineSession`; media plane less specific | None |
| Jitsi/Agora | Agora implemented; no Jitsi | Provider abstraction; exact provider requires runtime review | No Jitsi/Agora; mediasoup | No Jitsi/Agora found | None |
| Audio/phone | Agora audio-only; no PSTN | No verified PSTN provider | Twilio declared; phone flow unproven | No verified telephony provider | None |
| Chat/attachments | Firestore nested messages; Storage declared; attachment flow unverified | Direct messaging and documents; telehealth attachment flow requires review | Messages/read receipts/media events; attachment persistence unproven | Messages/chat model; attachment details unproven | None |
| Waiting/call states | Firestore audio/video flags and Agora join/leave; no waiting model | ComLink registration/session workflow | Explicit waiting/active states, admission, participants, media permissions | Appointment/encounter/session statuses; waiting behavior unproven | None |
| Invitations | Booking and doctor/patient IDs; no token invitation | ComLink invitation mailer and registration code | Token invitation with expiry/status | No exact invitation model | None |
| WhatsApp | None found | None verified | `WHATSAPP` enum/template and Twilio dependency; sending unproven | None verified | None |
| SMS/email | Firebase email auth; no SMS flow | PHPMailer, fax/SMS, direct messaging, invitation mailer | SMS/EMAIL/WHATSAPP values and Twilio | Email/SMS reminder channel | None |

HCW has the strongest direct consultation/media architecture. OpenEMR is a meaningful workflow/integration reference through ComLink. Medigo proves a basic provider-integrated mobile call but lacks a robust call state machine. No repository proves low-bandwidth adaptation, WhatsApp delivery, SMS fallback, or a chamber serial queue.

## Prescription Comparison

- **Medigo:** prescription is a Firestore document with free-text `data`. No structured medication, dosage, frequency, duration, diagnosis, PDF, print, WhatsApp, email, or autocomplete workflow was found.
- **OpenEMR:** `prescriptions`, `drugs`, `drug_templates`, clinical forms, prescription API tests, document/print infrastructure, and `dompdf/dompdf`. Strong mature reference, but GPL and legacy complexity matter.
- **HCW@Home:** no prescription or medication model found.
- **TPT Doctor:** strongest model coverage: `Prescription`, `Drug`, `PatientMedication`, `DrugInteraction`, `ControlledSubstanceLog`, `EPrescribingTransaction`, `PbsPrescription`, and `UkEpsPrescription`. Complete editor/PDF/delivery was not proven.
- **DocPilot:** no clinical prescription backend.

The new product must explicitly model dosage, frequency, duration, route, instructions, substitution, author, approval state, and immutable rendered version. No reference supplies a verified Bangladesh medicine catalog or prescription format.

## AI Comparison

| Capability | Medigo | OpenEMR | HCW@Home | TPT Doctor | DocPilot |
|---|---|---|---|---|---|
| Speech/transcription | None found | Not verified | None found | None found | None found |
| LLM | None found | Not verified | None found | No provider/prompt pipeline | None found |
| Clinical extraction | None; free-text artifacts only | Not verified | None found | Decision-support rules/interactions, no LLM workflow | None found |
| History suggestions | Firestore history retrieval only; no AI suggestions | Not verified | None | Patient relationships/search substrate only | None |
| Structured approval | None | Not verified | None | Audit/consent foundations, no AI approval workflow | None |

Status classification:

- **IMPLEMENTED:** No repository has verified speech-to-structured clinical documentation or LLM-assisted diagnosis/prescribing.
- **PARTIAL:** TPT has non-LLM decision-support entities, history relations, audit, consent, and tenant boundaries.
- **DEMO:** No AI demo can be confirmed from checked-out source.
- **DOCUMENTED BUT NOT IMPLEMENTED:** Any AI claim without provider call, prompt/schema, persistence, and clinician approval remains unverified.

AI must produce a draft with source context and uncertainty, then require explicit doctor accept/edit/reject. It must never silently write diagnoses or prescriptions.

## Security Comparison

- **Medigo:** Firebase Auth with email/password, verification/reset, Google/Facebook sign-in. Clients directly query Firestore; no server-side authorization middleware or tenant model found. Firebase config files and Android `key.properties` exist; Agora App ID is hard-coded in `VideoCallScreen.dart`; no application-level PHI encryption or audit model found. Firebase Rules, Storage Rules, project ownership, exposed config, and least-privilege access require review.
- **OpenEMR:** Local/session auth, OAuth2/API tokens, SMART-on-FHIR, GACL/RBAC, API authorization docs/tests, `audit_master`, `audit_details`, query auditing, ATNA/log sinks, and audit reports. Mature but complex; this is not a certification.
- **HCW@Home:** Passport local/custom/OpenID Connect dependencies; `User.password` is present in schema and needs hashing review. Organization/group scope but no explicit tenant field. Stripe secret fields appear in schema. General audit model absent.
- **TPT Doctor:** Auth0-linked identity, roles/permissions, tenant foreign keys, encryption/compliance/audit packages, PostgreSQL `pgcrypto`. RLS comments and compliance labels require operational verification.
- **DocPilot:** No backend/auth/security model found.

Security review risks:

1. Verify password hashing, reset handling, token expiry, and PHI-safe logs in HCW.
2. Externalize and protect HCW Stripe secrets.
3. Verify TPT RLS/query scoping and actual runtime authorization rather than trusting schema comments.
4. Review PHI in request logs, errors, media events, messages, exports, and generated documents.
5. None proves Bangladesh phone identity, WhatsApp consent, retention, backup restore, or AI approval controls.

## License Matrix

| Repository | License fact | Commercial/reuse implication |
|---|---|---|
| Medigo | No `LICENSE` in parent or fetched submodules | Rights unknown; reference-only pending legal/provenance review |
| OpenEMR | GPL v3; `GPL-3.0-or-later` | Commercial use is permitted subject to GPL. Strong copyleft and distribution/linking/service-model questions require legal review. |
| HCW@Home | No repository-level license found | Do not copy code until rights and contributor provenance are verified. |
| TPT Doctor | MIT | Commercial use/modification/distribution allowed subject to notice/disclaimer; audit dependencies. |
| DocPilot | MIT plus duplicate notice file | Permissive repository license; preserve notices and audit dependencies/assets/fonts. |

Major dependency families requiring a complete SBOM/license report include OpenEMR Composer/npm packages, HCW Nest/Prisma/mediasoup/Twilio/Stripe/Cloudinary/Angular, TPT Nest/Prisma/Auth0/AWS packages, and DocPilot Flutter packages/assets/fonts. Repository licenses do not settle transitive dependency obligations. This is not legal advice.

## Reusability Matrix

| Feature | Medigo | OpenEMR | HCW@Home | TPT Doctor | DocPilot | Guidance |
|---|---:|---:|---:|---:|---:|---|
| Patient/EHR model | C | B | C | B | C | Medigo collection split is mobile reference only; study OpenEMR/TPT and redesign locally. |
| Consultation state machine | C | C | B | B | C | Study HCW statuses/admission/invitations and TPT encounter boundaries. |
| Video/media | C | C | B | C/B | C | Medigo Agora is provider-integration reference; HCW is stronger for server orchestration. |
| Serial/chamber queue | C | C | C | C | C | Build from scratch. |
| Appointment/waitlist | C | C | B | B | C | Study Medigo booking/chat plus TPT waitlist/check-in and HCW time slots. |
| Prescription | C | B | C | B | C | Study OpenEMR/TPT; Medigo is free-text UI only. |
| Medicine autocomplete | C | C | C | B | C | Use TPT pattern; source Bangladesh catalog separately. |
| Documents/labs | C | C | C | B | C | Study TPT document/version/checksum pattern; add explicit lab models. |
| Auth/RBAC/tenancy | C | B | B | B | C | Study OpenEMR GACL/OAuth/audit and TPT tenant/encryption patterns. |
| Mobile | B | C | C | C | B | Study Medigo patient/doctor split and Agora surface plus DocPilot shared package; do not inherit Medigo dependencies. |
| AI/voice | C | C | C | C | C | Build and safety-review from scratch. |

Avoid:

- Copying code from unknown-license Medigo or HCW.
- Copying OpenEMR code without GPL legal analysis.
- Treating schemas, README claims, provider dependencies, or Medigo client-side Firestore writes as production proof.
- Copying an international data model unchanged into Bangladesh.
- Silent AI writes to diagnosis or prescription records.

## Bangladesh Gap Analysis

| Target need | Existing evidence | Gap |
|---|---|---|
| Rural chamber/serial queue | HCW waiting; TPT waitlist/check-in; Medigo appointments | No verified serial number, counter, walk-in, chamber day, token display, no-show, or offline queue model |
| Remote Dhaka patient | Telemedicine concepts | No Bangladesh geography, routing, or local provider workflow |
| Bangladesh phones | Generic phone fields/Twilio | No Bangladesh normalization, OTP, provider, or phone-consult workflow |
| WhatsApp | HCW enum/template/Twilio declaration | No verified Business messaging/calling, consent, delivery status, or fallback |
| Bangla/Banglish | Generic language concept in HCW | No Bangla UI, Banglish input, transliteration, bilingual PDF, or search ranking |
| Bangladesh medicines | Generic TPT `Drug` | No local brand/generic catalog, strengths/forms, availability, or autocomplete |
| Local labs | TPT lab/document concepts | No local lab normalization, extraction, reference ranges, or timeline display |
| Prescription format | TPT prescription entities; Medigo free-text prescription | No Bangladesh format, bilingual instructions, doctor registration fields, pharmacy delivery, or patient-readable WhatsApp PDF |
| Low bandwidth/offline | No verified implementation | Need retry/outbox, compressed attachments, audio-first fallback, reconnect, and offline sync |
| Android-first | Medigo and DocPilot Flutter scaffolding | No tested low-end Android UX, PWA, offline cache, or release evidence; Medigo dependencies are obsolete |
| SMS fallback | HCW/TPT model channels | No verified failover, idempotency, receipts, or Bangladesh sender setup |
| Payments | Stripe/Airwallex references | No Bangladesh payment provider or cash/chamber workflow |
| Localization/timezone | Generic time/date and report timezone config | No Bangladesh timezone default, Bangla numerals/date formats, local holidays, or chamber calendar |
| Follow-up | TPT follow-up encounter and HCW reminders | No dedicated follow-up plan, due date, adherence tracking, or serial-linked follow-up |

Phone/WhatsApp practices, medical licensing/prescription rules, data residency/retention, telemedicine consent, payment regulation, SMS sender requirements, and AI clinical governance require separate Bangladesh legal/regulatory and clinical research. No regulatory conclusion is made here.

## Final Recommendations

1. **Strongest patient/EHR architecture:** OpenEMR for mature breadth and integrated practice-management depth; TPT Doctor for a cleaner modern tenant-scoped model.
2. **Strongest telemedicine architecture:** HCW@Home, due to consultation states, participants, invitations, messages, permissions, and mediasoup entities.
3. **Strongest AI/voice workflow:** None verified.
4. **Strongest mobile architecture:** Medigo for complete patient/doctor Firebase mobile workflows and Agora calls; DocPilot for cleaner shared Flutter package structure. Medigo is older and riskier.
5. **Strongest prescription workflow:** TPT by model coverage; OpenEMR is the strongest mature integrated prescription reference.
6. **Study:** OpenEMR relational/EHI/FHIR/REST/audit surfaces; TPT tenant/clinical/audit/encryption packages; HCW consultation/media orchestration; Medigo mobile booking/chat/Agora patterns; DocPilot shared Flutter structure.
7. **Avoid:** Medigo legacy dependencies, direct client-side PHI writes, hard-coded Agora config, and free-text clinical artifacts; GPL code without legal analysis; generic international breadth; silent AI writes.
8. **Fork:** No recommendation to fork. TPT and DocPilot are MIT but still require dependency/security review. OpenEMR requires GPL analysis. Medigo and HCW rights are unresolved.
9. **Build from scratch:** Bangladesh serial/queue, patient identity, prescription, follow-up, localization, offline delivery, and AI approval workflow.
10. **Hybrid:** New Bangladesh domain/API, TPT-like EHR separation, HCW-like consultation/media orchestration, DocPilot-like mobile packaging, and provider abstractions for WhatsApp/SMS/email.
11. **Models to influence design:** OpenEMR patient/scheduling/clinical/drug/prescription/document/audit separation; TPT `Patient`/`StaffMember`/`Tenant`/`Encounter`; HCW `Consultation`/`Participant`/`ConsultationInvitation`; Medigo `Appointment`/`Doctor`/`MedicalReport`/`Prescription` boundaries only.
12. **Do not copy:** Unknown-license source, OpenEMR source without GPL analysis, generic international integrations without local need, code without PHI/authorization review, or AI behavior that writes diagnoses/prescriptions without doctor approval.

Required new domain entities should include explicit `Serial`, `LabReport`, `LabResult`, `PrescriptionItem`, `FollowUp`, `CommunicationDelivery`, and AI draft/approval records.

## Inspection Limits

- Medigo was recovered in a separate clone at `reference-repos/medigo-analysis/`; the original `reference-repos/Medigo` checkout was not modified.
- OpenEMR was analyzed from local git objects using `git show` and `git ls-tree`; the sparse working tree was not populated.
- The repositories were not comprehensively built or exercised during this teardown. Runtime behavior, production authorization, provider configuration, deployment, backups, and delivery guarantees remain verification tasks.
- No patient data was accessed; all analysis concerns public source code and repository metadata.
- No product implementation was started.

The individual source reports remain in this directory for detailed follow-up:

- `REPOSITORY-INVENTORY.md`
- `ARCHITECTURE-COMPARISON.md`
- `DATA-MODEL-COMPARISON.md`
- `TELEMEDICINE-COMPARISON.md`
- `PRESCRIPTION-COMPARISON.md`
- `AI-COMPARISON.md`
- `SECURITY-COMPARISON.md`
- `LICENSE-MATRIX.md`
- `REUSABILITY-MATRIX.md`
- `BANGLADESH-GAP-ANALYSIS.md`
- `FINAL-TECHNICAL-TEARDOWN.md`
