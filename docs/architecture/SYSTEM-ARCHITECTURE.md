# System Architecture

## 1. Recommended shape

Use a **modular monolith plus workers** for the first production architecture:

- One REST API application containing bounded-domain modules.
- One PostgreSQL database with strict tenant-scoped repositories and migrations.
- One object-storage abstraction for documents, PDFs, images, and audio.
- One job queue and worker process for rendering, delivery, notifications, AI processing, and scanning.
- Provider adapters for video, WhatsApp, SMS, email, phone, payments, and AI.
- Doctor and patient mobile clients; a web admin/staff client may use the same API.

This preserves transaction boundaries for serials, encounters, prescriptions, timelines, and follow-ups. Split a context into a service only after measured scale, ownership, or provider isolation justifies it.

## 2. Logical components

```text
Doctor App / Patient App / Staff Web
              |
        API Gateway / REST API
              |
  Identity | Tenant | Patient | Queue | Clinical | Communication | AI
              |
       PostgreSQL + Object Storage
              |
       Job Queue -> Worker Processes
              |
 Provider Adapters: Video, WhatsApp, SMS, Email, Phone, AI, Payment
```

The API is the only trusted application boundary for clinical mutations. Mobile clients do not write directly to the database or object store without an authorized upload-session flow.

## 3. Request paths

### Synchronous transaction

Use a database transaction for:

- patient identity creation/merge approval;
- appointment booking and cancellation;
- serial issuance and queue transitions;
- encounter start/end;
- prescription approval/finalization;
- follow-up creation;
- permission changes.

Return the committed resource and an idempotency result.

### Background job

Use a retryable job for:

- prescription PDF rendering;
- email/SMS/WhatsApp delivery;
- push notification fan-out;
- document malware scanning;
- audio upload processing;
- speech-to-text and clinical extraction;
- AI retrieval/index refresh;
- lab/document processing;
- retention and export packages.

Jobs MUST carry tenant ID, actor ID where applicable, resource ID, correlation ID, attempt count, and a redacted payload reference.

### Domain event

Publish an internal event after commit for timeline projection, notifications, audit enrichment, and search indexing. Domain events are not a replacement for the source transaction.

## 4. Data and storage

- PostgreSQL is the source of truth for structured data.
- Object storage holds encrypted-at-rest file objects. PostgreSQL stores metadata, ownership, checksum, MIME type, size, version, and storage key.
- A short-lived signed URL is issued only after resource authorization.
- Redis or equivalent may provide queue/job coordination, rate limiting, short-lived OTP/session state, and cache. It is not the clinical source of truth.
- Search may begin with PostgreSQL indexes/trigram/full-text search. Add a dedicated search engine only when measured requirements justify it.

## 5. Observability

- Structured application logs with correlation ID, tenant ID hash, actor ID hash, route, status, latency, and error class.
- Metrics for queue wait time, serial transition failures, encounter starts, delivery success/failure, job age, AI latency, upload failures, and database health.
- Tracing across API, database, object storage, provider adapter, and worker job.
- Security event stream for login anomalies, authorization denial, bulk export, permission changes, and suspicious delivery behavior.
- Redaction middleware MUST remove phone, email, patient name, medical text, tokens, signed URLs, and provider secrets from ordinary logs.

## 6. Deployment baseline

- Separate development, staging, and production environments.
- Private PostgreSQL and worker network; API ingress through TLS termination and WAF/rate limiting.
- Secrets from a managed secret store or environment injection, never committed config files.
- Automated database migrations with a rollback/forward-fix procedure.
- Encrypted backups, restore drills, retention policy, and deletion workflow.
- Health checks for API, database, queue, object storage, and each enabled provider adapter.

## 7. Scalability path

1. Modular monolith with one database.
2. Read replicas or reporting projections if timeline/report queries affect transactions.
3. Dedicated worker pools for communication, AI, and document processing.
4. Split high-volume provider or AI workloads only after load evidence.
5. Preserve domain event contracts and repository interfaces so extraction does not change API semantics.

## 8. Explicit non-decisions

- No reference repository is the implementation base.
- No Jitsi, Agora, mediasoup, WhatsApp, SMS, AI, or payment provider is selected by this document.
- No call recording is enabled by default.
- No regulatory compliance claim is made.

## Change log

### 2026-09-17 — Stage 3.1

- Hosting target is Hostinger Cloud Startup: separate `api`, `worker` and static `app` sites plus staging equivalents, idle-stop mitigated by a 1-minute cron keep-alive, no inbound WebSockets (ADR-013).
- The structured source of truth is **MariaDB** (10.6 feature floor) through Prisma, not PostgreSQL. PostgreSQL trigram/full-text search is replaced by indexed normalized-column prefix search (ADR-014).
- The "Redis or equivalent" coordination store is removed. Jobs, outbox dispatch, rate limits, OTP challenges and idempotency records live in MariaDB tables (ADR-015).
- Object storage is a port with S3-compatible and private-disk adapters. Downloads use short-lived HMAC tokens streamed through the API instead of provider presigned URLs (ADR-016).
- The "private database and worker network / WAF" deployment note is replaced by Hostinger managed TLS, application rate limits and token-protected internal endpoints (ADR-013).

### 2026-09-17 — Stage 3.2

- Providers selected: **Zaman IT** for SMS/OTP delivery (ADR-018) and **aamarPay** for payments (ADR-019). The "no SMS or payment provider is selected" statement no longer applies to those two; WhatsApp, email, push and video stay unselected.
- A `payments` bounded context (fees, merchant accounts, intents, verification, ledger, refunds, payouts, subscriptions) and a shared `secrets`/`provider-credentials` layer are added. Payments never touch clinical data (ADR-019).
- Production gates `GATE-SMS-HTTP` (plain-HTTP SMS API) and `GATE-PAY-PLATFORM-COLLECTION` (platform-held patient fees) are enforced at runtime (`docs/implementation/IMPLEMENTATION-REVIEW.md` §4).
