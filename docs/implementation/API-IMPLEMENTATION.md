# API Implementation Contract

**Stage 3.1 rewrite (2026-09-17).** Resolves C-12 (error-code and endpoint drift). The architecture API spec (`docs/architecture/API-SPEC.md`) remains the product intent. **This file is the build contract, and wins on route names, permissions and error codes** (precedence: consistency audit).

**Stage 3.2 update (2026-09-17):** payments (ADR-019, §3.11), SMS credentials and balance (ADR-018, §3.9), medication search and dataset import (ADR-020, §3.7), platform operator routes (§3.12), new error codes (§4).

## 1. Transport

- **Stack:** NestJS 11 + Fastify (`apps/api`), base path `/api/v1`, JSON bodies, UTC ISO-8601 timestamps with milliseconds, UUIDv7 ids as strings.
- **Contracts:**
  - Request and response schemas are Zod definitions in `packages/contracts/src/<context>/`, registered in the `OpenAPIRegistry`.
  - Controllers use `createZodDto` (nestjs-zod) from the same schemas.
  - `pnpm contracts:generate` writes `packages/contracts/generated/openapi.v1.json` (3.1.0) and `openapi.v1.oas30.json` (3.0.3). CI fails if the generated files differ from the committed ones.
- **Tenant context:** `X-Tenant-ID` is required for staff/doctor routes and for patient-context routes. Membership or patient context is validated server-side, and a body `tenantId` is never trusted.
- **Patient context:** `X-Patient-Context: <patientId>` is required on patient-facing routes (`AUTHORIZATION-MATRIX.md` §4).
- **Platform context (Stage 3.2):** `X-Platform-Context: operator` is required on `/platform/*`, `/admin/*` and `/internal/ops/*` routes. It is mutually exclusive with `X-Tenant-ID` (`AUTH-IMPLEMENTATION.md` §2.6).
- **Unauthenticated provider callbacks:** `/payments/aamarpay/return/*`, `/payments/aamarpay/ipn` and `/webhooks/*` carry no session and no CSRF. They are protected by verification (payments) or signature (webhooks), and are rate-limited.
- **Money:** amounts are JSON **strings** matching `^\d{1,10}\.\d{2}$` with `currency: "BDT"`. There are no numeric money fields (OpenAPI lint rule).
- **Idempotency:** `Idempotency-Key` (8–191 chars, `[A-Za-z0-9_\-:.]`) is **required** on every `POST` that creates or transitions state (route metadata `idempotent: true`) and optional on `PUT`/`PATCH`/`DELETE`. Semantics in `DATABASE-IMPLEMENTATION.md` §3.2.
- **Optimistic concurrency:** `expectedRowVersion` (body) on updates and transitions; `expectedQueueOrderVersion` on reorder, delay and policy. Responses include `rowVersion` (and `queueOrderVersion` on chamber days).
- **Response envelope:** `{ "data": …, "meta": { "requestId": "…", "replayed"?: true } }`. Errors use `ProblemDetails`: `{ "code", "message" (safe, localized key), "requestId", "fieldErrors"?, "retryAfterSeconds"?, "details"? (non-PHI) }`.
- **Pagination:** `limit` (1–100, default 20) plus opaque `cursor`; responses are `{ items, nextCursor, hasMore }`.
- **Rate limits** are DB-backed (ADR-015) and return `429 RATE_LIMITED` with `Retry-After`.
- **Realtime:** polling only (ADR-013 §2). `GET` queue endpoints support `ETag`/`If-None-Match` → `304` to make polling cheap.

## 2. Controllers

| App | Controllers |
|---|---|
| `apps/api` | `AuthController`, `MeController`, `TenantController`, `MembershipController`, `CoverageController`, `PatientController`, `PatientAccountController`, `GuardianshipController`, `CareTeamController`, `ConsentController`, `ChamberController`, `ScheduleController`, `ChamberDayController`, `AppointmentController`, `SerialController`, `QueueController`, `EncounterController`, `ClinicalNoteController`, `DiagnosisController`, `PrescriptionController`, `MedicationController`, `DocumentController`, `LabReportController`, `TimelineController`, `FollowUpController`, `CommunicationController`, `WebhookController`, `TelemedicineController`, `AICredentialController`, `AIPolicyController`, `AIJobController`, `AIDraftController`, `AISuggestionController`, `AIModelController`, `AuditController`, `HealthController`, `InternalMetricsController`; **Stage 3.2:** `PaymentIntentController`, `PaymentGatewayCallbackController`, `FeeScheduleController`, `MerchantAccountController`, `PaymentSettingsController`, `RefundController`, `SubscriptionController`, `SmsCredentialController`, `PlatformSmsController`, `PlatformPayoutController`, `AdminMedicationImportController` |
| `apps/worker` | `HealthController`, `InternalJobsController`, `InternalMetricsController`, `InternalDiagnosticsController` (HOST tasks; disabled unless `DIAGNOSTICS_ENABLED=true`) |

## 3. Endpoint matrix

Legend: **Tx** = transaction (RC = READ COMMITTED with locks; RR = default). **Idem** = `Idempotency-Key` required.

### 3.1 Health and internal

| Method / path | App | Auth | Notes |
|---|---|---|---|
| `GET /health/live` | api, worker | none | process up; returns `bootId`, `uptimeSeconds`, `version` |
| `GET /health/ready` | api, worker | none (minimal body) | DB ping (≤ 500 ms), storage adapter `head` on a probe key, config valid, worker: job lag per queue (`degraded` if above thresholds). 503 if DB/storage down |
| `GET /internal/metrics` | api, worker | `Authorization: Bearer INTERNAL_METRICS_TOKEN` | Prometheus text format (OBSERVABILITY.md) |
| `POST /internal/jobs/run` | worker (and api in `embedded` mode) | `Bearer INTERNAL_CRON_TOKEN` (constant-time compare; 401 otherwise; rate-limited) | runs one bounded batch under the singleton lock; `202` skipped if lock held |
| `GET /internal/diagnostics/{db,runtime,storage}` | worker | `Bearer INTERNAL_DIAGNOSTICS_TOKEN`, `DIAGNOSTICS_ENABLED` | HOST-001/002/007 only; never enabled with production data after HOST sign-off |
| `POST /internal/ops/dead-letters/{id}/replay` | worker | platform operator session + `ops.jobs.replay` | audited |

### 3.2 Auth and me

| Method / path | Use case | Permission | Tx | Idem | Notes |
|---|---|---|---|---|---|
| `POST /auth/otp/request` | RequestOtp | public, rate-limited | RR | ✓ | `otp_challenges`; **synchronous** delivery after commit via `OtpDeliveryPort` (Zaman IT SMS, ADR-018); no job |
| `POST /auth/otp/verify` | VerifyOtp | public, rate-limited | RR | ✓ | creates session; web sets `__Host-hm_rt` + `__Host-hm_csrf`, returns `accessToken`, `csrfToken` |
| `POST /auth/password/login` | PasswordLogin | public, rate-limited | RR | ✓ | staff/doctor |
| `POST /auth/password/reset/request` · `/complete` | Request/CompletePasswordReset | public, rate-limited | RR | ✓ | |
| `POST /auth/email/verify` | VerifyEmail | public | RR | ✓ | |
| `POST /auth/session/refresh` | RefreshSession | web: refresh cookie + CSRF + Origin; mobile: refresh token body | RR | – | rotation, reuse detection |
| `POST /auth/session/csrf` | IssueCsrfToken | refresh cookie (SameSite=Strict csrf cookie) + Origin | – | – | web reload |
| `DELETE /auth/session` · `POST /auth/session/logout-all` | Logout / LogoutAll | session (+ CSRF for web) | RR | – | |
| `GET /me` | GetMe | authenticated | – | – | user, memberships (tenant list) |
| `GET /me/patient-contexts` | ListPatientContexts | authenticated | – | – | tenant picker + dependents |
| `POST /me/push-devices` · `DELETE /me/push-devices/{id}` | Register/RevokePushDevice | authenticated | RR | ✓ | |

### 3.3 Tenant, org, coverage

| Method / path | Use case | Permission | Tx | Idem |
|---|---|---|---|---|
| `POST /tenants` | BootstrapTenant | platform operator only (disabled in tenant sessions) | RR | ✓ |
| `GET/PATCH /tenant` | Get/UpdateTenantSettings | `tenant.manage` | RR | – |
| `GET/POST /memberships`, `PATCH /memberships/{id}` | membership mgmt | `membership.manage` | RR | ✓ POST |
| `POST /clinics`, `PATCH /clinics/{id}` | clinic mgmt | `clinic.manage` | RR | ✓ |
| `POST /doctor-coverages`, `POST /doctor-coverages/{id}/revoke` | Grant/RevokeCoverage | `coverage.manage` | RR | ✓ |

### 3.4 Patients, accounts, guardianship, care team, consent

| Method / path | Use case | Permission / scope | Tx | Idem |
|---|---|---|---|---|
| `GET /patients?query=&phone=&mrn=&cursor=` | SearchPatients | `patient.read` | – | – |
| `POST /patients` | CreatePatient | `patient.write` | RR | ✓ |
| `GET /patients/{id}` · `PATCH /patients/{id}` | Get/UpdatePatient | `patient.read` / `patient.write` (+asg/scope) | RR | – |
| `POST /patients/{id}/merge-cases`, `POST /merge-cases/{id}/approve` · `/reject` | merge workflow | `patient.merge` | RR | ✓ |
| `GET /patients/{id}/timeline` | GetTimeline | `timeline.read` (+asg) | – | – |
| `GET /patients/{id}/access-log` | GetAccessLog | `audit.read` | – | – |
| `POST /patient-accounts/link-requests` | RequestPatientAccountLink | patient user (OTP-authenticated) | RR | ✓ |
| `POST /patient-accounts/{id}/verify` · `/revoke` | Verify/RevokePatientAccount | `patient_account.manage` | RR | ✓ |
| `POST /patients/{id}/guardianships` | RequestGuardianship | patient user (becomes PENDING) or staff | RR | ✓ |
| `POST /guardianships/{id}/activate` · `/end` · `/revoke` | Activate/End/RevokeGuardianship | `guardianship.manage` | RR | ✓ |
| `POST /patients/{id}/care-team`, `POST /care-team-members/{id}/end` | Add/EndCareTeamMember | `care_team.manage` | RR | ✓ |
| `POST /patients/{id}/consents`, `POST /consents/{id}/withdraw` | Grant/WithdrawConsent | staff `patient.write` or patient context (`GIVE_CONSENT` for guardians) | RR | ✓ |

### 3.5 Scheduling and queue

| Method / path | Use case | Permission | Tx | Idem |
|---|---|---|---|---|
| `POST /chambers` · `PATCH /chambers/{id}` | chamber mgmt | `chamber.manage` | RR | ✓ |
| `POST /chambers/{id}/schedule-rules` | CreateScheduleRule | `schedule.manage` | RR | ✓ |
| `POST /chamber-days` | MaterializeChamberDay | `schedule.manage` | RR | ✓ |
| `GET /chamber-days/{id}` · `/availability` | queries | `appointment.read` | – | – |
| `POST /chamber-days/{id}/open` · `/pause` | Open/PauseChamberDay | `schedule.manage` | RC day lock | ✓ |
| **`POST /chamber-days/{id}/close`** | CloseChamberDay | `chamber_day.close` | RC day lock | ✓ |
| **`POST /chamber-days/{id}/delay`** | RecordChamberDelay | `queue.manage` | RC day lock | ✓ |
| `PUT /chamber-days/{id}/queue-policy` | UpdateChamberDayPolicy | `queue.manage` | RC day lock | ✓ |
| `POST /chamber-days/{id}/reorder` | ReorderQueue | `queue.manage` | RC day+serials | ✓ |
| `GET /chamber-days/{id}/queue` | GetQueue (staff view; ETag) | `queue.read` | – | – |
| `POST /appointments` · `POST /appointments/{id}/cancel` | Create/CancelAppointment | `appointment.write` or patient context `BOOK_APPOINTMENTS` | RC day lock | ✓ |
| `POST /appointments/{id}/serial` | IssueAppointmentSerial | `serial.write` or patient context `MANAGE_SERIALS` | RC | ✓ |
| `POST /chamber-days/{id}/walk-ins` | IssueWalkInSerial | `serial.write` | RC | ✓ |
| `GET /serials/{id}` | GetSerial (staff or patient view by context) | `queue.read` / patient context | – | – |
| `GET /me/serials` | ListMySerials | patient context | – | – |
| `POST /serials/{id}/confirm` | ConfirmSerial | `serial.manage` / patient context | RC | ✓ |
| `POST /serials/{id}/check-in` | CheckInSerial | `serial.manage` / patient context | RC | ✓ |
| **`POST /serials/{id}/remote-ready`** | MarkRemoteReady | patient context `MANAGE_SERIALS` / `serial.manage` | RC | ✓ |
| `POST /serials/{id}/mark-waiting` | MarkWaiting | `serial.manage` | RC | ✓ |
| `POST /serials/{id}/call` | CallSerial | `queue.call` | RC | ✓ |
| `POST /serials/{id}/skip` | SkipSerial | `queue.manage` | RC | ✓ |
| `POST /serials/{id}/recall` | RecallSerial | `queue.manage` | RC | ✓ |
| **`POST /serials/{id}/no-show`** | MarkNoShow | `serial.manage` | RC | ✓ |
| **`POST /serials/{id}/cancel`** | CancelSerial | `serial.manage` / patient context (BOOKED/CONFIRMED only) | RC | ✓ |
| **`POST /serials/{id}/reschedule`** | RescheduleSerial | `appointment.write` / patient context `BOOK_APPOINTMENTS` | RC both days | ✓ |
| `POST /appointments/{id}/payment-override` | WaiveAppointmentPayment (`PENDING_PAYMENT` → `BOOKED`, serial issued; reason required) | `appointment.write` | RC | ✓ |

### 3.6 Clinical

| Method / path | Use case | Permission / scope | Tx | Idem |
|---|---|---|---|---|
| `POST /serials/{id}/encounter` | StartEncounter | `encounter.start` + doctor of chamber | RC day+serial | ✓ |
| `GET /encounters/{id}` | GetEncounter | `encounter.read` + asg/scope | – | – |
| `POST /encounters/{id}/participants` | AddParticipant | `encounter.manage` | RR | ✓ |
| **`POST /encounters/{id}/interrupt`** | InterruptEncounter | `encounter.manage` + asg | RC | ✓ |
| `POST /encounters/{id}/resume` | ResumeEncounter | `encounter.manage` + asg | RC | ✓ |
| `POST /encounters/{id}/complete` | CompleteEncounter | `encounter.complete` + asg | RC serial+encounter | ✓ |
| `POST /encounters/{id}/entered-in-error` | MarkEncounterEnteredInError | `encounter.manage` + asg + reason | RC | ✓ |
| `GET /encounters/{id}/note` | GetNoteDraft | `encounter.read` | – | – |
| `PUT /encounters/{id}/note` | SaveEncounterNoteDraft (autosave) | `note.write` + asg/scope; `expectedRowVersion` | RR | – |
| `POST /encounters/{id}/note/sign` | SignEncounterNote | `note.sign` + asg (encounter) | RR | ✓ |
| `POST /encounters/{id}/note/corrections` | SignNoteCorrection (new revision + reason) | `note.sign` + asg | RR | ✓ |
| `GET /encounters/{id}/note/revisions` | ListNoteRevisions | `encounter.read` | – | – |
| `POST /encounters/{id}/symptoms` | RecordSymptom | `clinical.write` | RR | ✓ |
| `POST /encounters/{id}/diagnoses` · `PATCH /diagnoses/{id}` | Add/UpdateDiagnosis | `diagnosis.write` + asg | RR | ✓ POST |

### 3.7 Prescriptions and catalog

| Method / path | Use case | Permission / scope | Tx | Idem |
|---|---|---|---|---|
| `GET /medications/search?q=&limit=&cursor=` | SearchMedications (ADR-020 §4; tenant boost; inactive/veterinary excluded; returns `catalogSource {datasetVersion, reviewStatus, dgdaMatch, isSynthetic}` and optional `observedPrices[] {amount, label, sourceId, observedAt}` labelled "observed price, may differ") | `prescription.write` | – | – |
| `GET /medications/{id}` | GetMedication | `prescription.write` / `prescription.read` | – | – |
| `POST /admin/medications/imports` | RequestMedicationImport (`{datasetVersion, dryRun?}`; job `ImportMedicationDataset`; production gate) | platform `medication.import` | RR | ✓ |
| `GET /admin/medications/imports` · `GET /admin/medications/imports/{id}` | ListImports / GetImportReport | platform `medication.import` | – | – |
| `POST /admin/medications/datasets/{version}/gate-attestations` | RecordDatasetGateAttestation (`{gateCode, evidenceRef, summary}`) | platform `medication.import` | RR | ✓ |
| `GET /admin/medications/datasets/{version}/gates` | GetDatasetGateStatus | platform `medication.import` | – | – |
| `POST /encounters/{id}/prescriptions` | CreatePrescriptionDraft | `prescription.write` + asg | RR | ✓ |
| `PATCH /prescriptions/{id}` | EditPrescriptionDraft | `prescription.write` + asg; `expectedRowVersion` | RR | – |
| `POST /prescriptions/{id}/review` | MarkPrescriptionReviewed | `prescription.review` (prescribing doctor or nurse with grant) | RR | ✓ |
| `POST /prescriptions/{id}/approve` | ApprovePrescription | `prescription.approve` + asg (encounter) + doctor role | RC | ✓ |
| **`POST /prescriptions/{id}/void`** | VoidPrescription | `prescription.void` (+ rules in AUTHORIZATION-MATRIX §6) | RC | ✓ |
| `POST /prescriptions/{id}/corrections` | CreatePrescriptionCorrectionDraft (revision N+1, supersedes) | `prescription.write` + asg | RC | ✓ |
| `POST /prescriptions/{id}/render` | RenderPrescription | `prescription.render` | RR | ✓ |
| `GET /prescriptions/{id}` | GetPrescription | `prescription.read` / patient context (approved only) | – | – |

### 3.8 Documents and labs (unified upload routes)

| Method / path | Use case | Permission / scope | Tx | Idem |
|---|---|---|---|---|
| **`POST /documents/upload-sessions`** | CreateUploadSession (`category`, `patientId`, `encounterId?`, `contentType`, `sizeBytes`, `sha256`) | `document.write` or patient context `UPLOAD_DOCUMENTS` | RR | ✓ |
| **`PUT /documents/upload-sessions/{id}/parts/{partNumber}`** | UploadPart (disk adapter; streamed body ≤ 8 MiB; header `X-Part-SHA256`) | session owner | – | – |
| **`POST /documents/upload-sessions/{id}/parts`** | GetPartUploadTargets (S3 adapter: presigned part URLs) | session owner | – | ✓ |
| **`POST /documents/upload-sessions/{id}/finalize`** | FinalizeUpload (parts list + checksums) | session owner | RR | ✓ |
| `POST /documents/upload-sessions/{id}/abort` | AbortUpload | session owner | RR | ✓ |
| `GET /documents/{id}` | GetDocumentMetadata | `document.read` / patient context | – | – |
| **`POST /documents/{id}/download-token`** | IssueDownloadToken (60 s, version-bound) | `document.read` / patient context | – | – |
| **`GET /documents/{id}/download?token=`** | StreamDownload (disk) or `302` to presigned URL (S3) | token | – | – |
| `POST /documents/{id}/redact` | RedactDocument | `document.write` + tenant_owner/clinic_admin + reason | RR | ✓ |
| `POST /lab-reports` | CreateLabReport (**requires `documentId` of an `AVAILABLE` document**) | `lab.write` | RR | ✓ |
| `POST /lab-reports/{id}/results` | RecordLabResult | `lab.write` | RR | ✓ |
| `POST /lab-reports/{id}/review` | ReviewLabReport | `lab.review` + asg | RR | ✓ |

The Stage 3 routes `POST /patients/{id}/lab-reports/upload-session` and `GET /documents/{id}/download-url` are **removed** (C-12).

### 3.9 Follow-up, communication, telemedicine

| Method / path | Use case | Permission | Tx | Idem |
|---|---|---|---|---|
| `POST /encounters/{id}/follow-ups` · `PATCH /follow-ups/{id}` | Create/UpdateFollowUp | `followup.write` + asg | RR | ✓ POST |
| `POST /follow-ups/{id}/book` | BookFollowUp (creates appointment + serial) | `appointment.write` / patient context | RC | ✓ |
| `POST /communications` · `GET /communications/{id}` · `POST /communications/{id}/retry` | communication | `communication.send` / `.read` / `.retry` | RR | ✓ POST |
| `GET/PUT /patients/{id}/communication-preferences` | preferences | staff or patient context `MANAGE_COMMUNICATION_PREFERENCES` | RR | – |
| `POST /webhooks/{providerAdapter}` | HandleProviderWebhook | provider signature | RR | – |
| `GET /tenant/sms-credentials` · `POST /tenant/sms-credentials` · `DELETE /tenant/sms-credentials/{id}` | List / CreateSmsCredential (`apiKey` write-only, `senderId`, `balanceAlertBdt?`) / RevokeSmsCredential | `sms.credentials.manage` | RR | ✓ POST |
| `POST /tenant/sms-credentials/{id}/validate` · `GET /tenant/sms-credentials/{id}/balance` | Validate (free `checkbalance`) / latest balance snapshot | `sms.credentials.manage` | – | ✓ POST |
| `GET /platform/sms/balance` | GetPlatformSmsBalance (snapshots, 30-day trend, spend estimate) | platform `ops.sms.read` | – | – |
| `POST /encounters/{id}/telemedicine/session` | CreateSession | `telemedicine.start` + asg | RR | ✓ |
| `POST /telemedicine/sessions/{id}/join-token` | IssueJoinToken | `telemedicine.join` / patient context `JOIN_TELEMEDICINE` | – | ✓ |
| `POST /telemedicine/sessions/{id}/end` | EndSession | `telemedicine.manage` | RR | ✓ |

### 3.10 AI

All routes are listed in `AI-IMPLEMENTATION.md` §11, and are part of this matrix by reference:
- `GET/POST /doctors/me/ai/credentials`, `DELETE /doctors/me/ai/credentials/{id}`
- `POST /doctors/me/ai/credentials/{id}/validate`
- `POST …/{id}/disable|enable`
- `PUT /doctors/me/ai/credentials/fallback-order`
- `/doctors/{doctorProfileId}/ai/credentials…` (`ai.credentials.manage`)
- `GET /doctors/me/ai/usage`
- `GET/PUT /tenant/ai-policy`
- `POST /doctors/me/ai/data-use-acknowledgements`
- `GET /ai/acknowledgement-texts/{providerCode}/{tier}`
- `GET /ai/models`
- `POST /encounters/{id}/ai/note-draft`, `POST /encounters/{id}/ai/history-summary`, `POST /encounters/{id}/ai/transcription` (**`FEATURE_DISABLED` in MVP**)
- `GET /ai/jobs/{id}`, `POST /ai/jobs/{id}/cancel`
- `GET /ai/drafts/{id}`, `POST /ai/drafts/{id}/open|close`
- `POST /ai/suggestions/{id}/review`, `POST /ai/suggestions/{id}/approve`
- `GET /ai/raw-outputs/{jobId}`

### 3.11 Payments (Stage 3.2)

All routes, use cases, permissions and transaction notes are in `PAYMENT-IMPLEMENTATION.md` §9 and are part of this matrix by reference:
- `POST /payments/intents`, `GET /payments/intents`, `GET /payments/intents/{id}`, `POST /payments/intents/{id}/review`
- `POST /payments/intents/{id}/refunds`, `POST /refunds/{id}/complete`, `POST /refunds/{id}/cancel`
- `POST /payments/aamarpay/return/{intentId}/{result}` (+ `GET` for `cancel`), `POST /payments/aamarpay/ipn`
- `GET/PUT /tenant/fee-schedules`
- `GET/POST /tenant/payment-merchant-accounts`, `DELETE /tenant/payment-merchant-accounts/{id}`, `POST /tenant/payment-merchant-accounts/{id}/validate`
- `GET/PUT /tenant/payment-settings`
- `GET /tenant/subscription`, `GET /tenant/subscription/invoices`
- `GET /platform/payouts/preview`, `POST /platform/payouts`, `POST /platform/payouts/{id}/mark-paid`, `PUT /platform/tenants/{tenantId}/payment-commission`

### 3.12 Platform operator routes (Stage 3.2)

They use `X-Platform-Context: operator`, require password + OTP session authn, and are audited on the platform chain:
- `POST /tenants`;
- `/internal/ops/*`;
- `/platform/sms/balance`, `/platform/payouts*`, `/platform/tenants/{id}/payment-commission`;
- `/admin/medications/*`.

Gate decisions (`platform_gate_decisions`) have **no HTTP route**. They are written only by `pnpm ops:record-risk-decision` with DB access.

## 4. Canonical error codes

Codes are stable strings. HTTP status is shown. The single source is `packages/kernel/src/errors/codes.ts`; CI compares it with this table.

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | missing/invalid/expired token |
| **`SESSION_REVOKED`** | 401 | session revoked (logout-all, refresh reuse, admin, password change); clients clear local data (Stage 4, audit C-35) |
| `FORBIDDEN` | 403 | permission, scope, assignment or patient-context failure |
| `CSRF_FAILED` | 403 | CSRF header/cookie/Origin mismatch |
| `TENANT_CONTEXT_REQUIRED` | 400 | missing `X-Tenant-ID` |
| `PATIENT_CONTEXT_REQUIRED` | 400 | missing `X-Patient-Context` |
| `RESOURCE_NOT_FOUND` | 404 | |
| `VALIDATION_FAILED` | 400 | schema/field errors |
| `RATE_LIMITED` | 429 | with `Retry-After` (platform rate limit and AI provider rate limit surfaced to UI) |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | |
| `IDEMPOTENCY_REPLAY` | 200/201 | informational (`meta.replayed=true`), not an error body |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | same key still executing |
| **`IDEMPOTENCY_KEY_REUSED`** | 422 | same key, different request hash |
| `STALE_VERSION` | 409 | `expectedRowVersion` mismatch |
| `QUEUE_STATE_CONFLICT` | 409 | state changed; transition no longer valid |
| **`QUEUE_VERSION_CONFLICT`** | 409 | `expectedQueueOrderVersion` mismatch |
| `QUEUE_BUSY` | 503 | lock wait/deadlock retries exhausted |
| `CONCURRENCY_RETRY_EXHAUSTED` | 503 | same outside queue contexts |
| `INVALID_TRANSITION` | 409 | edge not allowed |
| `DUPLICATE_ACTIVE_SERIAL` | 409 | database-enforced |
| `RECALL_LIMIT_REACHED` | 409 | |
| `CHAMBER_DAY_CLOSED` | 409 | |
| `CHAMBER_DAY_HAS_ACTIVE_CONSULTATION` | 409 | |
| `CAPACITY_EXCEEDED` | 409 | |
| `DUPLICATE_PATIENT_REVIEW_REQUIRED` | 409 | |
| `PRESCRIPTION_NOT_APPROVED` | 409 | |
| `PRESCRIPTION_NOT_EDITABLE` | 409 | |
| `UPLOAD_EXPIRED` | 410 | |
| `CHECKSUM_MISMATCH` | 422 | |
| `CONTENT_TYPE_NOT_ALLOWED` | 415 | |
| `PAYLOAD_TOO_LARGE` | 413 | |
| `DOCUMENT_NOT_AVAILABLE` | 409 | still scanning/rejected |
| `DOWNLOAD_TOKEN_INVALID` | 403 | |
| `PROVIDER_UNAVAILABLE` | 503 | non-AI provider adapter failure |
| **`FEATURE_DISABLED`** | 409 | feature flag off (e.g. transcription, `PRESCRIPTION_ITEM` approval target, platform-managed AI) |
| `AI_REVIEW_REQUIRED` | 409 | attempted final action on unreviewed AI content |
| `AI_DRAFT_CLOSED` | 409 | |
| `AI_CONSENT_REQUIRED` | 409 | |
| `AI_ACK_VERSION_OUTDATED` | 409 | |
| `AI_CREDENTIAL_DUPLICATE` | 409 | |
| **`AI_CREDENTIAL_REVOKED`** | 409 | |
| **`INVALID_CREDENTIAL`** | 422 | AI provider rejected key |
| **`QUOTA_EXHAUSTED`** | 429 | provider quota exhausted (doctor-readable) |
| **`MODEL_UNAVAILABLE`** | 409 | |
| **`CONTENT_BLOCKED`** | 422 | provider safety block |
| **`SCHEMA_INVALID`** | 502 | provider output failed validation |
| **`TIMEOUT`** | 504 | provider timeout |
| **`PROVIDER_ERROR`** | 502 | AI provider generic failure |
| **`PHI_MINIMIZATION_FAILED`** | 422 | nothing sent |
| **`POLICY_BLOCKED`** | 403 | tenant policy / ack / production gate / raw media rule (with `details.reason`; Stage 3.2 reasons `PLATFORM_COLLECTION_GATE_OPEN`, `MEDDATA_PRODUCTION_GATES_OPEN`, `SMS_HTTP_GATE_OPEN`, `ENVIRONMENT_MISMATCH`) |
| **`PAYMENT_NOT_REQUIRED`** | 409 | fee resolves to 0.00 or chamber policy does not take online payment |
| **`FEE_NOT_CONFIGURED`** | 409 | no active fee schedule |
| **`PAYMENT_METHOD_UNAVAILABLE`** | 409 | no eligible merchant account |
| **`PAYMENT_ALREADY_PAID`** | 409 | business reference already paid |
| **`PAYMENT_INTENT_EXPIRED`** | 409 | payment hold or intent expired |
| **`PAYMENT_GATEWAY_REJECTED`** | 502 | gateway rejected initiation (safe message key in `details`) |
| **`PAYMENT_GATEWAY_UNAVAILABLE`** | 503 | gateway timeout/unknown outcome |
| **`MERCHANT_CREDENTIAL_INVALID`** | 422 | store/signature key mismatch |
| **`REFUND_NOT_ALLOWED`** | 409 | intent not refundable (state or merchant mode vs actor) |
| **`SMS_CREDENTIAL_INVALID`** | 422 | SMS provider rejected the API key (1001) |
| **`MEDDATA_CHECKSUM_MISMATCH`** | 422 | dataset file checksum mismatch |
| **`MEDDATA_SCHEMA_UNSUPPORTED`** | 422 | dataset schema hash not accepted by this importer |
| **`MEDDATA_IMPORT_IN_PROGRESS`** | 409 | another import is queued or running |
| **`PLATFORM_CONTEXT_REQUIRED`** | 400 | missing or conflicting `X-Platform-Context` |
| `DATA_INTEGRITY_ERROR` | 500 | JSON column/chain validation failure (alerted) |
| `INTERNAL_ERROR` | 500 | |

AI job failures are also exposed as `ai_jobs.error_class` using the same code strings.

## 5. Versioning and clients

- `/api/v1` stays backward-compatible. Breaking changes require `/api/v2` or a documented migration.
- The TypeScript web client is generated from `openapi.v1.json`. The Dart client is generated by `swagger_parser` 1.44.3 from `openapi.v1.oas30.json`. Hand-written duplicate request models are forbidden.
- **Contract tests:**
  - run the API against Testcontainers MariaDB;
  - validate that live responses match the OpenAPI schemas;
  - a CI job generates the Dart client from both the 3.0 and 3.1 artifacts and runs `dart analyze` (smoke).
