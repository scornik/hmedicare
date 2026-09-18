# Module Boundaries

**Stage 3.1 rewrite (2026-09-17).** Package layout and dependency rules: `REPOSITORY-STRUCTURE.md`.

**Stage 3.2 update (2026-09-17):** `payments` replaces the `billing` placeholder; new `provider-credentials` and `secrets` packages; platform operators; SMS and catalog tables; one new transactional facade (audit C-24).

## 1. Ownership map

| Context package | Owns (tables) | Public surface (`src/public`) | Nest modules | Forbidden knowledge |
|---|---|---|---|---|
| `identity-access` | users, sessions, refresh_tokens, otp_challenges, password_reset_tokens, email_verification_tokens, push_devices, platform_operators (Stage 3.2) | `ActorContextResolver`, `PolicyEngine`, `AssignmentPolicy`, `PatientContextResolver`, `RolePermissions`, auth events | `IdentityWriteModule`, `IdentityReadModule`, `IdentityWorkerModule` (TTL cleanup) | Clinical content |
| `tenant-org` | tenants, tenant_memberships, clinics, doctor_profiles, staff_profiles, doctor_coverages | `TenantReadPort`, `MembershipReadPort`, `CoverageReadPort` | Write/Read | Passwords, encounter text |
| `patient` | patients, patient_contacts, patient_identifiers, patient_consents, patient_merge_cases, patient_accounts, patient_guardianships, care_team_members | `PatientReadPort`, `ConsentReadPort`, `GuardianshipReadPort`, `CareTeamReadPort`, `PatientIdentifierDictionaryPort` (for AI minimization; returns values only in-process) | Write/Read | Provider SDKs, appointment symptoms |
| `scheduling` | chambers, doctor_schedule_rules, chamber_days (identity/status/policy), appointment_slots, appointments | `ChamberReadPort`, `ChamberDayReadPort`, `AppointmentCommandFacade` (used by follow-up) | Write/Read/Worker (day reminders) | Live queue position |
| `queue` | serials, check_ins, queue_events; `chamber_days.next_serial_number`/`queue_order_version` columns (the only writer of those two columns) | `SerialReadPort`, `QueueReadPort`, `SerialLifecyclePort` (used by clinical: markInConsultation/markCompleted/cancelWithInterruption inside a shared tx) | Write/Read/Worker (no-show, recall deadline) | Clinical note/prescription content |
| `clinical` | encounters, encounter_participants, encounter_notes, encounter_note_versions, symptom_observations, diagnoses; **`ApproveAISuggestion` use case** | `EncounterReadPort`, `ClinicalHistoryReadPort` (for AI retrieval, timeline) | Write/Read | Delivery provider mechanics, AI provider calls |
| `prescriptions` | medications, medication_generics, medication_generic_links, medication_manufacturers, medication_aliases, medication_price_observations, medication_usage_stats, medication_dataset_imports, medication_dataset_gate_attestations, patient_medications, prescriptions, prescription_items | `PrescriptionReadPort`, `MedicationSearchPort` | Write/Read/Worker (`RenderPrescriptionPdf`, `ImportMedicationDataset`, `RecordMedicationUsage`) | AI inference, provider SDKs, dosing text from the catalog |
| `laboratory-documents` | documents, document_versions, upload_sessions, upload_session_parts, lab_reports, lab_results | `DocumentReadPort`, `DocumentAccessPort`, `ObjectStoragePort`/`MalwareScanPort` (declared here) | Write/Read/Worker (scan, expire uploads) | Identity merge decisions |
| `timeline` | timeline_events, projection_checkpoints | `TimelineReadPort` | Read/Worker (projection) | Direct clinical mutation |
| `follow-up` | follow_up_plans, follow_up_tasks | `FollowUpReadPort` | Write/Read/Worker (reminders) | Provider delivery implementation |
| `communication` | communications, communication_attempts, communication_preferences, provider_webhook_events, communication_short_links, sms_balance_snapshots | `CommunicationCommandFacade` (create intent), `SmsOtpDelivery` (implements identity-access `OtpDeliveryPort`), `SmsProvider` port (declared here) | Write/Read/Worker (delivery, `CheckSmsBalance`, `ValidateSmsCredential`) | Clinical approval, clinical content in SMS |
| `telemedicine` | telemedicine_sessions, telemedicine_participants | `TelemedicineReadPort`; `TelemedicineProvider` port | Write/Read | Appointment booking decisions |
| `ai` | tenant_ai_policies, tenant_ai_policy_events, ai_data_use_acknowledgements, ai_provider_credentials, ai_credential_fallbacks, ai_model_catalog, ai_usage_counters, ai_usage_ledger, ai_jobs, ai_transcripts, ai_drafts, ai_suggestions, ai_approvals (insert performed within clinical's approval tx through `AiApprovalRecorderPort`) | `AiSuggestionReviewPort` (load/lock/mark approved; record approval), `AiPolicyReadPort`, `AIProvider` port | Write/Read/Worker (`AiWorkerModule`: validate credential, run job, refresh catalog, expire drafts, purge raw outputs, re-encrypt) | Clinical write commands (dependency rule `ai-no-clinical-writes`) |
| `audit` | audit_logs, integrity_chain_checkpoints | `AuditPort` (append in caller tx), `AuditReadPort`, `ChainAppender` | Read/Worker (`VerifyAppendOnlyChains`) | Business state mutation |
| `jobs` (platform) | jobs, dead_letters, job_concurrency_leases, singleton_locks, outbox_events (publisher), rate_limit_counters, idempotency_records | `JobPort`, `OutboxPort`, `IdempotencyPort`, `RateLimiterPort`, `JobHandlerRegistry` | Runner module | Business rules |
| `payments` (Stage 3.2) | tenant_payment_settings, payment_merchant_accounts, fee_schedules, payment_intents, payment_attempts, payment_gateway_events, payment_verifications, ledger_entries, refunds, payouts, payout_items, subscription_plans, subscriptions, subscription_invoices | `PaymentReadPort` (informational status), `FeeQuotePort` (booking UI), `PaymentGatewayPort` (declared here) | Write/Read/Worker (`ReconcilePaymentIntents`, `ConfirmPaidAppointment`, `ReleasePaymentHolds`, `GenerateSubscriptionInvoices`, `ValidateMerchantCredential`) | **Clinical data of any kind** (rule `payments-no-clinical`); payment status never gates clinical actions |
| `provider-credentials` (Stage 3.2) | provider_credentials | `ProviderCredentialVault` (`create`, `validate` hooks, `revoke`, `resolveForAdapter` returning an in-process handle) | Write/Read | Business rules of SMS/payments |
| `secrets` (platform, Stage 3.2) | platform_gate_decisions (read) | `SecretEnvelopePort`, `GateDecisionReader` | — | Tenant data |

## 2. Application service rules

- **Controllers** (in `apps/api`) translate HTTP to a request DTO (nestjs-zod) and invoke exactly one use case. No business logic.
- **Use cases:**
  - own authorization invocation (`PolicyEngine`, `AssignmentPolicy`, `PatientContextResolver`);
  - own the transaction boundary (`withTransaction`);
  - call domain validation;
  - create outbox events and audit entries in the same transaction;
  - enforce idempotency (`IdempotencyPort`).
- **Repositories** take `TenantContext` and ids. No unscoped `findById` exists for tenant data (lint rule `hmedic/tenant-scoped-repo` checks method signatures).
- **Cross-context writes inside one transaction** are allowed only through explicit `public/` facades that accept an outer transaction handle:
  - `queue.SerialLifecyclePort` used by `clinical.StartEncounter`, `CompleteEncounter` and `CancelSerial` interruption;
  - `ai.AiSuggestionReviewPort` / `AiApprovalRecorderPort` used by `clinical.ApproveAISuggestion`;
  - `scheduling.AppointmentCommandFacade` used by `follow-up.CreateFollowUp`, `queue.RescheduleSerial`, and (Stage 3.2, audit C-24) `payments.ConfirmPaidAppointment` / `WaiveAppointmentPayment` / `ReleasePaymentHolds` (`confirmPaidBooking`, `releasePaymentHold`, `waivePayment`, each issuing or cancelling through the queue facade within the payments transaction).
  
  They are listed here exhaustively. Adding one requires an audit row.
- **Workers** invoke handlers from `*WorkerModule` only. Handlers may update the operational or side-effect state of their own context (render status, scan status, delivery attempts, projection rows, AI job/draft rows, payment intents, ledger, catalog import rows). They **never** create or approve clinical records (notes, diagnoses, prescriptions, follow-ups).
- **Provider adapters** implement ports and are registered in the composition root by configuration (`AI_ENABLED_PROVIDER_CODES`, `STORAGE_ADAPTER`, `SMS_PROVIDER`, …).

## 3. Shared code rules

- `kernel`: types and value objects only.
- `contracts`: API schemas and generated artifacts; consumed by apps, web and the mobile generator; imports no context internals.
- `localization`: phone, locale and search normalization; no medication truth.
- `observability`: redaction, correlation and metrics; no PHI business logic. The redaction rules include provider key patterns (`OBSERVABILITY.md` §3).
- `database`: Prisma client, migrations, transaction, lock and claim helpers; no authorization decisions.
- `jobs`: runner mechanics; no business rules.
- `web-ui`: visual primitives; no queue or patient rules.

## 4. Cross-context interaction preference

1. **Public read port** for synchronous invariant-dependent reads.
2. **Explicit transactional facade** (§2 list) when atomicity across contexts is required.
3. **Outbox event → job** for after-commit side effects.
4. **Read model** (timeline) for history retrieval.

A clinical module never queries communication provider tables. A provider webhook never mutates clinical rows. AI never calls clinical write commands.
