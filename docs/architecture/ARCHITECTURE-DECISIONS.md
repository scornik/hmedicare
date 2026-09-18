# Architecture Decision Records

## Index

| ADR | Title | Status |
|---|---|---|
| ADR-001 | New codebase instead of fork | Accepted |
| ADR-002 | Modular monolith first | Accepted |
| ADR-003 | PostgreSQL relational source of truth | **Superseded by ADR-014** (relational source of truth retained; engine changed) |
| ADR-004 | Tenant and membership isolation | Accepted (RLS option withdrawn, see ADR-014) |
| ADR-005 | First-class serial engine | Accepted |
| ADR-006 | Patient timeline as a projection | Accepted |
| ADR-007 | Communication provider abstraction | Accepted; first SMS adapter **selected by ADR-018** |
| ADR-008 | AI approval architecture | Accepted; provider model **extended by ADR-017** |
| ADR-009 | Object storage for files | **Partially superseded by ADR-016** |
| ADR-010 | Asynchronous worker architecture | Accepted; queue technology **decided by ADR-015** |
| ADR-011 | Shared Flutter mobile architecture | Accepted |
| ADR-012 | Video provider abstraction and no recording default | Accepted |
| [ADR-013](ADR-013-hostinger-hosting.md) | Hostinger Cloud Startup hosting target | Accepted (2026-09-17) |
| [ADR-014](ADR-014-mysql-engine.md) | MariaDB (MySQL-family) database engine | Accepted (2026-09-17) |
| [ADR-015](ADR-015-database-job-queue.md) | Database-backed job queue | Accepted (2026-09-17) |
| [ADR-016](ADR-016-object-storage-and-scanning.md) | Object storage port and scanning | Accepted (2026-09-17) |
| [ADR-017](ADR-017-per-doctor-multi-provider-ai.md) | Per-doctor multi-provider AI | Accepted (2026-09-17) |
| [ADR-018](ADR-018-zamanit-sms-otp.md) | Zaman IT as first SMS/OTP delivery adapter | Accepted (2026-09-17, Stage 3.2) |
| [ADR-019](ADR-019-aamarpay-payments-mvp.md) | Payments enter MVP with aamarPay | Accepted (2026-09-17, Stage 3.2); supersedes billing-Future (audit S3-13) |
| [ADR-020](ADR-020-medicine-dataset-import.md) | Medicine dataset import | Accepted (2026-09-17, Stage 3.2) |

ADR-013…ADR-020 are separate files. The original text of ADR-001…ADR-012 below is unchanged; Stage 3.1 supersession notes are appended as quoted blocks.

## ADR-001 - New codebase instead of fork

**Context:** The teardown found useful patterns across five repositories, but also unknown licensing, GPL obligations, obsolete dependencies, incomplete workflows, and security risks.  
**Decision:** Build a completely new codebase and use repositories as reference-only.  
**Alternatives:** Fork Medigo, OpenEMR, HCW@Home, TPT Doctor, or DocPilot; rejected because product fit, licensing, and security are not established.  
**Reasoning:** Preserves Bangladesh-specific domain ownership and avoids accidental source/license inheritance.  
**Consequences:** More initial design work; clear provenance and smaller product scope.  
**Open Questions:** Legal review of any future dependency or separately approved code reuse.

## ADR-002 - Modular monolith first

**Context:** The workflow requires atomic serial, encounter, prescription, timeline, and follow-up transactions.  
**Decision:** Start with bounded modules in one API and database, plus workers.  
**Alternatives:** Microservices from day one; rejected as premature operational complexity.  
**Reasoning:** Preserves transaction consistency while leaving provider/worker boundaries explicit.  
**Consequences:** Strong module discipline and repository boundaries are required.  
**Open Questions:** Split high-volume AI/communication modules only after measured load.

## ADR-003 - PostgreSQL relational source of truth

**Context:** Teardown showed TPT/OpenEMR strengths in explicit clinical relationships and Medigo weaknesses in client-side document/free-text persistence.  
**Decision:** Use PostgreSQL for structured tenant-scoped records; object storage for binaries.  
**Alternatives:** Firestore-only; rejected for core clinical integrity/audit/query requirements.  
**Reasoning:** Supports constraints, transactions, reporting, timeline queries, and tenant checks.  
**Consequences:** Migrations and query design are required; offline sync is an explicit client concern.  
**Open Questions:** RLS as defense-in-depth after repository tests.

> Stage 3.1 supersession (2026-09-17): **superseded by ADR-014.** A relational source of truth is retained, but the engine is MariaDB (the database Hostinger Cloud provides). The RLS open question is closed as not applicable.

## ADR-004 - Tenant and membership isolation

**Context:** TPT provides a useful tenant boundary; frontend-only filtering is unsafe.  
**Decision:** Every tenant-owned table and repository query is tenant-scoped; roles are capability-based.  
**Alternatives:** Global user-only authorization; rejected.  
**Reasoning:** Supports SaaS clinics and prevents cross-tenant PHI access.  
**Consequences:** Tenant context must flow through every service, job, export, and provider callback.  
**Open Questions:** Cross-tenant practitioner access requires separate policy/research.

> Stage 3.1 note (2026-09-17): the RLS defense-in-depth option is not available on MariaDB. Composite tenant foreign keys and tenant-isolation tests are mandatory instead (ADR-014).

## ADR-005 - First-class serial engine

**Context:** No reference provided a Bangladesh chamber serial model.  
**Decision:** `Serial`, `ChamberDay`, `QueueEvent`, and `CheckIn` are separate from Appointment and Encounter.  
**Alternatives:** Treat appointment as queue position; rejected because walk-ins, recalls, shared physical/remote queues, and audit need independent state.  
**Reasoning:** Makes chamber operations explicit and testable.  
**Consequences:** More tables and state-transition tests; supports the core differentiator.  
**Open Questions:** Exact chamber policy defaults and queue fairness rules require field validation.

## ADR-006 - Patient timeline as a projection

**Context:** The product needs fast longitudinal history without a giant medical-record table.  
**Decision:** Generate immutable `TimelineEvent` projections from committed domain events, retaining source references.  
**Alternatives:** Assemble arbitrary tables only in the UI; rejected for retrieval consistency and AI access.  
**Reasoning:** Gives one authorized history read model without duplicating clinical truth.  
**Consequences:** Projection idempotency/rebuild tooling is required.  
**Open Questions:** Event retention and redaction policy require legal review.

## ADR-007 - Communication provider abstraction

**Context:** Teardown only verified integration hooks, not finished WhatsApp/SMS behavior.  
**Decision:** Normalize message intent, attempts, receipts, retries, consent, and provider IDs behind adapters.  
**Alternatives:** Couple business logic to one provider; rejected due to availability, cost, and policy uncertainty.  
**Reasoning:** Supports fallback and provider replacement without changing clinical modules.  
**Consequences:** Adapter contracts and webhook verification must be maintained.  
**Open Questions:** Bangladesh provider/template/Business verification.

> Stage 3.2 note (2026-09-17): the abstraction stands; Zaman IT is the first real SMS adapter and the OTP transport (ADR-018). Payments use a separate `PaymentGatewayPort` with aamarPay (ADR-019).

## ADR-008 - AI approval architecture

**Context:** No reference verified safe AI clinical writing.  
**Decision:** AI creates drafts/suggestions only; doctor review and explicit approval create final records.  
**Alternatives:** Auto-write diagnosis/prescription; rejected as unsafe and contrary to product requirement.  
**Reasoning:** Preserves clinician control and provenance.  
**Consequences:** Review UX, versioning, audit, and provider abstraction are mandatory.  
**Open Questions:** Provider, model quality, Bangla/Banglish evaluation, clinical validation.

> Stage 3.1 note (2026-09-17): the approval architecture stands. The provider open question is answered by ADR-017 (per-doctor credentials, multiple providers, encoded data-use policy, production gates).

## ADR-009 - Object storage for files

**Context:** Lab reports, PDFs, images, and audio are large and require access policy/versioning.  
**Decision:** Store binaries in private object storage; store metadata/checksum/version in PostgreSQL.  
**Alternatives:** PostgreSQL blobs or public URLs; rejected for scale and access control.  
**Reasoning:** Enables signed access, scanning, resumable upload, and retention jobs.  
**Consequences:** Storage lifecycle and authorization must be tested.  
**Open Questions:** Provider and region/data-residency research.

> Stage 3.1 supersession (2026-09-17): **partially superseded by ADR-016.** Private storage with DB metadata stands; object storage becomes a port with S3-compatible and private-disk adapters, metadata lives in MariaDB, and signed URLs become API-streamed HMAC download tokens.

## ADR-010 - Asynchronous worker architecture

**Context:** PDF, delivery, notification, scanning, transcription, and AI operations are slow/retryable.  
**Decision:** Use a durable job queue with tenant/correlation/idempotency metadata. Keep clinical transactions synchronous.  
**Alternatives:** Make every operation synchronous; rejected for poor UX and retry behavior.  
**Reasoning:** Separates committed clinical state from eventual side effects.  
**Consequences:** Job monitoring, dead-letter handling, and idempotency are required.  
**Open Questions:** Queue technology and capacity sizing after load tests.

> Stage 3.1 note (2026-09-17): the queue technology open question is answered by ADR-015 (MariaDB job tables, leases, outbox, cron-assisted runner). No external queue broker is used.

## ADR-011 - Shared Flutter mobile architecture

**Context:** Medigo demonstrates separate patient/doctor mobile flows; DocPilot demonstrates shared Flutter packaging. Both are incomplete/old.  
**Decision:** Shared Flutter core with role-specific app shells/modules, Android-first.  
**Alternatives:** Separate native codebases or reuse old dependencies; rejected for duplication or maintenance risk.  
**Reasoning:** Shared auth/API/offline/upload primitives reduce divergence while preserving role UX.  
**Consequences:** Feature boundaries and release testing must remain disciplined.  
**Open Questions:** Exact package/release strategy.

## ADR-012 - Video provider abstraction and no recording default

**Context:** HCW has mediasoup patterns, Medigo has Agora, OpenEMR has provider-based telehealth; runtime/provider details are not equivalent.  
**Decision:** Use a provider-neutral telemedicine interface, audio-only fallback, short-lived participant tokens, and no recording by default.  
**Alternatives:** Commit immediately to Agora/Jitsi/mediasoup or record all calls; rejected without provider, consent, retention, and operational evidence.  
**Reasoning:** Preserves choice and minimizes sensitive media risk.  
**Consequences:** Adapter capability matrix and provider evaluation are required.  
**Open Questions:** Provider, TURN/ICE/reconnect, Bangladesh bandwidth/cost, recording policy.
