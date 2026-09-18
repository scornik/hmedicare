# REST API Specification

## 1. API conventions

Base path: `/api/v1`. JSON request/response bodies use ISO-8601 timestamps and opaque UUIDs. All tenant-owned endpoints resolve the tenant from the authenticated membership and require an explicit tenant context in the path or selected header. The service MUST verify that the actor belongs to that tenant.

Standard response envelope:

```json
{
  "data": {},
  "meta": {"requestId": "uuid"},
  "errors": []
}
```

Errors use stable codes, human-safe messages, field details, and `requestId`; they never include PHI or provider secrets. List endpoints support `limit` (bounded), opaque `cursor`, `sort`, and domain filters. Mutating POST endpoints that can be retried require `Idempotency-Key`.

## 2. Authentication and authorization

- `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/password/reset/request`, `POST /auth/password/reset/complete`.
- `POST /auth/session/refresh`, `DELETE /auth/session`.
- API access token is short-lived; refresh token rotation and device/session revocation are server-side.
- Every endpoint lists required permission in route metadata and checks it in the service layer.

Roles are capabilities, not hard-coded UI assumptions: `tenant_owner`, `clinic_admin`, `doctor`, `nurse`, `receptionist`, `patient`, and optional `billing_manager`. A doctor may access assigned patient/encounter records; staff access is scoped by explicit tenant/clinic/chamber permissions; patients access only their own records and shared documents.

## 3. Identity and patient endpoints

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/tenants` | platform/admin | Create tenant. |
| `GET` | `/patients?query=&phone=&mrn=` | patient.read | Search tenant patients with minimum necessary fields. |
| `POST` | `/patients` | patient.write | Create patient after duplicate check. |
| `GET` | `/patients/{patientId}` | patient.read | Patient profile and access summary. |
| `PATCH` | `/patients/{patientId}` | patient.write | Update demographics/contacts; sensitive fields audit. |
| `POST` | `/patients/{patientId}/merge-cases` | patient.merge | Request duplicate merge; never automatic final merge. |
| `GET` | `/patients/{patientId}/timeline` | timeline.read | Cursor-paginated timeline. |
| `GET` | `/patients/{patientId}/access-log` | audit.read | Authorized access history. |

Example patient creation:

```json
{
  "firstName": "Example",
  "lastName": "Patient",
  "dateOfBirth": "1990-01-15",
  "phone": "+8801XXXXXXXXX",
  "alternateContacts": [],
  "locale": "bn-BD",
  "consents": [{"purpose": "care", "channel": "in_app"}]
}
```

The example contains no real patient data. Phone normalization and duplicate scoring are server-side.

## 4. Scheduling and serial endpoints

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/chambers` | chamber.manage | Create chamber. |
| `POST` | `/chambers/{id}/schedule-rules` | schedule.manage | Create recurring/exception schedule. |
| `POST` | `/chamber-days` | schedule.manage | Materialize a chamber day. |
| `GET` | `/chamber-days/{id}/availability` | appointment.read | View slots/capacity. |
| `POST` | `/appointments` | appointment.write | Book advance appointment. Idempotent. |
| `POST` | `/chamber-days/{id}/walk-ins` | serial.write | Register walk-in and issue serial. Idempotent. |
| `POST` | `/serials/{id}/check-in` | serial.manage | Check in physical/remote patient. |
| `POST` | `/serials/{id}/call` | queue.call | Call patient. |
| `POST` | `/serials/{id}/skip` | queue.manage | Skip with reason and recall policy. |
| `POST` | `/serials/{id}/recall` | queue.manage | Recall skipped patient. |
| `POST` | `/serials/{id}/cancel` | serial.manage | Cancel serial. |
| `POST` | `/chamber-days/{id}/reorder` | queue.manage | Audited queue reorder. |
| `GET` | `/chamber-days/{id}/queue` | queue.read | Patient-minimized queue view or staff view based on permission. |

Serial issue request:

```json
{
  "patientId": "uuid",
  "appointmentId": "uuid",
  "careMode": "remote",
  "source": "advance_booking"
}
```

Queue transition request:

```json
{
  "reason": "patient confirmed readiness",
  "expectedVersion": 12
}
```

The server rejects invalid transitions and stale `expectedVersion` values.

## 5. Encounter and clinical endpoints

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/serials/{id}/encounter` | encounter.start | Start encounter exactly once. |
| `GET` | `/encounters/{id}` | encounter.read | Encounter and participants. |
| `POST` | `/encounters/{id}/participants` | encounter.manage | Add authorized staff/interpreter. |
| `PATCH` | `/encounters/{id}/notes` | note.write | Save versioned structured draft. |
| `POST` | `/encounters/{id}/symptoms` | clinical.write | Add symptom observation. |
| `POST` | `/encounters/{id}/diagnoses` | diagnosis.write | Add doctor-authored diagnosis. |
| `POST` | `/encounters/{id}/complete` | encounter.complete | Complete encounter and publish timeline events. |
| `POST` | `/encounters/{id}/interrupt` | encounter.manage | Record interruption/reconnect reason. |

No endpoint accepts an AI output as a final clinical write. AI approval endpoints are separate and permissioned.

## 6. Prescription, labs, documents, follow-up

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/encounters/{id}/prescriptions` | prescription.write | Create draft prescription. |
| `PATCH` | `/prescriptions/{id}` | prescription.write | Edit draft/version. |
| `POST` | `/prescriptions/{id}/approve` | prescription.approve | Doctor approves and finalizes immutable version. |
| `POST` | `/prescriptions/{id}/render` | prescription.read | Enqueue PDF generation. |
| `GET` | `/prescriptions/{id}` | prescription.read | View permitted prescription. |
| `POST` | `/patients/{id}/lab-reports/upload-session` | document.write | Create authorized multipart upload. |
| `POST` | `/lab-reports` | lab.write | Register uploaded report and metadata. |
| `POST` | `/lab-reports/{id}/results` | lab.write | Add reviewed structured result. |
| `GET` | `/documents/{id}/download-url` | document.read | Issue short-lived signed URL after authorization. |
| `POST` | `/encounters/{id}/follow-ups` | followup.write | Create plan and optional appointment. |
| `PATCH` | `/follow-ups/{id}` | followup.write | Update status/due date with audit. |

Prescription approval example:

```json
{
  "version": 2,
  "attestation": "I reviewed and approve this prescription",
  "sendChannels": ["patient_portal", "email"]
}
```

## 7. Communication and telemedicine endpoints

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/communications` | communication.send | Create consent-checked message intent. |
| `GET` | `/communications/{id}` | communication.read | Delivery status and redacted attempts. |
| `POST` | `/encounters/{id}/telemedicine/session` | telemedicine.start | Create provider-neutral session. |
| `POST` | `/telemedicine/sessions/{id}/join-token` | telemedicine.join | Issue short-lived participant token. |
| `POST` | `/telemedicine/sessions/{id}/end` | telemedicine.manage | End session and record reason. |
| `POST` | `/communications/{id}/retry` | communication.retry | Retry permitted failed attempt. |

Provider IDs and raw payloads are never returned to patients unless required for support.

## 8. AI endpoints

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/encounters/{id}/ai/note-draft` | ai.use | Enqueue draft from selected sources. |
| `POST` | `/encounters/{id}/ai/transcription` | ai.use | Enqueue uploaded audio transcription. |
| `GET` | `/ai/jobs/{id}` | ai.read | Job status and safe output reference. |
| `POST` | `/ai/drafts/{id}/review` | doctor.review_ai | Accept/edit/reject suggestions. |
| `POST` | `/ai/suggestions/{id}/approve` | doctor.approve_ai | Convert one suggestion into a clinician-authored record. |

Review request:

```json
{
  "decision": "edited",
  "editedText": "doctor-authored text",
  "approvedTarget": "encounter_note"
}
```

The API rejects approval by a patient, unassigned staff member, or non-clinician role.

## 9. Pagination, validation, and audit

- Validate all identifiers, enum values, dates, lengths, MIME types, and tenant ownership.
- Use cursor pagination for timeline, messages, audit, queue events, and delivery attempts.
- Use optimistic version fields for queue, encounter notes, prescriptions, and patient merges.
- Audit all clinical writes, approvals, access to PHI, permission changes, document access, communication actions, and export actions.
- API tests MUST include invalid transition, cross-tenant ID, unauthorized role, replayed idempotency key, and stale version cases.

## Change log

### 2026-09-17 — Stage 3.1

- The lab-report upload-session route and `GET /documents/{id}/download-url` are replaced by `/documents/upload-sessions*` and `POST /documents/{id}/download-token` + token-streamed download (ADR-016, audit C-12).
- The doctor-prefixed AI review/approve permissions are replaced by the canonical `ai.review` and `ai.approve` plus the encounter-assignment rule (audit S3-03, C-14).
- New routes for per-doctor AI credentials, tenant AI policy, acknowledgements and usage (ADR-017); patient contexts via `X-Patient-Context` (audit C-15); internal job runner and diagnostics (ADR-015, ADR-013).
- Live queue updates use ETag polling (ADR-013, audit C-09). Route, permission and error-code contract: `docs/implementation/API-IMPLEMENTATION.md`.

### 2026-09-17 — Stage 3.2

- New routes: payment intents, aamarPay return and IPN callbacks (unauthenticated, verification-protected), fee schedules, merchant accounts, refunds, subscriptions, tenant SMS credentials, platform SMS balance, payouts, medication dataset imports and gate attestations; `GET /medications/search` replaces the catalog query route (ADR-018/019/020). Contract: `docs/implementation/API-IMPLEMENTATION.md` §3.7, §3.9, §3.11, §3.12 and `PAYMENT-IMPLEMENTATION.md` §9.
- Permissions added: `payment.create`, `payment.read`, `payment.merchant.manage`, `fee.manage`, `refund.manage`, `sms.credentials.manage`; platform-only `medication.import`, `payout.manage`, `platform.refund.manage`, `ops.sms.read`. `platform_operator` is an explicit, minimal, audited role outside tenant roles.
