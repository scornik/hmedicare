# Implementation Roadmap

This roadmap is for a new codebase. It contains no implementation work in this stage.

## Phase 0 - Architecture and validation

**Objectives:** approve domain names, threat model, provider evaluation plan, Bangladesh research register, and API/database conventions.

- Modules: architecture package, ADRs, test strategy, migration policy.
- Database: migration baseline and tenant context design.
- API: error envelope, auth contract, idempotency, pagination.
- UI: clickable workflow prototypes only if useful; no production feature dependency.
- Tests: architecture consistency, authorization matrix, serial transition table tests designed.
- Acceptance: all required specs reviewed, unresolved questions owner-assigned, no reference code selected for copying.
- Risks: provider/legal decisions may alter adapters but must not change core domain IDs.

## Phase 1 - Foundation

**Objectives:** API shell, PostgreSQL, migrations, object storage abstraction, job queue, observability, CI.

- Database: `tenants`, `users`, `tenant_memberships`, audit base.
- API: health, request IDs, authentication boundary, tenant context.
- UI: environment/session shell.
- Tests: migration, health, secret/config, tenant context, log redaction.
- Acceptance: a request cannot access a tenant without membership; no PHI in baseline logs.

## Phase 2 - Identity, tenant, patient

**Objectives:** accounts, roles, patient identity, phone normalization, duplicate review.

- Database: patient/contact/identifier/consent/merge tables.
- API: patient create/search/read/update, merge case workflow.
- UI: doctor/staff registration and patient search/create.
- Tests: duplicate scoring, verified phone, cross-tenant access, merge audit.
- Acceptance: one patient can own multiple future appointments/serials/encounters without duplication.

## Phase 3 - Doctor, chamber, scheduling, serial

**Objectives:** recurring chamber days, slots, walk-ins, shared queue.

- Database: clinics, chambers, schedule rules, chamber days, slots, appointments, serials, check-ins, queue events.
- API: booking, walk-in, check-in, queue read, call, skip, recall, reorder, delay.
- UI: doctor queue and patient queue position.
- Tests: exhaustive state transition matrix, concurrency/duplicate issuance, no-show/recall, reorder audit, physical/remote mixed queue.
- Acceptance: no serial number collision; every transition is auditable; queue truth survives client retry.
- Risks: queue concurrency and chamber-day timezone boundaries.

## Phase 4 - Consultation and clinical records

**Objectives:** physical and remote encounter lifecycle, participants, notes, symptoms, diagnoses, documents.

- Database: encounters, participants, notes, symptoms, diagnoses, documents.
- API: encounter start/interruption/end, clinical writes, upload sessions.
- UI: doctor consultation workspace and patient encounter status.
- Tests: serial-to-encounter uniqueness, permission scopes, version conflict, interruption/reconnect.
- Acceptance: completed serial has exactly one encounter link and clinical records remain versioned.

## Phase 5 - Prescription

**Objectives:** fast structured prescription editor, doctor approval, PDF rendering.

- Database: medications/catalog import boundary, patient medications, prescriptions/items, document versions.
- API: draft/edit/approve/render/access.
- UI: autocomplete, structured dosage/frequency/duration/instructions, approval screen.
- Tests: item validation, approval permissions, immutable final version, render failure/retry, no silent AI finalization.
- Acceptance: final prescription is doctor-approved, versioned, auditable, and patient-accessible.
- Dependency: verified medicine dataset is not required for schema/API work; catalog import is gated.

## Phase 6 - Patient timeline

**Objectives:** create an efficient patient history projection.

- Database: timeline events, projection version/checkpoint.
- API: cursor timeline with filters/source links.
- UI: doctor timeline and patient approved-history view.
- Tests: event ordering, idempotent projection, source authorization, redaction behavior.
- Acceptance: appointment, serial, encounter, diagnosis, prescription, lab, document, communication, AI approval, and follow-up events appear with source references.

## Phase 7 - Follow-up and notifications

**Objectives:** follow-up plans, reminders, queue notifications, delivery intent.

- Database: follow-up plans/tasks, communication/preferences/attempts.
- API: follow-up CRUD, communication status, preferences.
- UI: doctor follow-up creation and patient action view.
- Tests: due-date timezone, duplicate reminder prevention, opt-out, retry/fallback.
- Acceptance: follow-up can create a new appointment/serial linked to its source encounter.

## Phase 8 - Communication and telemedicine

**Objectives:** provider adapters, remote session authorization, audio/video fallback.

- Database: telemedicine sessions/participants, communication provider metadata.
- API: session create/join/end, message/delivery operations, webhooks.
- UI: join readiness, low-bandwidth mode, reconnect, audio-only.
- Tests: token scope/expiry, unauthorized join, provider failure, webhook idempotency, reconnection.
- Acceptance: remote patient and doctor use the same encounter/serial flow as physical care.
- Open question: provider selection and Bangladesh WhatsApp/SMS availability.

## Phase 9 - AI and voice

**Objectives:** controlled note drafts, optional asynchronous transcription, history retrieval.

- Database: AI jobs/transcripts/drafts/suggestions/approvals.
- API: trigger/status/review/approve.
- UI: source-linked draft review and explicit approval.
- Tests: schema rejection, prompt-injection fixture, provider timeout, doctor-only approval, audit provenance.
- Acceptance: AI cannot write a final diagnosis/prescription without an authorized doctor action.

## Phase 10 - Mobile hardening

**Objectives:** Android-first offline/cache/upload/retry behavior and low-end device quality.

- Database/API: conflict/version and upload status refinements.
- UI: patient/doctor production flows, push deep links, offline state.
- Tests: device, network switching, process death, upload resume, data clearing on logout.
- Acceptance: manual workflow remains usable when AI/provider/push features fail.

## Phase 11 - Security hardening

**Objectives:** threat-model remediation and operational controls.

- Work: dependency/SBOM review, secret scanning, SAST/DAST, authorization matrix, tenant isolation tests, signed URL tests, PHI log review, backup restore.
- Acceptance: critical findings closed or explicitly risk-accepted; no compliance claim made without external review.

## Phase 12 - Production readiness

**Objectives:** controlled launch readiness.

- Work: load tests for serial concurrency and timeline queries; job backlogs; provider failover; runbooks; incident drills; migration/rollback; support redaction.
- Acceptance: operational SLOs selected, monitoring alerts tested, restore drill passed, legal/provider research register reviewed.

## MVP order

1. Foundation.
2. Identity/tenant/patient.
3. Doctor/chamber/serial.
4. Consultation/clinical notes.
5. Prescription.
6. Timeline.
7. Follow-up/notifications.
8. Minimal remote session adapter.
9. Controlled AI note draft only after the manual loop is stable.

## Change log

### 2026-09-17 — Stage 3.1

- A Phase 0 **Hosting verification** (HOST-001…HOST-013 on the real Hostinger plan, synthetic data only) runs in parallel with Foundation (ADR-013).
- Foundation objectives change from a PostgreSQL database and generic job queue to MariaDB with engine-contract tests (ADR-014) and a database job queue with runner modes (ADR-015).
- New work streams: AI credentials (AICRED), AI policy and minimization (AIPOL), provider adapters (ADAPT) and patient accounts/guardianship (PAT-006…) (ADR-017, audit C-15). Signed URL tests become download-token tests (ADR-016). Sequencing: `docs/implementation/IMPLEMENTATION-BACKLOG.md`.

### 2026-09-17 — Stage 3.2

- New work streams: SMS/OTP delivery and provider credentials (SMS-*, ID-007) before real OTP go-live; payments (PAY-*) after scheduling/queue; medicine dataset import (MEDDATA-*) alongside the prescription catalog; production gates SMS-009, PAY-015, MEDDATA-006 before release. Sequencing: `docs/implementation/IMPLEMENTATION-BACKLOG.md`.
