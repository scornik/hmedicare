# Security Specification

## 1. Security posture

This specification defines controls; it does not claim HIPAA, GDPR, Bangladesh, or other regulatory compliance. Legal, clinical, and regulatory research is required before production.

## 2. Authentication

- Use a managed identity boundary or a dedicated auth service behind an adapter.
- Support email/password where required, Bangladesh phone OTP, optional social identity, email verification, password reset, session listing, refresh-token rotation, and device/session revocation.
- Passwords MUST use a current slow password hash with per-password salt; plaintext and reversible encryption are prohibited.
- OTPs are short-lived, single-use, rate-limited, attempt-limited, and stored hashed or in a protected ephemeral store.
- Access tokens are short-lived and audience/issuer validated. Refresh tokens rotate and are invalidated on reuse or logout.
- Recovery changes require risk-based verification and audit events.

## 3. Authorization and tenant isolation

Authorization is enforced twice:

1. API/service policy checks actor role, tenant membership, clinic/chamber assignment, patient relationship, and action capability.
2. Data-access repositories require tenant context and reject queries without it.

Minimum roles:

- `tenant_owner`: tenant configuration and membership administration.
- `clinic_admin`: clinic/chamber/staff operations.
- `doctor`: assigned patient clinical care and prescription approval.
- `nurse`: permitted clinical support; no prescription approval by default.
- `receptionist`: patient registration, appointment, serial, and limited demographics.
- `patient`: own profile, appointments, serial status, shared documents, prescriptions, and timeline.
- `billing_manager`: billing-only permissions if billing enters scope.

Sensitive permissions are explicit: `patient.read`, `patient.write`, `encounter.read`, `note.write`, `diagnosis.write`, `prescription.approve`, `document.read`, `audit.read`, `export.create`, `queue.manage`, and `ai.review`.

Cross-tenant access tests are mandatory. Frontend filtering is never a security boundary.

## 4. PHI and data protection

- TLS for all network transport.
- Encryption at rest for database, backups, object storage, and job payloads where supported.
- Field-level encryption MAY protect especially sensitive identifiers; key management remains outside application source.
- Object files use private buckets, tenant/resource authorization, short-lived signed URLs, checksum validation, MIME allowlists, and malware-scan status.
- Do not put patient names, phone numbers, diagnoses, prescriptions, transcripts, document contents, access tokens, or signed URLs in ordinary logs.
- Support redacted support views and audited privileged access.

## 5. Audit

Create append-only audit events for:

- login, logout, OTP, reset, token/session changes;
- patient search, profile read, profile change, merge request/approval;
- appointment/serial creation, state changes, reorder, no-show, recall;
- encounter start/end, note/diagnosis/prescription writes and finalization;
- AI job, draft review, suggestion approval/rejection;
- document upload, download/signing, deletion/redaction;
- communication creation, provider delivery, retries, and consent changes;
- membership/permission changes, exports, billing actions, and security incidents.

Audit entries contain actor, tenant, action, resource, outcome, timestamp, request/correlation ID, and redacted metadata. Clinical finalization and approval records are immutable versions; correction creates a new version.

## 6. Files, backups, and deletion

- Files are accessed only through an authorization-aware application endpoint that issues a short-lived URL.
- Upload sessions are scoped to tenant, patient, category, expected MIME/size, and expiry.
- Database backups are encrypted, access-controlled, monitored, and restored in scheduled drills.
- Retention, deletion, legal holds, patient export, and data residency require Bangladesh-specific legal research. Implement policy configuration rather than hard-code an unverified duration.
- Deletion jobs produce audit records and do not erase immutable audit history unless a legally reviewed retention process says otherwise.

## 7. Abuse prevention

- Rate-limit OTP, login, password reset, patient search, upload-session creation, communication sends, AI jobs, and join-token issuance.
- Apply idempotency to serial issuance, appointment booking, communication creation, prescription rendering, and job enqueueing.
- Detect brute force, enumeration, unusual exports, high-volume document access, repeated delivery failures, and suspicious provider activity.
- Use CSRF protection for browser sessions, secure headers, input validation, output encoding, dependency scanning, secret scanning, and SAST/DAST in CI.

## 8. Provider and AI security

- Provider credentials live in a managed secret store and are never sent to clients.
- Provider adapters receive minimal data and use redacted references where possible.
- Consent and channel preference are checked before communication.
- AI input selection is explicit and logged. AI providers receive only the minimum necessary content under a reviewed data-processing arrangement.
- AI output is untrusted input. Schema validation, content limits, prompt-injection defenses, provenance, doctor review, and approval authorization are required.

## 9. Operational controls

- Security events have severity and response ownership.
- Maintain dependency SBOM/license review and vulnerability triage.
- Run authorization, tenant-isolation, upload-access, audit-integrity, backup-restore, and provider-failure tests in staging.
- Legal/regulatory research required before production includes phone/OTP practices, WhatsApp consent and messaging, medical record retention/export, telemedicine consent, prescription rules, payment handling, data residency, and AI clinical governance.

## Change log

### 2026-09-17 — Stage 3.1

- Signed URLs for documents are replaced by short-lived HMAC download tokens bound to user, tenant and document version, streamed through the API (ADR-016).
- Web sessions: in-memory access token plus `__Host-` refresh cookie with CSRF double-submit and Origin checks (ADR-013 §2).
- AI provider data handling is per credential: encoded data-use policy, tenant opt-in, doctor acknowledgement, patient consent and fail-closed minimization for providers that may train on inputs; provider production gates remain OPEN until reviewed (ADR-017). No compliance claim is made.
- Rate limits and OTP state are stored in MariaDB (ADR-015). Provider API keys are envelope-encrypted with `AI_CREDENTIAL_KEK` and never returned by any API (ADR-017).

### 2026-09-17 — Stage 3.2

- SMS: POST-only calls, no key in URLs, TLS verification never disabled, plain-HTTP production use only with an expiring owner decision (`GATE-SMS-HTTP`), no PHI in SMS text (ADR-018).
- Payments: server-computed amounts; callbacks and IPN are untrusted; an intent is paid only after a gateway Search Transaction match; gateway credentials never reach clients; aamarPay mobile SDKs are not used; platform collection of patient fees is gated pending legal/financial research (ADR-019).
- Provider credentials for SMS and payments are envelope-encrypted per tenant/doctor and never readable (ADR-018 §6). Platform operators authenticate with password + OTP and are audited per request.
- No legal, financial or regulatory compliance claim is made.
