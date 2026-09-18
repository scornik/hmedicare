# Domain Service Contracts

**Stage 3.1 rewrite (2026-09-17).** **Stage 3.2 update (2026-09-17):** SMS (§7), payments (§8), medication catalog (§9); `RequestOtp` delivery via `OtpDeliveryPort`; `CreateAppointment` payment holds.

Every use case receives `ActorContext`, `TenantContext` (or `PatientContext`), a request DTO, `idempotencyKey` where required, and `correlationId`. It returns a committed response or a typed failure (`API-IMPLEMENTATION.md` §4 codes).

Unless stated otherwise:
- **Audit** means an append to `audit_logs` in the same transaction.
- **Events** means `outbox_events` rows in the same transaction; jobs follow asynchronously.

## 1. Identity, tenant, patient

| Use case | Input | Authorization / validation | Transaction / changes | Events / jobs | Failures |
|---|---|---|---|---|---|
| `RequestOtp` | phone, purpose, deviceId, locale | public; rate limits | supersede + insert `otp_challenges` | synchronous `OtpDeliveryPort.send` post-commit (Zaman IT; no automatic resend on `UNKNOWN_OUTCOME`) | `RATE_LIMITED` (delivery failures are never surfaced as distinct errors) |
| `VerifyOtp` | phone, code, deviceId | public; attempts | consume challenge; upsert user; session; auto-link accounts | `UserRegistered`?, `PatientAccountLinked`? | `UNAUTHENTICATED`, `RATE_LIMITED` |
| `CreatePatient` | demographics, contacts, locale, consents | `patient.write`; normalize phone; duplicate score ≥ threshold → review | insert patient, contacts, consents | `PatientCreated` | `DUPLICATE_PATIENT_REVIEW_REQUIRED`, `VALIDATION_FAILED` |
| `SearchPatients` | query/phone/MRN, cursor | `patient.read`; min fields; rate limit | read | PHI read audit | `RATE_LIMITED` |
| `RequestPatientAccountLink` | tenantSlug or invite code, patient hint | OTP-authenticated user | insert `patient_accounts` PENDING (or ACTIVE on unique verified phone match) | `PatientAccountLinked` if active | `FORBIDDEN` |
| `VerifyPatientAccount` | accountId, method, evidenceRef | `patient_account.manage`; `expectedRowVersion` | status ACTIVE | `PatientAccountLinked` | `STALE_VERSION` |
| `RequestGuardianship` | dependentPatientId, relationship, scope | patient user or staff | insert PENDING (unique live key) | `GuardianshipRequested` | `VALIDATION_FAILED`, 409 duplicate |
| `ActivateGuardianship` | id, verificationMethod, evidenceRef, startsOn/endsOn | `guardianship.manage`; evidence required | status ACTIVE | `GuardianshipActivated` | `STALE_VERSION` |
| `AddCareTeamMember` / `EndCareTeamMember` | patient, member, role, dates | `care_team.manage` | insert / set `ends_at` | `CareTeamMember*` | duplicate open member (409) |
| `GrantCoverage` / `RevokeCoverage` | covered, covering, window, reason | `coverage.manage` (or covered doctor for own coverage if granted) | insert / status REVOKED | `CoverageGranted/Revoked` | `VALIDATION_FAILED` (window > `COVERAGE_MAX_DAYS`) |
| `GrantConsent` / `WithdrawConsent` | purpose, channel, policy version | staff or patient context (`GIVE_CONSENT`) | insert / withdraw | `ConsentGranted/Withdrawn` | `FORBIDDEN` |

## 2. Scheduling and queue

The full transition rules are in `QUEUE-IMPLEMENTATION.md` §3. Every queue use case locks the chamber day, then the serials (READ COMMITTED), and writes queue events, audit and outbox.

| Use case | Input | Authorization / validation | Changes | Events | Failures |
|---|---|---|---|---|---|
| `CreateAppointment` | patient, doctor, chamber day, slot?, care mode, `issueSerial` flag | `appointment.write` or patient context `BOOK_APPOINTMENTS`; capacity; payment policy (PAYMENT-IMPLEMENTATION §7) | insert appointment: prepaid → `PENDING_PAYMENT` + hold, **no serial**; otherwise `BOOKED` (+ serial via `IssueAppointmentSerial`) | `AppointmentBooked` (+ `SerialIssued`; `AppointmentPaymentPending` when prepaid) | `CAPACITY_EXCEEDED`, `DUPLICATE_ACTIVE_SERIAL`, `CHAMBER_DAY_CLOSED` |
| `IssueWalkInSerial` | chamber day, patient, care mode, duplicateOverride? | `serial.write`; day OPEN/PAUSED | counter++, serial CHECKED_IN→WAITING (default policy), position append | `SerialIssued`, `SerialCheckedIn`, `SerialWaiting` | `DUPLICATE_ACTIVE_SERIAL`, `QUEUE_BUSY`, `IDEMPOTENCY_KEY_REUSED` |
| `ConfirmSerial` / `CheckInSerial` / `MarkRemoteReady` / `MarkWaiting` | serial, expectedRowVersion, method | per route table | status transitions, check-in row, position | `Serial*` | `STALE_VERSION`, `INVALID_TRANSITION` |
| `CallSerial` | serial, expectedRowVersion, override? | `queue.call`; remote ready or override reason | WAITING/CHECKED_IN→CALLED; recall deadline | `SerialCalled` | `QUEUE_STATE_CONFLICT`, `STALE_VERSION` |
| `SkipSerial` / `RecallSerial` | serial, reason, expectedRowVersion | `queue.manage`; recall limit | CALLED→SKIPPED / SKIPPED→CALLED + count | `SerialSkipped` / `SerialRecalled` | `RECALL_LIMIT_REACHED` |
| `MarkNoShow` | serial, reason | `serial.manage` | → NO_SHOW | `SerialNoShow` | `INVALID_TRANSITION` |
| `CancelSerial` | serial, reason | `serial.manage` / patient context | → CANCELLED; IN_CONSULTATION ⇒ encounter INTERRUPTED (same tx, via `SerialLifecyclePort` + clinical facade) | `SerialCancelled` (+ `EncounterInterrupted`) | `INVALID_TRANSITION` |
| `RescheduleSerial` | serial, target day, slot? | `appointment.write` / patient context | old → RESCHEDULED; new BOOKED serial with `rescheduled_from_serial_id`; appointment chain | `SerialRescheduled`, `SerialIssued`, `AppointmentRescheduled` | `CHAMBER_DAY_CLOSED`, `CAPACITY_EXCEEDED` |
| `ReorderQueue` | day, expectedQueueOrderVersion, orderedSerialIds | `queue.manage` | permute positions of listed serials; version++ | `QueueReordered` | `QUEUE_VERSION_CONFLICT`, `QUEUE_STATE_CONFLICT` |
| `RecordChamberDelay` / `UpdateChamberDayPolicy` | day, expectedQueueOrderVersion, values | `queue.manage` | day fields; version++ | `ChamberDelayRecorded` / `QueuePolicyChanged` | `QUEUE_VERSION_CONFLICT` |
| `CloseChamberDay` | day, expectedRowVersion | `chamber_day.close` | disposition applied to unserved serials | `ChamberDayClosed` (+ per-serial events) | `CHAMBER_DAY_HAS_ACTIVE_CONSULTATION`, `STALE_VERSION` |
| `ExpireRecallDeadlines` (job) | — | system | CALLED past deadline → SKIPPED | `SerialSkipped` (actor SYSTEM) | — |
| `ApplyNoShowPolicy` (job) | — | system | BOOKED/CONFIRMED past window → NO_SHOW | `SerialNoShow` | — |

## 3. Clinical

| Use case | Input | Authorization / validation | Changes | Events | Failures |
|---|---|---|---|---|---|
| `StartEncounter` | serial, expectedRowVersion, mode | `encounter.start`; doctor of chamber; serial CALLED | insert encounter IN_PROGRESS; serial IN_CONSULTATION; draft note row | `EncounterStarted` (+ telemedicine job if remote) | 409 unique `uq_encounters_serial`, `INVALID_TRANSITION` |
| `InterruptEncounter` / `ResumeEncounter` | encounter, reason | `encounter.manage` + asg | status change | `EncounterInterrupted/Resumed` | `INVALID_TRANSITION` |
| `CompleteEncounter` | encounter, expectedRowVersion | `encounter.complete` + asg | encounter COMPLETED; serial COMPLETED | `EncounterCompleted`, `SerialCompleted` → timeline, notifications | `INVALID_TRANSITION` |
| `SaveEncounterNoteDraft` | sections, extensions, expectedRowVersion | `note.write` + asg/scope (nurse: permitted sections only) | update draft row; row_version++ | `EncounterNoteDraftSaved` (not projected) | `STALE_VERSION`, `VALIDATION_FAILED` |
| `SaveEncounterNoteDraftSection` | section, content, mode, source, aiApprovalId? | internal facade (used by approval) + same checks | update one section + `section_sources` | `EncounterNoteDraftSaved` | `STALE_VERSION` |
| `SignEncounterNote` | expectedRowVersion, attestation | `note.sign` + asg (encounter) + doctor role | insert `encounter_note_versions` revision n+1 (chain) | `EncounterNoteSigned` → timeline | `STALE_VERSION` |
| `SignNoteCorrection` | expectedRowVersion, reason | same | new revision with `correction_reason`, `supersedes_revision` | `EncounterNoteSigned` (correction) | `VALIDATION_FAILED` (reason missing) |
| `AddDiagnosis` | display/code, certainty, status, source=`doctor`\|`ai_approved`, aiApprovalId? | `diagnosis.write` + asg; `ai_approved` only callable from `ApproveAISuggestion` | insert diagnosis | `DiagnosisRecorded` → timeline | `FORBIDDEN` |
| `ApproveAISuggestion` | suggestion, expectedRowVersion, approvedTarget, target payload, attestationVersion | `ai.approve` + doctor role + asg (encounter) | lock suggestion; clinical write via note-section/diagnosis use case; insert `ai_approvals`; suggestion APPROVED | `AISuggestionApproved` + clinical event | `FEATURE_DISABLED` (target), `STALE_VERSION`, `AI_DRAFT_CLOSED`, `FORBIDDEN` |

## 4. Prescriptions

| Use case | Input | Authorization / validation | Changes | Events | Failures |
|---|---|---|---|---|---|
| `CreatePrescriptionDraft` | encounter, items | `prescription.write` + asg; encounter IN_PROGRESS/INTERRUPTED/COMPLETED-within-edit-window (`PRESCRIPTION_EDIT_WINDOW_HOURS`, default 24) | insert revision 1 DRAFT + items | `PrescriptionDraftCreated` | 409 open draft exists |
| `EditPrescriptionDraft` | items diff, expectedRowVersion | `prescription.write` + asg | update items; if REVIEWED → back to DRAFT | — | `PRESCRIPTION_NOT_EDITABLE`, `STALE_VERSION` |
| `MarkPrescriptionReviewed` | expectedRowVersion | `prescription.review` (prescribing doctor or nurse with grant) | DRAFT → REVIEWED ("items checked"; **no clinical effect**) | `PrescriptionReviewed` | `INVALID_TRANSITION` |
| `ApprovePrescription` | expectedRowVersion, attestationVersion | `prescription.approve` + doctor + asg (encounter); all item fields valid | DRAFT/REVIEWED → APPROVED; snapshot sha256; if revision > 1: void superseded APPROVED in same tx (void first) | `PrescriptionApproved` (+ `PrescriptionVoided`) → render job, delivery intents, timeline | `STALE_VERSION`, `FORBIDDEN`, `VALIDATION_FAILED` |
| `VoidPrescription` | reason, clinicalReviewerDoctorId? | `prescription.void` per matrix §6 | APPROVED → VOID | `PrescriptionVoided` → timeline, patient notification | `VALIDATION_FAILED` |
| `CreatePrescriptionCorrectionDraft` | source approved prescription | `prescription.write` + asg | new revision n+1 DRAFT with `supersedes_prescription_id`, items copied | `PrescriptionDraftCreated` | 409 open draft exists |
| `RenderPrescription` | prescription | `prescription.render`; APPROVED | render_status QUEUED | `PrescriptionRenderRequested` → `RenderPrescriptionPdf` | `PRESCRIPTION_NOT_APPROVED` |

## 5. Documents, labs, timeline, follow-up, communication, telemedicine

| Use case | Key rules |
|---|---|
| `CreateUploadSession` | category allow-list and size; patient/encounter scope; `documents` CREATED + `upload_sessions` OPEN; adapter `createUploadSession` |
| `UploadPart` / `GetPartUploadTargets` | disk: stream to part file, verify part SHA-256; S3: presigned part URLs (15 min) |
| `FinalizeUpload` | verify parts, total size, full SHA-256 → `document_versions` (scan PENDING), `documents` UPLOADED→SCANNING; job `ScanDocumentVersion` |
| `ScanDocumentVersion` (job) | scanner verdict → AVAILABLE / REJECTED / SCAN_ERROR retry; image re-encode creates derived revision |
| `IssueDownloadToken` / `StreamDownload` | authorization, then 60 s HMAC token bound to tenant/actor/document/revision; stream with `nosniff`, `attachment` |
| `CreateLabReport` | requires `AVAILABLE` document of category `LAB_REPORT` |
| `ProjectTimelineEvent` (job) | idempotent insert; redaction marker rows |
| `CreateFollowUp` / `BookFollowUp` | plan insert; booking via `AppointmentCommandFacade` → appointment + serial (`source=FOLLOW_UP`) |
| `CreateCommunication` / `DeliverCommunication` (job) | consent and preference check; attempt rows; provider call outside tx; fallback only if authorized |
| `CreateTelemedicineSession` / `IssueJoinToken` | remote encounter; one active session; short TTL tokens |

## 6. AI

See `AI-IMPLEMENTATION.md` for:
- `CreateAICredential`, `RevokeAICredential`, `ValidateAICredential` (job);
- `UpdateTenantAIPolicy`, `RecordAIDataUseAcknowledgement`;
- `CreateAINoteDraftJob`, `CreateAIHistorySummaryJob`, `RunAIJob` (job), `CancelAIJob`;
- `OpenAIDraft`, `CloseAIDraft`, `ReviewAISuggestion`, `ApproveAISuggestion` (clinical);
- `RefreshAIModelCatalog`, `ExpireAIDrafts`, `PurgeAIRawOutputs`, `ReencryptAICredentials` (jobs).

**AI services never call clinical write use cases.** Only `ApproveAISuggestion`, owned by `clinical`, creates clinical records from AI content.

## 7. SMS (Stage 3.2, ADR-018)

| Use case | Input | Authorization / validation | Changes | Events / jobs | Failures |
|---|---|---|---|---|---|
| `CreateSmsCredential` | apiKey (write-only), senderId, balanceAlertBdt? | `sms.credentials.manage` | encrypt → `provider_credentials` `PENDING_VALIDATION`; audit (last4 only) | job `ValidateSmsCredential` | `VALIDATION_FAILED`, 409 duplicate fingerprint |
| `ValidateSmsCredential` (job) | credentialId | system | `checkbalance`: balance → `ACTIVE` + snapshot; 1001 → `INVALID` | `SmsBalanceLow` if below threshold | `SMS_CREDENTIAL_INVALID` (recorded) |
| `RevokeSmsCredential` | id, reason | `sms.credentials.manage` | status `REVOKED`, secret tombstoned; queued SMS jobs fall back per COMMUNICATION §6.1 (fail, no silent platform fallback) | audit | — |
| `DeliverCommunication` (job, SMS channel) | communicationId | system; consent/preferences | attempt row; adapter call outside tx; outcome mapping COMMUNICATION §6.2 | `CommunicationStatusChanged` | — |
| `CheckSmsBalance` (job) | — | system, singleton | snapshots; reactivate `SUSPENDED_BALANCE` | `SmsBalanceLow` | — |
| `CreateShortLink` | target type/id, ttl | internal (template rendering) | insert `communication_short_links` | — | — |

## 8. Payments (Stage 3.2, ADR-019; `PAYMENT-IMPLEMENTATION.md`)

| Use case | Input | Authorization / validation | Changes | Events / jobs | Failures |
|---|---|---|---|---|---|
| `SetFeeSchedules` | scope target, fee rows, expectedRowVersion per changed row | `fee.manage` | retire/close open rows + insert (lock open rows) | `FeeScheduleChanged` | `STALE_VERSION`, `VALIDATION_FAILED` (overlap, negative) |
| `CreateMerchantAccount` | ownerType, owner id, mode, feeTypes, storeId + signatureKey (doctor-merchant) | `payment.merchant.manage` + ownership; environment = `AAMARPAY_ENV`; platform opt-in gated | `provider_credentials` + `payment_merchant_accounts` `PENDING_VALIDATION` (or `BLOCKED_BY_GATE`) | job `ValidateMerchantCredential` | `POLICY_BLOCKED`, 409 live owner exists |
| `ValidateMerchantCredential` (job) | accountId | system | Search Transaction with random id → `ACTIVE` / `INVALID` / `UNVERIFIED_UNTIL_FIRST_PAYMENT` | — | — |
| `CreatePaymentIntent` | purpose, businessReference, returnChannel | payer context or `payment.create` | PAYMENT-IMPLEMENTATION §4 | `PaymentIntentCreated` / `PaymentFailed` | `FEE_NOT_CONFIGURED`, `PAYMENT_NOT_REQUIRED`, `PAYMENT_METHOD_UNAVAILABLE`, `PAYMENT_ALREADY_PAID`, `PAYMENT_INTENT_EXPIRED`, `PAYMENT_GATEWAY_REJECTED`, `PAYMENT_GATEWAY_UNAVAILABLE`, `POLICY_BLOCKED` |
| `HandleGatewayReturn` / `HandleGatewayIpn` | raw body, path | public; verification | store redacted event; `PENDING_VERIFICATION`; `VerifyPayment` | per result | never errors to gateway (303 / 200) |
| `VerifyPayment` | intent, trigger | system | PAYMENT-IMPLEMENTATION §5.3; ledger on `PAID` | `PaymentSucceeded` / `PaymentFailed` / `PaymentExpired` / `PaymentCancelled` | — |
| `ReconcilePaymentIntents` (job) | — | system | re-verify, expire | same | — |
| `ConfirmPaidAppointment` (job) | eventId, appointmentId | system | appointment `BOOKED` + serial, or late review | `AppointmentPaymentConfirmed`, `SerialIssued` | — |
| `ReleasePaymentHolds` (job) | — | system | appointment `CANCELLED` (`PAYMENT_NOT_COMPLETED`) | `AppointmentCancelled` | — |
| `WaiveAppointmentPayment` | appointment, reason, expectedRowVersion | `appointment.write` | `BOOKED` + `WAIVED` + serial; cancel open intent | `AppointmentPaymentWaived`, `SerialIssued` | `INVALID_TRANSITION`, `STALE_VERSION` |
| `RequestRefund` / `CompleteRefund` / `CancelRefund` | intent/refund, reason, evidenceRef | `refund.manage` (doctor-merchant) / `platform.refund.manage` | refund rows; intent `REFUND_PENDING`→`REFUNDED`; ledger reversal | `RefundRecorded` (on complete) | `REFUND_NOT_ALLOWED` |
| `ResolvePaymentReview` | intent, HONOR/REFUND, reason | see PAYMENT §8 | `manual_review_status` resolved; booking or refund flow | `PaymentReviewResolved` | `CAPACITY_EXCEEDED` |
| `CreatePayout` / `MarkPayoutPaid` | tenant, doctor, period / transfer ref | platform `payout.manage` | payout + items / `PAID` + ledger | `PayoutRecorded` | `VALIDATION_FAILED` |
| `GenerateSubscriptionInvoices` (job) | — | system | invoices, `OVERDUE`, `PAST_DUE` | `SubscriptionInvoiceIssued` | — |

## 9. Medication catalog (Stage 3.2, ADR-020; `PRESCRIPTION-IMPLEMENTATION.md` §5)

| Use case | Input | Authorization / validation | Changes | Events / jobs | Failures |
|---|---|---|---|---|---|
| `RequestMedicationImport` | datasetVersion, dryRun | platform `medication.import`; production gate (ADR-020 §2) | `medication_dataset_imports` `QUEUED` or `REFUSED` | job `ImportMedicationDataset` | `POLICY_BLOCKED` (`MEDDATA_PRODUCTION_GATES_OPEN`), `MEDDATA_IMPORT_IN_PROGRESS` |
| `ImportMedicationDataset` (job / CLI) | import id or dir | system | checksum + schema verification; batched upserts; deactivation; report | `MedicationDatasetImported` | `MEDDATA_CHECKSUM_MISMATCH`, `MEDDATA_SCHEMA_UNSUPPORTED` (import `FAILED`) |
| `RecordDatasetGateAttestation` | version, gateCode, evidenceRef, summary | platform `medication.import` | append attestation (chain) | audit | 409 already attested |
| `SearchMedications` | q, limit, cursor | `prescription.write` | read + tenant boost | — | `VALIDATION_FAILED` (q < 2 chars) |
| `RecordMedicationUsage` (consumer of `PrescriptionApproved`) | prescription id | system | upsert `medication_usage_stats` for catalog items | — | — |
