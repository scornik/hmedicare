# Event Architecture

**Stage 3.1 rewrite (2026-09-17).** Transport is the database only: outbox → jobs (ADR-015). There is no broker, and no Redis.

**Stage 3.2 update (2026-09-17):** payment, SMS and medication-catalog events and jobs (ADR-018/019/020).

## 1. Event categories

| Category | Example | Storage | Delivery |
|---|---|---|---|
| Domain event | `SerialIssued`, `EncounterCompleted`, `PrescriptionApproved` | `outbox_events` (same tx as change) | Outbox publisher → `jobs` (one job per subscribed handler) |
| Integration request | `CommunicationDeliveryRequested` | `jobs` | Runner → provider adapter |
| Projection | `ProjectTimelineEvent` | `jobs` | Runner → timeline projector |
| Background job | `RenderPrescriptionPdf`, `ScanDocumentVersion`, `RunAIJob`, `ValidateAICredential`, `ValidateSmsCredential`, `ValidateMerchantCredential`, `ConfirmPaidAppointment`, `ImportMedicationDataset` | `jobs` | Runner |
| Maintenance job | `MaintenanceTtlCleanup`, `ExpireRecallDeadlines`, `ApplyNoShowPolicy`, `VerifyAppendOnlyChains`, `RefreshAIModelCatalog`, `PurgeAIRawOutputs`, `ExpireAIDrafts`, `EncryptedDatabaseDump`, `FileBackup`, `DiskUsageCheck`, `CheckSmsBalance`, `ReconcilePaymentIntents`, `ReleasePaymentHolds`, `GenerateSubscriptionInvoices` | `jobs` (scheduled by `MaintenanceScheduler` using `singleton_locks`/`GET_LOCK` + a next-run table in `jobs` idempotency keys `<job>:<window>`) | Runner |
| Audit event | `AI_CREDENTIAL_CREATED`, `QUEUE_REORDERED` | `audit_logs` (same tx, hash-chained) | Not published |

## 2. Envelope

```json
{
  "eventId": "uuidv7",
  "eventName": "SerialIssued",
  "eventVersion": 1,
  "tenantId": "uuidv7|null",
  "aggregateType": "serial",
  "aggregateId": "uuidv7",
  "occurredAt": "2026-09-17T10:00:00.000Z",
  "correlationId": "uuidv7",
  "causationId": "uuidv7|null",
  "actorId": "uuidv7|null",
  "idempotencyKey": "string|null",
  "payload": {}
}
```

- The TypeScript type is `EventEnvelope` in `packages/kernel`. Payload schemas are Zod, versioned per event (`packages/<context>/src/public/events/<event>.v<n>.ts`).
- **Payloads carry ids, statuses and enums only:** no names, phone numbers, clinical text, secrets or provider keys. Stage 3.2 additions: payment events may carry `amount` as a decimal **string** and `currency`; they never carry `tran_id`, `pg_txnid`, store IDs, payment URLs or gateway payloads. SMS events never carry balances, phone numbers or message text. The CI test `event-payload-phi.spec.ts` rejects string fields not on the allow-list (ids, codes, ISO timestamps).
- Consumers tolerate unknown fields and reject unsupported versions with `JOB_PAYLOAD_UNSUPPORTED` (dead letter).

## 3. Outbox → jobs

```text
Command tx: source rows + queue_events/audit + outbox_events(PENDING) -> COMMIT
Runner loop (worker):
  claim outbox_events (status PENDING, ORDER BY occurred_at, FOR UPDATE SKIP LOCKED | conditional update)
  for each event: for each subscribed handler -> INSERT jobs (queue, type, payload{eventId,...ids}, idempotency_key "<eventId>:<handler>")
                  ON DUPLICATE (queue, idempotency_key) -> ignore (already published)
  UPDATE outbox_events SET status=PUBLISHED, published_at   -- same tx
Runner loop: claim jobs -> handler -> complete / retry / dead letter
```

- **Subscriptions** are a static map in `packages/jobs/src/subscriptions.ts`, generated from each context's `public/subscriptions.ts`. It is reviewed in PRs and tested (every event has ≥ 0 declared subscribers; every handler's payload schema is compatible).
- **Delivery** is at-least-once. Handlers are idempotent (ADR-015 §6).
- **Ordering** is guaranteed per aggregate only for handlers that declare `orderedByAggregate: true` (timeline projection). Those jobs use `concurrency_key = <handler>:<aggregateType>:<aggregateId>` with limit 1, and are enqueued in outbox `occurred_at` order.
- **Latency:** in worker mode, publish lag is normally ≤ 2 s. In cron-only mode, up to one cron interval (ADR-015 §7). There is **no** clinical dependency on publish latency.

## 4. Event names (v1)

- **Identity/tenant:** `UserRegistered`, `SessionRevoked`, `MembershipChanged`, `CoverageGranted`, `CoverageRevoked`.
- **Patient:** `PatientCreated`, `PatientUpdated`, `PatientMergeRequested`, `PatientMergeApproved`, `PatientAccountLinked`, `GuardianshipRequested`, `GuardianshipActivated`, `GuardianshipEnded`, `CareTeamMemberAdded`, `CareTeamMemberEnded`, `ConsentGranted`, `ConsentWithdrawn`.
- **Scheduling:** `ChamberDayOpened`, `ChamberDayPaused`, `ChamberDayClosed`, `ChamberDayCancelled`, `AppointmentBooked`, `AppointmentCancelled`, `AppointmentRescheduled`.
- **Queue:** `SerialIssued`, `SerialConfirmed`, `SerialCheckedIn`, `SerialRemoteReady`, `SerialWaiting`, `SerialCalled`, `SerialSkipped`, `SerialRecalled`, `SerialNoShow`, `SerialCancelled`, `SerialRescheduled`, `QueueReordered`, `ChamberDelayRecorded`, `QueuePolicyChanged`, `DuplicateActiveSerialOverridden`.
- **Clinical:** `EncounterStarted`, `EncounterInterrupted`, `EncounterResumed`, `EncounterCompleted`, `EncounterEnteredInError`, `EncounterNoteDraftSaved` (not projected to timeline), `EncounterNoteSigned`, `EncounterNoteAmended` (ADR-024), `SymptomRecorded`, `DiagnosisRecorded`, `DiagnosisStatusChanged`, `DiagnosisVoided` (ADR-024).

  A correction and a withdrawal each carry their own name (ADR-024, resolving C-53): a consumer that ignores a payload flag would render an amendment as an original signature and report no error, which for a clinical record is close to the worst failure available. `DiagnosisStatusChanged` remains for the status moves that are not withdrawals. A prescription correction emits `PrescriptionVoided` then `PrescriptionApproved` and needs no third name, because it genuinely is both.
- **Prescriptions:** `PrescriptionDraftCreated`, `PrescriptionReviewed`, `PrescriptionApproved`, `PrescriptionVoided`, `PrescriptionRenderRequested`, `PrescriptionRendered`, `PrescriptionRenderFailed`.
- **Documents/labs:** `UploadSessionCreated`, `DocumentUploadFinalized`, `DocumentScanCompleted`, `DocumentRejected`, `DocumentRedacted`, `LabReportCreated`, `LabReportReviewed`, `LabResultRecorded`.
- **Follow-up:** `FollowUpPlanCreated`, `FollowUpPlanUpdated`, `FollowUpBooked`.
- **Communication:** `CommunicationCreated`, `CommunicationDeliveryRequested`, `CommunicationStatusChanged`.
- **Telemedicine:** `TelemedicineSessionCreated`, `ParticipantJoined`, `ParticipantLeft`, `TelemedicineSessionEnded`.
- **AI:** `AICredentialCreated`, `AICredentialStatusChanged`, `AICredentialRevoked`, `TenantAIPolicyChanged`, `AIDataUseAcknowledged`, `AIJobCreated`, `AIJobStatusChanged`, `AIDraftCreated`, `AISuggestionReviewed`, `AISuggestionApproved`, `AIDraftClosed`, `AIDraftExpired`.
- **Operations:** `BackupCompleted`, `BackupFailed`, `IntegrityChainBroken`, `DiskUsageThresholdCrossed`.
- **Payments (Stage 3.2):**
  - intents: `PaymentIntentCreated`, `PaymentSucceeded` (`{intentId, purpose, businessType, businessId, amount, currency, merchantMode, late}`), `PaymentFailed`, `PaymentCancelled`, `PaymentExpired`, `PaymentReviewResolved`;
  - refunds and payouts: `RefundRecorded`, `PayoutRecorded`;
  - configuration: `FeeScheduleChanged`, `MerchantAccountStatusChanged`;
  - subscriptions: `SubscriptionInvoiceIssued`, `SubscriptionRenewed`;
  - appointments: `AppointmentPaymentPending`, `AppointmentPaymentConfirmed`, `AppointmentPaymentWaived`.
- **SMS (Stage 3.2):** `SmsBalanceLow` (`{credentialScope, credentialId|null, thresholdCrossed: true}`), `SmsCredentialStatusChanged`.
- **Medication catalog (Stage 3.2):** `MedicationDatasetImported` (`{importId, datasetVersion, status, counts}`), `MedicationDatasetGateAttested`.

**Stage 3.2 subscriptions (handlers):**

| Event | Handler (queue) | Effect |
|---|---|---|
| `PaymentSucceeded` (`APPOINTMENT`) | `ConfirmPaidAppointment` (`payments`) | appointment `BOOKED` + serial, or late review (PAYMENT §7) |
| `PaymentSucceeded` (`SUBSCRIPTION_INVOICE`) | `ApplySubscriptionPayment` (`payments`) | invoice `PAID`, period advanced |
| `PaymentSucceeded`, `RefundRecorded` | `CreateCommunication` (`notifications`) | `payment_received` / refund SMS/in-app per consent |
| `PaymentFailed`/`PaymentCancelled`/`PaymentExpired` (`APPOINTMENT`) | `ReleasePaymentHoldForIntent` (`payments`) | release the hold if no other open intent |
| `SmsBalanceLow` | `NotifyOpsSmsBalance` (`notifications`) | platform alert / tenant admin in-app notice |
| `PrescriptionApproved` | `RecordMedicationUsage` (`maintenance`) | `medication_usage_stats` |
| `MedicationDatasetImported` | none (audit + metrics only) | — |

**No payment or SMS handler resolves a clinical write use case** (DI container test).

## 5. Timeline projection

- The projector maps committed events to `timeline_events` rows. The unique key `(tenant_id, source_event_id, event_type, projection_version)` makes projection idempotent. Each row stores `source_type`/`source_id` so readers resolve the **source record**.
- **Redaction** (`DocumentRedacted`, a clinical entered-in-error) **inserts** a `REDACTED` marker row referencing the original timeline row. It never updates rows (append-only, hash-chained; `DATABASE-IMPLEMENTATION.md` §4.3).
- **Checkpoints:** `projection_checkpoints` per tenant records the last projected outbox `occurred_at` and event id. AI retrieval uses it to detect a stale projection (`AI-IMPLEMENTATION.md` §8).
- **Rebuild:**
  1. write a new `projection_version` into the same table, from retained outbox events (30 days) **plus** a source-table backfill job for older history;
  2. compare counts per patient;
  3. flip `TIMELINE_PROJECTION_VERSION` config.
  
  Old-version rows remain, and readers filter by the active version.

## 6. Dead letters and operations

- **Replay.** Failed jobs go to `dead_letters` (ADR-015). Replay is `POST /internal/ops/dead-letters/{id}/replay` (`ops.jobs.replay`, platform operator, audited). It creates a new job with a new id, and `idempotency_key = <original>:replay:<n>`.
- **Provider webhooks** are deduplicated by `provider_webhook_events (provider_adapter, provider_event_id)` before mapping.
- **Metrics:** outbox publish lag, job lag per queue, dead-letter count per type, and handler error class counts (`OBSERVABILITY.md`).
