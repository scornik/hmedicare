# Follow-up implementation (FUP-001)

Implemented locally on 2026-10-08, after TL-003. Migration 0020 creates follow_up_plans and follow_up_tasks; historical migrations are untouched. Tenant-qualified foreign keys, status/type CHECKs, a nonempty reason, positive row versions, ordered due dates and complete appointment/serial booking links are enforced by MariaDB.

## Clinical plans and operational tasks

An assigned doctor creates a plan from an encounter, with a due date/window, reason and optional instructions. Dates are real ISO calendar dates in Asia/Dhaka, and new plans cannot start before today's Dhaka date. A REMINDER task is created in the same transaction, due at midnight in Dhaka on the start date. Reasons/instructions remain in the owning clinical record; events and audit metadata contain identifiers, status and counts only.

Clinical writes require a doctor profile and current encounter assignment. An entered-in-error encounter refuses further plan writes or bookings. Scoped clinical staff can read plans, with an audited list action; reception cannot read clinical reason/instructions. PLANNED and BOOKED plans can transition to COMPLETED, CANCELLED or MISSED. Terminal plans cannot reopen. Changes require expectedRowVersion; changing a planned due date also updates its open task, and terminal status cancels outstanding tasks. Due dates of a booked plan require appointment management rather than changing a promised booking in place.

## Booking

POST /follow-ups/{id}/book accepts chamber, local date, care mode, optional slot and expectedRowVersion. The appointment service applies its existing chamber scope, booking window, capacity, slots and payment availability rules. The target doctor must match the plan's doctor; the date must fall in its due window. SELF or a guardian with BOOK_APPOINTMENTS can book only for the resolved context patient; the HTTP guard revalidates the account/guardianship before each call.

Scheduling offers a beforeBook callback. The facade locks its plan at rank 38 before the day (40), appointment (42) and serial (44). It then links the appointment and serial, changes the plan to BOOKED, and appends audit/outbox events in the same transaction. A second simultaneous booking loses on row version; failed finalization rolls everything back. Creation and booking complete the HTTP idempotency response inside that mutation transaction, so retry snapshots exist exactly when the mutation committed.

Plan status and appointment/queue status are separate actions. Completing or cancelling a plan does not silently cancel a booked visit. Links record the appointment and serial produced by booking; later scheduling changes follow the existing appointment/serial workflow.

## API and clients

- GET /encounters/{id}/follow-ups: authorized clinical list.
- POST /encounters/{id}/follow-ups: assigned doctor creation, idempotent.
- PATCH /follow-ups/{id}: assigned doctor update with row version.
- POST /follow-ups/{id}/book: staff or authorized patient-context booking, idempotent.

Contracts and generated TypeScript/Flutter clients include all four routes (131 operations total). The consultation web panel creates plans, shows reason/instructions and status, books a physical visit on the start date in the current chamber, and completes/cancels plans with stale-update feedback. It checks permissions, keeps text in memory and clears form state when tenant/user/encounter changes. Broader chamber/date/care-mode/slot selection is supported by the API; those client controls and native follow-up screens remain part of client completion.

The timeline resolves follow-up identifiers through a metadata-only owner port. It displays a generic patient-shared follow-up label, never reason/instructions; encounter redactions also mask these descendants. Existing timeline projection, source backfill, rebuild and receipt-based retention apply to the new event family.

## Next work

REMINDER rows are durable work records. Automated message delivery, consent/channel selection, retries, fallback and provider status are COM-001–003/SMS-006–007; no reminder SMS is sent by this change. Operational task management screens and native follow-up screens remain client completion work. Native-speaker Bangla review remains H-7.

Validation is recorded in IMPLEMENTATION-STATUS and BUILD-TAKEOVER. No production deployment, full release gate or checkpoint tag is included in this local milestone.
### Communication follow-up connection (2026-10-10)

Non-production notification workers consume due REMINDER tasks through public owner ports and enqueue consented email/WhatsApp mock intents. They recheck eligibility before provider I/O; cancellations, withdrawn encounters, revoked consent and unverified contacts suppress delivery. Consumed task dates can be moved: the follow-up owner creates a new OPEN task for the new date. Production scanning remains disabled pending transactional SMS and real channel selection. No real reminder SMS is enabled yet. See COMMUNICATION-IMPLEMENTATION.md for the implemented path and remaining notification work.
