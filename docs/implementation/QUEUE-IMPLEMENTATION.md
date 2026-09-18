# Queue Implementation Contract

**Stage 3.1 rewrite (2026-09-17).** It completes the serial state machine (C-07), splits chamber-day versioning (C-04), enforces duplicate active serials in the database (C-08), and applies MariaDB locking (ADR-014). Concurrency diagrams and tests: `QUEUE-CONCURRENCY-DESIGN.md`.

## 1. Commands

Every command carries `tenantId`, `actor`, `correlationId`, `idempotencyKey` (required on all POSTs) and the relevant expected version.

| Command | Route | Expected version | Permission |
|---|---|---|---|
| `OpenChamberDay` / `PauseChamberDay` / `CloseChamberDay` | `POST /chamber-days/{id}/open` · `/pause` · `/close` | `expectedRowVersion` (chamber day) | `schedule.manage` / `chamber_day.close` |
| `RecordChamberDelay` | `POST /chamber-days/{id}/delay` | `expectedQueueOrderVersion` | `queue.manage` |
| `UpdateChamberDayPolicy` | `PUT /chamber-days/{id}/queue-policy` | `expectedQueueOrderVersion` | `queue.manage` |
| `ReorderQueue` | `POST /chamber-days/{id}/reorder` | `expectedQueueOrderVersion` | `queue.manage` |
| `IssueAppointmentSerial` | internal to `CreateAppointment` / `POST /appointments/{id}/serial` | — | `serial.write` or patient context `MANAGE_SERIALS` |
| `IssueWalkInSerial` | `POST /chamber-days/{id}/walk-ins` | — | `serial.write` |
| `ConfirmSerial` | `POST /serials/{id}/confirm` | `expectedRowVersion` | `serial.manage` or patient context |
| `CheckInSerial` | `POST /serials/{id}/check-in` | `expectedRowVersion` | `serial.manage` or patient context (remote) |
| `MarkRemoteReady` | `POST /serials/{id}/remote-ready` | `expectedRowVersion` | patient context `MANAGE_SERIALS` or `serial.manage` |
| `MarkWaiting` | `POST /serials/{id}/mark-waiting` | `expectedRowVersion` | `serial.manage` (only when policy `waitingRequiresConfirmation=true`) |
| `CallSerial` | `POST /serials/{id}/call` | `expectedRowVersion` | `queue.call` |
| `SkipSerial` | `POST /serials/{id}/skip` | `expectedRowVersion` | `queue.manage` |
| `RecallSerial` | `POST /serials/{id}/recall` | `expectedRowVersion` | `queue.manage` |
| `MarkNoShow` | `POST /serials/{id}/no-show` | `expectedRowVersion` | `serial.manage` |
| `CancelSerial` | `POST /serials/{id}/cancel` | `expectedRowVersion` | `serial.manage` or patient context (only `BOOKED`/`CONFIRMED`) |
| `RescheduleSerial` | `POST /serials/{id}/reschedule` (body: `targetChamberDayId`, optional `targetSlotId`) | `expectedRowVersion` | `appointment.write` or patient context `BOOK_APPOINTMENTS` |
| `OverrideDuplicateActiveSerial` | flag on issue commands: `duplicateOverride: {reason}` | — | role listed in policy `duplicateOverrideRoles` |
| `ExpireRecallDeadlines` | job (`queue` queue, every minute via runner) | — | system |
| `ApplyNoShowPolicy` | job (every 5 min) | — | system |
| `StartEncounter` | `POST /serials/{id}/encounter` (clinical) | `expectedRowVersion` | `encounter.start` |
| `InterruptEncounter` / `CompleteEncounter` | `POST /encounters/{id}/interrupt` · `/complete` | encounter `expectedRowVersion` | `encounter.manage` / `encounter.complete` |

**Stage 3.2 note (ADR-019).**
- A prepaid booking creates an appointment in `PENDING_PAYMENT` **without a serial**. The serial is issued by `IssueAppointmentSerial` (same allocation rules, §5.2) only when `ConfirmPaidAppointment` or `WaiveAppointmentPayment` runs.
- Payment status is never a precondition for any serial transition in §3.
- Walk-ins never require payment.

## 2. Queue policy (per chamber day, snapshot of chamber default)

`chamber_days.queue_policy` is `json:QueuePolicy`. Every value is a **documented default, not a clinical rule**, and can be changed by chamber configuration.

| Field | Default | Meaning |
|---|---|---|
| `recallLimit` | 2 | Max `SKIPPED → CALLED` recalls per serial |
| `recallDeadlineMinutes` | 5 | `CALLED` serial with no encounter start becomes `SKIPPED` after this (if `autoSkipOnRecallDeadline`) |
| `autoSkipOnRecallDeadline` | true | |
| `noShowAfterMinutes` | 120 | `BOOKED`/`CONFIRMED` not checked in this long after slot start, or chamber-day local start when there is no slot, becomes `NO_SHOW` (if `autoNoShowEnabled`) |
| `autoNoShowEnabled` | true | |
| `waitingRequiresConfirmation` | false | If true, check-in leaves the serial `CHECKED_IN` until staff run `MarkWaiting` (triage/payment confirmation) |
| `lateArrivalGraceMinutes` | 15 | Check-in later than slot start + grace, or after a higher serial number was already called, is a late arrival |
| `lateArrivalPlacement` | `APPEND` | `APPEND` (end of queue) or `BY_SERIAL_NUMBER` (insert among waiting serials by serial number) |
| `allowRemoteCallWithoutReady` | false | Staff may call a remote serial without `remote_ready` only with an audited override reason |
| `receptionistMayCall` | false | Adds `queue.call` for receptionists in this chamber |
| `duplicateOverrideRoles` | `["clinic_admin","receptionist"]` | Roles allowed to create a second active serial for the same patient/day with a reason |
| `dayCloseDisposition` | `{ "BOOKED":"NO_SHOW", "CONFIRMED":"NO_SHOW", "CHECKED_IN":"CANCELLED", "WAITING":"CANCELLED", "CALLED":"CANCELLED", "SKIPPED":"NO_SHOW" }` | Status applied to unserved serials at close (cancel reason `DAY_CLOSED`) |
| `capacity` | null | Max non-cancelled serials; null = unlimited |

## 3. Serial state machine

Persisted `serials.status`: `BOOKED`, `CONFIRMED`, `CHECKED_IN`, `WAITING`, `CALLED`, `IN_CONSULTATION`, `SKIPPED`, `NO_SHOW`, `CANCELLED`, `RESCHEDULED`, `COMPLETED`.
- **Terminal:** `NO_SHOW`, `CANCELLED`, `RESCHEDULED`, `COMPLETED`.
- **Queue-active** (have `queue_position`): `CHECKED_IN`, `WAITING`, `CALLED`, `IN_CONSULTATION`, `SKIPPED`.
- **Duplicate-guarded (non-terminal)**: `BOOKED`, `CONFIRMED`, `CHECKED_IN`, `WAITING`, `CALLED`, `SKIPPED`, `IN_CONSULTATION`.
- `RECALLED` is a `queue_events.event_type`, not a status.

### 3.1 Initial states

| Source | Initial transitions (one transaction) | Queue events |
|---|---|---|
| Advance booking | → `BOOKED` | `SERIAL_ISSUED` |
| Walk-in, default policy | → `CHECKED_IN` → `WAITING` | `SERIAL_ISSUED`, `CHECKED_IN`, `WAITING` |
| Walk-in, `waitingRequiresConfirmation=true` | → `CHECKED_IN` | `SERIAL_ISSUED`, `CHECKED_IN` |
| Reschedule target | → `BOOKED` on target day with `rescheduled_from_serial_id` | `SERIAL_ISSUED` (details: `rescheduledFrom`) |
| Follow-up booking | → `BOOKED` (`source=FOLLOW_UP`) | `SERIAL_ISSUED` |

### 3.2 Transition table (complete)

| From | To | Trigger | Condition | Side effects in same transaction |
|---|---|---|---|---|
| `BOOKED` | `CONFIRMED` | `ConfirmSerial` (staff or patient) | day not `CLOSED`/`CANCELLED` | event `CONFIRMED` |
| `BOOKED`/`CONFIRMED` | `CHECKED_IN` | `CheckInSerial` | day `OPEN` (or `SCHEDULED` with early check-in allowed on the local date); remote serials need `method=REMOTE_READY` or staff | `check_ins` row; event `CHECKED_IN`; late arrival computed |
| `CHECKED_IN` | `WAITING` | **Automatic** inside `CheckInSerial` when `waitingRequiresConfirmation=false`; otherwise `MarkWaiting` (staff) | — | assign `queue_position` (§4); event `WAITING` |
| `BOOKED`/`CONFIRMED` | `NO_SHOW` | `ApplyNoShowPolicy` job, or `MarkNoShow` (staff) | job: `now > slot_start (or day local start) + noShowAfterMinutes` and not checked in; manual: any time after day local start | event `NO_SHOW` (actor SYSTEM or user) |
| `CHECKED_IN`/`WAITING` | `CALLED` | `CallSerial` | remote: `remote_ready` or audited override; `WAITING` required unless policy `waitingRequiresConfirmation=true` and staff call directly (override reason) | `called_at`; `recall_deadline_at = now + recallDeadlineMinutes`; event `CALLED` |
| `CALLED` | `IN_CONSULTATION` | `StartEncounter` | doctor assigned to chamber; no non-error encounter exists | insert `encounters` (`IN_PROGRESS`); `serials.encounter_id`; event `CONSULTATION_STARTED` |
| `CALLED` | `SKIPPED` | `SkipSerial` (manual, reason), or `ExpireRecallDeadlines` job when `now > recall_deadline_at` and `autoSkipOnRecallDeadline` | — | event `SKIPPED` |
| `SKIPPED` | `CALLED` | `RecallSerial` | `recall_count < recallLimit` → else `RECALL_LIMIT_REACHED` | `recall_count+1`; new `recall_deadline_at`; event `RECALLED` then `CALLED` |
| `CHECKED_IN`/`WAITING`/`CALLED`/`SKIPPED` | `NO_SHOW` | `MarkNoShow` (staff, reason); day close disposition | — | event `NO_SHOW`; `queue_position` kept for history |
| `IN_CONSULTATION` | `COMPLETED` | `CompleteEncounter` | encounter moves to `COMPLETED` in the same transaction | event `COMPLETED` |
| `IN_CONSULTATION` | `CANCELLED` | `CancelSerial` (staff/doctor, exceptional reason) | **encounter moves to `INTERRUPTED` in the same transaction** (`interruption_reason=SERIAL_CANCELLED`); telemedicine session (if any) → `ENDED` | events `CANCELLED`; outbox `EncounterInterrupted` |
| `BOOKED`/`CONFIRMED`/`CHECKED_IN`/`WAITING`/`CALLED`/`SKIPPED` | `CANCELLED` | `CancelSerial` (staff; patient only from `BOOKED`/`CONFIRMED`) or day close disposition | reason required | event `CANCELLED`; appointment `CANCELLED` if linked and not rescheduled |
| `BOOKED`/`CONFIRMED` | `RESCHEDULED` | `RescheduleSerial` | target day exists, same doctor/chamber or permitted chamber, not closed; capacity | **terminal for the old serial**; in the same transaction issue a **new** `BOOKED` serial on the target day with `rescheduled_from_serial_id`; old `rescheduled_to_serial_id` set; appointment `RESCHEDULED` + new appointment with `rescheduled_from_appointment_id`; events on both days (target day locked in id order: lock both chamber days ordered by id) |
| any terminal | any | — | rejected `INVALID_TRANSITION` | — |

**Encounter linkage rules:**
- An encounter in `INTERRUPTED` can be resumed (`POST /encounters/{id}/resume`) only while its serial is `IN_CONSULTATION`.
- If the serial was cancelled, the encounter stays `INTERRUPTED` and can be completed for documentation (`CompleteEncounter` with `completion_reason=DOCUMENTATION_AFTER_CANCEL`). The serial stays `CANCELLED`.
- `COMPLETED` serials always have `encounter_id`.

### 3.3 Chamber day states

`SCHEDULED → OPEN → PAUSED ↔ OPEN → CLOSED`; `SCHEDULED/OPEN/PAUSED → CANCELLED`.
- **Close.** `CloseChamberDay` is rejected while any serial is `IN_CONSULTATION` (`CHAMBER_DAY_HAS_ACTIVE_CONSULTATION`). Otherwise it applies `dayCloseDisposition` to every non-terminal serial in one transaction (the day lock is held; batched inserts of events), sets `closed_at`, and bumps `row_version`.
- **Cancel.** Cancelling a day cancels all non-terminal serials with reason `DAY_CANCELLED` and creates communication intents.

## 4. Positions and patient-facing view

### 4.1 `queue_position` assignment

- Assigned **when the serial enters `WAITING`** (or `CHECKED_IN` when `waitingRequiresConfirmation=true`), under the chamber-day lock.
- **New walk-in and on-time check-in:** `queue_position = MAX(queue_position of queue-active serials on the day) + 1` (append).
- **Late arrival:**
  - `APPEND` (default): as above.
  - `BY_SERIAL_NUMBER`: position = just after the last queue-active serial whose `serial_number` is lower. The positions of serials after it shift +1 in the same transaction (affected rows locked in id order). This bumps `queue_order_version`, because it reorders others.
- `CALLED`, `IN_CONSULTATION` and `SKIPPED` keep their position for history. "People ahead" counts only `CHECKED_IN`/`WAITING` with a lower position.
- **Reorder** permutes positions among the serials listed in the request (§5.3).

### 4.2 Patient-facing view (`GET /serials/{id}` in patient context, `GET /me/serials`)

| Serial status | Shown to patient |
|---|---|
| `BOOKED`/`CONFIRMED` | **serial number** and **estimated position** = count of non-terminal serials on the day with a lower serial number that are not yet `COMPLETED`/`CANCELLED`/`NO_SHOW`/`RESCHEDULED`, labeled "estimate", plus day status, expected delay and `asOf`. Not a queue position |
| `CHECKED_IN`/`WAITING` | `peopleAhead` (count of `CHECKED_IN`/`WAITING` with lower `queue_position`), expected delay, `asOf` |
| `CALLED` | "You are being called" plus recall deadline |
| `SKIPPED` | "You were skipped — please contact reception" plus whether recall remains |
| Terminal | status only |

Never shown: other patients' names, serial statuses, reasons or care modes.

## 5. Transactions

### 5.1 Lock ordering (deadlock prevention)

Every queue mutation acquires locks in this order:
1. `chamber_days` row(s), by id ascending;
2. `serials` rows, by id ascending;
3. `encounters` row (if any);
4. the `integrity_chain_checkpoints` row for `queue:chamber_day:<id>`.

All inside `withTransaction({ isolation: 'ReadCommitted', timeoutMs: 5000, retry on 1205/1213 up to DB_TX_RETRY_MAX })`. Holding the day lock for single-serial transitions serializes queue writes per chamber day. That is deliberate: it removes cross-command deadlocks, and transactions stay short (no provider calls inside).

### 5.2 Serial allocation (`IssueWalkInSerial` / `IssueAppointmentSerial`)

1. Begin READ COMMITTED transaction.
2. `idempotency_records` insert `IN_PROGRESS` for `(tenant_scope, scope, idem_key)`:
   - duplicate key with same `request_hash` and `COMPLETED` → return snapshot (`replayed=true`);
   - `IN_PROGRESS` → `IDEMPOTENCY_IN_PROGRESS`;
   - different hash → `IDEMPOTENCY_KEY_REUSED`.
3. `lockRow('chamber_days', dayId, tenantId)`. Validate status (`SCHEDULED`/`OPEN`/`PAUSED`; walk-ins require `OPEN`/`PAUSED`), capacity, actor permission, and patient/appointment belonging to the tenant (composite FKs back this up).
4. `n = next_serial_number`; `UPDATE chamber_days SET next_serial_number = n + 1` (**does not** touch `queue_order_version` or `row_version`).
5. Insert `serials` (`serial_number=n`, initial state per §3.1, `queue_position` for walk-ins). **Unique violation `uq_serials_active_patient_day` → `DUPLICATE_ACTIVE_SERIAL`** (409, with the existing serial id if the actor may read it). With `duplicateOverride`, the row is inserted with `duplicate_override=1` and a reason, plus a `DUPLICATE_OVERRIDE` event and an audit event.
6. Insert `queue_events` (chain-sequenced), `audit_logs`, and outbox `SerialIssued` (plus `SerialCheckedIn`/`SerialWaiting` for walk-ins).
7. Update the idempotency record → `COMPLETED` with the response snapshot.
8. Commit.

On 1205/1213: retry the whole transaction (steps 1–8) with jitter up to `DB_TX_RETRY_MAX`, then `QUEUE_BUSY` (503 retryable, `Retry-After: 1`). The client retries with the **same** idempotency key.

### 5.3 Reorder (`ReorderQueue`)

- **Request:** `{ expectedQueueOrderVersion, orderedSerialIds: string[] }`. The list names the serials to reposition, in desired order; it need not include every active serial.
- **Steps:**
  1. Idempotency.
  2. Lock the day; if `queue_order_version != expected` → **`QUEUE_VERSION_CONFLICT`** (409, returns current order and version).
  3. Lock the listed serials in id order; every listed serial must be `CHECKED_IN`/`WAITING` → else `QUEUE_STATE_CONFLICT`.
  4. Take the multiset of their current positions, sort it ascending, and assign it to the ids in the requested order.
  5. Serials not in the list keep their positions.
  6. Insert one `QUEUE_REORDERED` event (details: `before`/`after` arrays).
  7. `queue_order_version + 1`.
  8. Commit.
- **A concurrent walk-in does not invalidate the reorder.** It appends a new position greater than all existing ones and does not change `queue_order_version`, so the reorder succeeds and the new serial stays at the end.

### 5.4 Single-serial transitions (call/skip/recall/no-show/cancel/check-in/mark-waiting/confirm)

1. Idempotency.
2. Lock the day, then the serial.
3. Check `expectedRowVersion == row_version` → else `STALE_VERSION` (409, current serial DTO).
4. Validate the edge in the transition table (code table `SERIAL_TRANSITIONS`, unit-tested exhaustively) → else `INVALID_TRANSITION` or, if the state changed since the client's view, `QUEUE_STATE_CONFLICT`.
5. Apply side effects.
6. `row_version + 1`.
7. Write events, audit and outbox.
8. Commit.

Notification intents are created by outbox handlers **after** commit (ADR-015).

### 5.5 Delay and policy

`RecordChamberDelay {expectedQueueOrderVersion, delayMinutes, reasonCode}`: locks the day, sets `expected_delay_minutes`, inserts `DELAY_RECORDED`, bumps `queue_order_version`, writes outbox `ChamberDelayRecorded` (notifications). Historical timestamps are never changed. `UpdateChamberDayPolicy` follows the same pattern (`POLICY_CHANGED`).

### 5.6 Day boundary

- The chamber day is identified by `chamber_days.local_date` + `timezone`.
- Policy checks convert `now()` (UTC) into the chamber timezone with `Temporal`/`@js-temporal/polyfill` (pinned), or `Intl` for formatting.
- Serial allocation never uses UTC date truncation.
- Jobs `ApplyNoShowPolicy` and `ExpireRecallDeadlines` compute cut-offs in chamber local time and compare against UTC `DATETIME(3)` values.
- A chamber day never closes automatically in MVP. A daily reminder job notifies staff of open days 2 h after `local_end_time`.

## 6. Failure cases

| Case | Behavior |
|---|---|
| Server commits, client times out | Client retries with the same key → snapshot replay, same serial |
| Client repeats without key | 400 `IDEMPOTENCY_KEY_REQUIRED` (all queue POSTs require a key) |
| Same key, different body | 422 `IDEMPOTENCY_KEY_REUSED` |
| Lock wait / deadlock | Retries, then 503 `QUEUE_BUSY` + `Retry-After` |
| Stale serial version | 409 `STALE_VERSION` with current DTO |
| Reorder with stale day order version | 409 `QUEUE_VERSION_CONFLICT` with current order |
| Duplicate active serial | 409 `DUPLICATE_ACTIVE_SERIAL` (database-enforced) |
| Worker down | Queue state is still correct; notifications lag (job-lag metric); clients poll |
| Process idle-stopped (Hostinger) | Next request cold-starts; no queue state lives in memory |

## 7. Acceptance tests

- `SERIAL_TRANSITIONS` table test: every (from, command) pair is either in §3.2 or rejected.
- Walk-in default policy produces `CHECKED_IN` then `WAITING` with 3 events in one transaction. With `waitingRequiresConfirmation=true` it stops at `CHECKED_IN`.
- `IN_CONSULTATION → CANCELLED` moves the encounter to `INTERRUPTED` atomically, or rolls back both.
- Reschedule leaves the old serial `RESCHEDULED` (terminal) and creates a new `BOOKED` serial with `rescheduled_from_serial_id`. It is idempotent.
- `ApplyNoShowPolicy` and `ExpireRecallDeadlines` respect chamber local time across UTC midnight.
- Recall limit enforced; `RECALLED` event recorded; history preserved.
- Duplicate active serial is rejected by the database even when the application check is bypassed (direct repository insert test); override with reason succeeds and is audited.
- Patient view shows the estimated position for `BOOKED`, people ahead for `WAITING`, and never other patients' data.
- Late arrival `APPEND` vs `BY_SERIAL_NUMBER` placement; the latter bumps `queue_order_version`.
- Concurrency tests in `QUEUE-CONCURRENCY-DESIGN.md` §7.
