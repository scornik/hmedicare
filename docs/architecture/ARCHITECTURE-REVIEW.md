# Architecture Review

## Executive Summary

This stage converts the teardown into a new implementation-ready architecture for a Bangladesh-first doctor telemedicine and patient-continuity platform. The design is a tenant-scoped modular monolith with PostgreSQL, private object storage, durable workers, provider adapters, and shared Flutter doctor/patient clients. It keeps physical and remote patients in the same serial, encounter, timeline, and follow-up domains.

No application source code was created. No reference repository was modified or forked.

## Architecture

Major decisions:

- New codebase, no reference fork.
- Modular monolith first, with workers for slow/retryable operations.
- PostgreSQL source of truth for structured clinical data.
- Object storage for files and private signed access.
- Explicit Tenant/Membership authorization and tenant-scoped repositories.
- First-class Serial/ChamberDay/QueueEvent instead of appointment-as-queue.
- Encounter separated from Appointment and Serial.
- Patient Timeline as an authorized source-linked projection.
- Provider-neutral communication, video, payment, and AI adapters.
- AI drafts only; doctor approval creates final clinical truth.
- Android-first shared Flutter core with role-specific app shells.

## Core Domain Model

The canonical relationships are:

```text
Tenant
  -> Clinic -> Chamber -> ChamberDay -> Appointment -> Serial -> Encounter
Tenant
  -> Users/Memberships -> DoctorProfile/StaffProfile
Tenant
  -> Patient -> Contacts/Consents
Encounter
  -> Participants, Notes, Symptoms, Diagnoses, Prescription, LabReports, Documents
Patient
  -> TimelineEvents, PatientMedications, FollowUpPlans, Communications
Encounter
  -> TelemedicineSession -> Participants/JoinEvents
AIJob
  -> Transcript/Draft/Suggestion -> AIApproval -> doctor-authored final artifact
```

No giant medical-record model, generic EAV clinical model, or appointment record containing all clinical data is used.

## Critical Workflows

### Serial to consultation

A patient is identified or created, books or walks in, receives a serial for a chamber day, checks in, waits in the shared queue, is called or recalled, and starts exactly one encounter. Physical and remote care use the same serial state machine; `care_mode` affects readiness and communication, not identity or timeline ownership.

### Consultation to prescription

The doctor records structured symptoms, diagnoses, notes, documents, and a prescription draft. AI may populate a draft suggestion. The doctor reviews and edits. An authorized doctor approves a version, which becomes immutable final clinical data and triggers PDF rendering/delivery jobs.

### Timeline to follow-up

Committed domain events create source-linked timeline entries. The doctor sees prior encounters, diagnoses, prescriptions, labs, documents, communications, and follow-ups. A follow-up plan can create a new appointment and serial linked to the source encounter without reusing the old serial.

## AI Safety

AI jobs, drafts, suggestions, and approvals are separate from final clinical tables. Every artifact records provider/model/version, input references, output, uncertainty, reviewer, edits, decision, and timestamp. No patient, staff, or automated worker can finalize an AI diagnosis or prescription without the required doctor action.

## Bangladesh Readiness

The architecture includes Asia/Dhaka-aware chamber days, E.164 phone normalization, OTP abstraction, Bangla/English/Banglish search aliases, bilingual document capability, shared physical/remote queue, walk-ins, delay/recall/no-show, resumable uploads, audio-only fallback, provider-neutral SMS/WhatsApp/email, and Android-first low-bandwidth behavior.

The architecture does not claim Bangladesh regulatory compliance, approved medicine data, WhatsApp availability, payment provider availability, or legal retention periods. Those remain explicit research gates.

## Security

Tenant checks exist at API/service and repository layers. Files use private object storage and short-lived signed URLs. Audit events cover PHI access, clinical writes, approvals, communications, permission changes, exports, and security events. Logs are redacted. Backups, restore drills, secret management, rate limiting, dependency review, and tenant-isolation tests are production gates.

## MVP

1. Foundation and tenant context.
2. Patient identity and duplicate review.
3. Chamber/schedule/serial/queue.
4. Encounter and manual clinical notes.
5. Structured prescription and PDF.
6. Patient timeline.
7. Follow-up and notifications.
8. Minimal remote session adapter.
9. Controlled AI note draft after manual workflow stability.

## Deferred Work

Real-time transcription, broad clinical decision support, automated lab extraction, recording, PSTN ownership, advanced payments, claims, cross-tenant sharing, and provider-specific features are deferred until validated.

## Open Questions

- Which identity/OTP provider and Bangladesh SMS route will be used?
- Which WhatsApp Business provider, templates, consent model, and fallback are available?
- Which video provider meets bandwidth, token, TURN/ICE, cost, and data-handling needs?
- Which verified Bangladesh medicine dataset and update process will be licensed?
- What clinical review is required for AI note, diagnosis, medication, and lab suggestions?
- What retention, export, deletion, data residency, telemedicine consent, prescription, and payment requirements apply?
- Which payment provider and cash/chamber settlement process are viable?
- What queue policy do real chambers require for late arrivals, fairness, overbooking, and recall?

## Risks

- Serial concurrency bugs can create double booking or unsafe queue behavior.
- Weak tenant filtering can expose PHI.
- Provider outage can interrupt delivery or consultation.
- AI extraction errors can contaminate records if approval is bypassed.
- Old reference dependencies are not to be inherited.
- Large files, audio, and documents can create cost/retention risk.
- Local provider/legal decisions may change adapters, templates, or policy configuration.

## Reference Repository Influence

### Observed in teardown

OpenEMR relational clinical/audit/API breadth; TPT tenant/EHR boundaries and decision-support entities; HCW consultation/media states and mediasoup topology; Medigo patient/doctor mobile split, Firebase booking/chat, and Agora integration; DocPilot shared Flutter package structure.

### Architectural pattern adopted

Tenant-scoped structured records, explicit appointment/encounter separation, consultation state concepts, provider adapters, shared mobile core, document metadata/versioning, audit events, and human-reviewed AI drafts.

### Pattern modified

Medigo’s mobile split is retained but moved behind a server API and modern shared client core. HCW’s consultation-centric state ideas are combined with TPT/OpenEMR-style patient and clinical separation. Timeline is designed as a projection rather than a reference repository’s arbitrary UI aggregation.

### Pattern rejected

Direct client-side PHI writes, free-text-only prescriptions, one shared user row as the complete patient/doctor EHR model, silent AI writes, generic unverified WhatsApp/SMS claims, legacy dependencies, and copying GPL/unknown-license source without legal review.

## Definition of done for this stage

- All required architecture documents exist.
- Serial engine and state transitions are explicit.
- Patient identity, timeline, consultation, prescription, AI, communication, mobile, security, localization, MVP, roadmap, ADRs, and traceability are documented.
- Database and API names align with the domain model.
- Unresolved provider/legal/clinical questions are preserved.
- No product implementation or reference-repository modification occurred.

## Change log

### 2026-09-17 — Stage 3.1

- The relational engine and signed-URL findings are superseded by ADR-014 (MariaDB) and ADR-016 (download tokens). Stage 3.1 review: `docs/implementation/IMPLEMENTATION-REVIEW.md` and `docs/implementation/ARCHITECTURE-CONSISTENCY-AUDIT.md`.

### 2026-09-17 — Stage 3.2

- Open questions "Which payment provider…" and the SMS/OTP provider are answered by ADR-019 (aamarPay) and ADR-018 (Zaman IT); cash/chamber settlement remains pay-at-chamber without tracking in MVP. The "approved medicine data" non-claim still stands: the imported dataset is `UNVERIFIED` and production-gated (ADR-020).
