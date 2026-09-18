# Domain Model

## 1. Identity and tenancy

- `Tenant`: SaaS boundary; owns clinics, users, chambers, patients, and all clinical/operational records.
- `User`: login identity and global account metadata. A user may have memberships in multiple tenants.
- `TenantMembership`: tenant-scoped role and permission assignment.
- `DoctorProfile`: clinician identity, display information, credentials metadata, specialties, and active status.
- `StaffProfile`: receptionist, nurse, manager, or other operational staff assignment.
- `Patient`: persistent medical identity owned by a tenant. It is not recreated per appointment.
- `PatientContact`: normalized phone/email/contact point with type, verification state, and preference.
- `PatientMergeCase`: controlled duplicate-resolution workflow; never silently merges clinical histories.

## 2. Organization and schedule

- `Clinic`: organization location or business unit within a tenant.
- `Chamber`: doctor-facing service location or virtual chamber. A chamber belongs to a clinic and may support physical, remote, or hybrid care.
- `ChamberDay`: a dated operating instance generated from a recurring schedule. It owns one queue sequence.
- `DoctorScheduleRule`: recurring weekly/exception schedule definition.
- `AppointmentSlot`: bookable time range or booking capacity associated with a chamber day.
- `Appointment`: booking intent for a patient, doctor, chamber day, and care mode. It is not a queue position or encounter.

## 3. Serial and queue

- `Serial`: a patient’s position in one chamber day. It may link to an appointment or be a walk-in serial.
- `QueueEvent`: append-only record of queue transitions, actor, reason, position before/after, and timestamp.
- `CheckIn`: explicit arrival/readiness record with physical/remote method and verification status.
- `QueuePolicy`: chamber-day settings for capacity, numbering, grace period, recall count, and reorder permissions.

### Serial state machine

```text
REQUESTED -> BOOKED -> CONFIRMED -> CHECKED_IN -> WAITING -> CALLED
CALLED -> IN_CONSULTATION -> COMPLETED
CALLED -> SKIPPED -> RECALLED -> CALLED
WAITING -> NO_SHOW
REQUESTED/BOOKED/CONFIRMED/CHECKED_IN/WAITING/CALLED -> CANCELLED
BOOKED/CONFIRMED -> RESCHEDULED -> BOOKED
```

Rules:

- `REQUESTED` is optional for pending remote/online booking; `BOOKED` is the committed serial reservation.
- A walk-in creates a `Serial` directly in `BOOKED` or `CHECKED_IN` according to staff action and has `source=walk_in`.
- Physical and remote serials share the same queue sequence. `care_mode` is `physical`, `remote`, or `hybrid`.
- Only `CHECKED_IN`, `WAITING`, `CALLED`, `IN_CONSULTATION` are queue-active states.
- `CALLED` has a recall deadline. Expiry transitions to `SKIPPED`; staff can create `RECALLED` as a new queue event, not erase history.
- Reordering changes current position through an audited queue event. It does not rewrite the original serial number.
- Delay is represented by chamber-day/queue policy and queue events with reason and expected delay, not by mutating historical timestamps.
- `COMPLETED` requires a linked encounter, even when the encounter is marked interrupted and completed later.
- `NO_SHOW`, `CANCELLED`, and `RESCHEDULED` are terminal for that serial; a new serial is required for a new visit.

## 4. Consultation and clinical model

- `Encounter`: clinical service event linked to one serial, patient, doctor, tenant, and care mode. It has lifecycle, start/end, interruption, and completion status.
- `EncounterParticipant`: patient, doctor, staff, interpreter, or invited participant with role and join/leave metadata.
- `EncounterNote`: structured sections such as complaint, history, examination, assessment, plan, and free-text clinician notes. Versioned and authored.
- `SymptomObservation`: patient-reported or clinician-observed symptom with normalized term where available, free-text detail, onset, severity, and source.
- `Diagnosis`: diagnosis/problem attached to an encounter with code-system reference where available, clinician status, certainty, and notes. AI suggestions are not diagnoses until approved.
- `Medication`: catalog entity with generic/brand names, strength, form, manufacturer, aliases, locale terms, and source/version metadata.
- `PatientMedication`: longitudinal medication history with active/inactive status and source encounter.
- `Prescription`: a doctor-authored clinical document with draft/final/void status, version, approval metadata, and patient/encounter association.
- `PrescriptionItem`: structured medicine instruction: medication reference or free-text fallback, strength, form, route, dose, frequency, duration, quantity, timing, instructions, and substitution flag.
- `LabReport`: patient-associated report metadata and review status, optionally linked to an encounter/follow-up.
- `LabResult`: structured analyte/result where extraction or manual entry is reliable; raw report remains authoritative.
- `Document`: uploaded or generated file metadata, classification, ownership, checksum, versions, and access policy.

## 5. Timeline and follow-up

- `TimelineEvent`: immutable projection record with event type, occurred-at, source type/id, summary, actor, visibility, and searchable structured references. It is generated from committed domain events.
- `FollowUpPlan`: doctor-authored plan with reason, due date/window, instructions, target encounter, and status.
- `FollowUpTask`: operational reminder/task linked to a plan and optionally an appointment/serial.

Timeline event types include `appointment`, `serial`, `queue_change`, `encounter_started`, `encounter_completed`, `symptom`, `diagnosis`, `prescription_finalized`, `lab_report`, `document`, `follow_up`, `communication`, `call`, `ai_approved_note`, and `doctor_note`.

## 6. Communication and telemedicine

- `Communication`: logical outbound/inbound message intent with channel, template, recipient, consent basis, and business reference.
- `CommunicationAttempt`: provider-specific delivery attempt, retry state, provider message ID, receipt, error class, and timestamps.
- `CommunicationPreference`: patient/tenant channel preferences and opt-in/opt-out records.
- `TelemedicineSession`: authorized media session linked to an encounter, provider adapter, expiry, state, and session metadata.
- `TelemedicineParticipant`: session participant authorization and join/leave/reconnect events.
- `MediaArtifact`: optional metadata for user-uploaded audio/video; recording is disabled unless separately enabled with consent and retention policy.

## 7. AI assistance

- `AIJob`: asynchronous job with purpose, provider/model, input references, status, and failure metadata.
- `AITranscript`: transcript segments and language metadata tied to an input artifact and job.
- `AIDraft`: structured draft output with schema version, provenance, uncertainty, and review status.
- `AISuggestion`: atomic suggested symptom, diagnosis, medication, follow-up, or timeline summary item.
- `AIApproval`: doctor review decision, edits, reviewer, timestamp, and final artifact reference.

AI objects are never the clinical source of truth. Final notes, diagnoses, prescriptions, and follow-ups are created or changed only through explicit clinician actions.

## 8. State ownership rules

- Appointment owns booking/cancellation/reschedule state.
- Serial owns queue state and position.
- Encounter owns clinical service lifecycle.
- Prescription owns medication instructions and finalization.
- Timeline owns read-optimized event projection, not clinical mutation.
- Communication owns delivery state, not clinical approval.
- AI owns drafts and provenance, never final clinical truth.

## Change log

### 2026-09-17 — Stage 3.1

- Serial state machine completed: walk-in entry `CHECKED_IN`, `RESCHEDULED` is terminal and creates a linked serial, `IN_CONSULTATION -> CANCELLED` interrupts the encounter (audit C-07).
- Chamber-day versioning is split into `next_serial_number`, `queue_order_version` and `row_version` (audit C-04).
- New entities: `PatientAccount`, `PatientGuardianship`, `CareTeamMember`, `DoctorCoverage` (audit C-14, C-15); `AIProviderCredential`, `TenantAIPolicy`, `AIDataUseAcknowledgement` (ADR-017); `Job`, `DeadLetter` (ADR-015); `UploadSession` (ADR-016).
- Encounter notes: one mutable draft plus immutable signed revisions (audit C-10). Timeline redaction inserts a `REDACTED` marker (audit C-05).

### 2026-09-17 — Stage 3.2

- New entities: `PaymentIntent` (state machine CREATED → REDIRECTED → PENDING_VERIFICATION → PAID/FAILED/CANCELLED/EXPIRED; PAID → REFUND_PENDING → REFUNDED; late verified success flagged for review), `PaymentVerification`, `LedgerEntry`, `Refund`, `Payout`, `FeeSchedule`, `PaymentMerchantAccount`, `Subscription`, `SubscriptionInvoice`, `ProviderCredential`, `PlatformOperator`, `MedicationDatasetImport` (ADR-019/020).
- `Appointment` gains `PENDING_PAYMENT` (capacity held, no serial) and payment requirement/status fields. Payment state never changes clinical entities.
- `Medication` is a global, versioned catalog record with provenance and review status; prescription items snapshot the catalog attributes at selection (ADR-020).
