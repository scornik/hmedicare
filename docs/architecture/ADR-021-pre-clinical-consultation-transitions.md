# ADR-021 — Pre-clinical consultation transitions (Stage 5 queue without encounters)

**Status:** Accepted (2026-09-19, Stage 5)
**Resolves:** audit row C-42.
**Supersedes:** nothing. It is **retired by Stage 6** (CLIN-001…003), as described under "Exit".

## Context

- `QUEUE-IMPLEMENTATION.md` §3.2 moves a serial `CALLED → IN_CONSULTATION` only through `StartEncounter`, and `IN_CONSULTATION → COMPLETED` only through `CompleteEncounter`. Both are clinical use cases that insert or update `encounters` rows (migration 0007).
- `DATABASE-IMPLEMENTATION.md` §4.4 requires every `COMPLETED` serial to have an `encounter_id`.
- The Stage 5 build prompt puts encounters, notes and every other clinical module **out of scope**. It still requires the complete operational loop `called → in consultation → completed`, and a staff user must be able to run a full chamber day from a clean seed.
- Stage 5 therefore cannot satisfy both rules. Either it builds part of the clinical context (out of scope), or the queue has no way to finish a consultation.

## Decision

1. **Two interim queue commands**, owned by the `queue` context and routed under the serial resource:

   | Command | Route | Edge | Permission | Expected version |
   |---|---|---|---|---|
   | `StartConsultation` | `POST /serials/{id}/start-consultation` | `CALLED → IN_CONSULTATION` | `encounter.start` + doctor of the chamber (or the solo owner doctor) | `expectedRowVersion` |
   | `CompleteConsultation` | `POST /serials/{id}/complete` | `IN_CONSULTATION → COMPLETED` | `encounter.complete` + doctor of the chamber | `expectedRowVersion` |

   They reuse the permissions that Stage 6 routes will require, so the role matrix does not change.
2. **Same transaction rules** as every queue command (QUEUE-IMPLEMENTATION §5.4): lock the day, then the serial; check `row_version`; validate the edge in `SERIAL_TRANSITIONS`; write `queue_events` (`CONSULTATION_STARTED` / `COMPLETED`), audit and outbox (`SerialConsultationStarted`, `SerialCompleted`).
3. **`encounter_id` stays NULL** on serials completed through these commands. `serials.consultation_mode` is **not** added. The interim status is visible in audit (`action=SERIAL_CONSULTATION_*`, `metadata.preClinical=true`) and in the event payload (`preClinical: true`).
4. **Invariant change, time-boxed.** DATABASE §4.4 "Serial `COMPLETED` requires `encounter_id`" becomes: required for serials completed **through `CompleteEncounter`**. Serials completed before Stage 6 keep `encounter_id` NULL forever; Stage 6 never backfills fake encounters.
5. **`IN_CONSULTATION → CANCELLED`** (QUEUE §3.2) is allowed with the documented reason. With no encounter row there is nothing to interrupt, so the `EncounterInterrupted` side effect is skipped. The cancel use case calls the `SerialLifecyclePort` hook, which is a no-op until Stage 6 registers the clinical facade.
6. **Exit (Stage 6).** When `StartEncounter`/`CompleteEncounter` ship:
   - both interim routes return `410 FEATURE_DISABLED`, and are deleted one release later;
   - the web and mobile queue screens switch to the encounter routes;
   - the invariant in DATABASE §4.4 is restored for serials completed after the Stage 6 release date. The test asserts it for `completed_at >= <release>`.

## Consequences

- Positive: the operational queue is complete, testable and demonstrable without any clinical data model. No clinical tables or modules exist before Stage 6.
- Negative:
  - two routes exist only temporarily;
  - completed serials from the Stage 5 era have no encounter;
  - AssignmentPolicy rule 1 (encounter) has no data until Stage 6 (audit C-46).
- Security: nothing clinical is recorded. The interim commands carry no free text beyond the standard reason codes.

## Alternatives rejected

- **Build a minimal `encounters` table now:** it is out of scope, and would pre-empt the Stage 6 design (participants, notes, telemedicine linkage).
- **Stop the queue at `CALLED`:** it fails the stage acceptance ("run a full chamber day") and leaves the queue positions of served patients ambiguous.
- **Complete directly from `CALLED`:** that edge is not in the documented transition table. Inventing it would violate QUEUE §3.2.
