# Build takeover — 2026-10-07

The working tree started clean at `eef0d0a`, following the CP11 implementation commit `afc5493`. The code and migration inventory match the supplied handoff: the timeline package is a scaffold, with no projector or API. Existing CP11 verification is recorded evidence from the previous agent, not a new verification of the complete tree.

The next milestone remains patient timeline (TL-001–003), followed by follow-up and communication in MVP order. No production deployment or account changes have been made during takeover.

## Architecture and continuation plan

The project is a TypeScript workspace with a Nest API/worker, React web client, and Flutter doctor/patient apps. MariaDB and Prisma hold tenant-scoped data; writes emit identifier-only events through a transactional outbox into the database job queue. Bounded contexts expose public ports, and dependency checks enforce those boundaries. Manual clinical work must remain available independently of optional providers.

Continue in the roadmap's order: timeline, follow-up/notifications, remote sessions, then AI drafts. Payments, uploads/labs, patient-client completion, email recovery, and release evidence remain separate outstanding work. The immediate prerequisite found during this review is safe outbox retention before timeline activation. The real-data gate and owner-run hosting checks remain open.

## First bounded change: timeline foundation

- Added `timeline_events` and `projection_checkpoints` in normalized migration 0011.
- Enforced tenant/patient FKs, projection deduplication, sequence uniqueness, visibility/event CHECKs, positive versions, and valid redaction marker structure.
- A redaction FK includes patient identity, preventing a marker from hiding another patient's record within the same tenant.
- Mirrored enum CHECKs in `DB_ENUMS` and added integration tests against the engine, including Bangla text and JSON.
- Added a tenant-scoped append-only repository with idempotent, serialized sequence allocation, safe fixed summaries, identifier-only references, and a chain source for the existing verifier.
- Added concurrency, rollback, immutable-redaction, and privileged-tampering detection tests.
- Updated synthetic test cleanup for the new FK relationships.
- Resolved the timeline/follow-up migration split as C-57; 0020 is reserved for follow-up. Applied historical migrations are untouched.

## Timeline continuation status

TL-001–003 are implemented locally. Source projection, chain verification, exact receipt retention, source backfill/rebuild comparison, authorized cursor API and doctor/patient views are active in the build. The full release checkpoint and timeline tag remain outstanding; validation is recorded below.

Other inherited gaps remain as recorded in IMPLEMENTATION-STATUS: phone PDF opening, uploads/scanning/S3, release verification, staging, and owner decisions. This change does not close the real-patient-data gate.

## Validation

| Check | Result |
|---|---|
| MariaDB 10.6 | 47 integration tests passed: 13 timeline schema, 7 repository, 27 engine contract. The 2 composite tenant FK security tests passed in an isolated rerun. |
| MariaDB 11.8 | All 49 of those integration/security tests passed together. |
| Migration tooling and architecture | 54 tests passed, including append-only lint rules and dependency-boundary fixtures. |
| Full project typecheck | Passed: all 56 Turbo tasks plus the root test typecheck. |
| Timeline build and focused lint | Passed. |
| Dependency cruiser | No dependency violations. |
| Migration lint | All 17 migrations clean; apply and repeat apply proved by engine tests on both series. |
| Formatting, diff hygiene, secret scan | Passed for the changed source/configuration files; no secrets detected. |

Two test runs hit database startup connection timeouts: the first 10.6 schema attempt and the later 10.6 security setup during the full compile. Required assertions passed on rerun without weakening timeouts, assertions, or application controls. The full timeline/mobile/web acceptance gate has not been run: no timeline API or UI exists yet, so this is a foundation commit, not a finished timeline checkpoint.

Saved on the local branch `codex/timeline-foundation`. No push, production migration, deployment, or checkpoint tag was performed.

## Timeline projector operations (TL-002)

The API's embedded/cron runner and the standalone worker register `ProjectTimelineEvent`, the minute-based `ProjectTimelineBacklog`, and bounded `BackfillTimelineSources` pages on the `timeline` queue. Metadata adapters live in each source context; they select identifiers, source timestamps and visibility, never note text, prescription lines or document titles. Signed note revisions remain distinct. Mutable encounter/appointment/diagnosis status events resolve the existing source record; immutable queue ledger rows remain distinct. New serial outbox events include `queueEventId`; ambiguous legacy timestamps fail closed and retain their outbox event for investigation/replay.

Each event commits timeline rows, its versioned receipt and its completed-prefix checkpoint atomically. Unsupported non-timeline events (including draft saves) receive `IGNORED` receipts during catch-up. Unsupported versions of supported events fail without receipts. Published outbox rows can expire only after the active projection has a receipt for that exact event. Receipts remain after outbox expiry; they make job replay safe. They contain identifiers/timestamps/outcomes only and have no automatic TTL. Global events without a tenant retain ordinary age-based expiry.

Source backfill includes history whose outbox events have expired. Bootstrap pages resume through idempotent database jobs. Investigate `DEAD` timeline jobs with the existing dead-letter tools before treating a tenant's projection as complete. Future freshness readers must check pending receipt gaps and unfinished source bootstrap pages, as well as the checkpoint; its timestamp alone does not establish complete history.

To rebuild after compiling the workspace, with the database environment loaded:

```powershell
pnpm --filter @hmedic/timeline run timeline:rebuild --tenant <tenant-UUID> --version 2
```

`TIMELINE_PROJECTION_VERSION` defaults to 1 and must match in the API and worker. The command writes a higher version, prints per-patient counts and source-metadata parity, and exits 0 for parity, 2 for differences, or 1 on failure. It never changes configuration. Old rows and their chain hashes remain. Run with writers paused for the activation check; resolve differences and verify every tenant before changing the active version on both apps. In normal live traffic, concurrent source changes can cause a mismatch and require another check. Interrupted rebuilds can be safely rerun.

A marker masks all entries for its source within the same tenant, patient and projection version. An encounter marker also masks descendants whose structured references name that encounter. The original-row FK and all original rows remain intact. TL-003 applies `isTimelineEntryRedacted` before visibility/pagination, so a clinical encounter marker also suppresses related patient-shared records without revealing the clinical marker itself.

### TL-002 validation (2026-10-07)

- MariaDB 10.6: **165/165 integration tests**, covering projector/repository/schema, engine contracts, queue concurrency/lifecycle, scheduling, jobs, worker shell and API single-app profile.
- MariaDB 11.8: **82/82 final focused integration tests**, covering projector/repository/schema, engine contracts (including composite tenant FKs), worker shell and API profile. The earlier queue/scheduling/jobs regression run passed **122/122**.
- All unit and architecture tests: **469/469**. Compilation of affected packages and both app roots, timeline tests, and shared security/support tests passed. Repository ESLint, Prettier, dependency-cruiser (437 modules), secrets scan, migration immutability and all **18 normalized migration** checks passed. Frozen-lockfile install and Prisma generation completed successfully after test processes released the Windows engine file.
- One initial document fixture lacked the schema-required scanner identity. Correcting the fixture made that test pass; product checks were not relaxed. Windows refused Prisma engine replacement during an overlapping test run; the install succeeded after tests finished.

TL-002 is complete locally. The full release checkpoint script, merge/push, deployment and checkpoint tagging have not been performed. TL-003 was completed locally on 2026-10-08; its implementation and validation are recorded below. Existing phone PDF, staging, host-duration, Bangla review, production walkthrough and credential/access follow-ups remain as recorded in the prior handover.

### TL-003 authorized read views (2026-10-08)

`GET /api/v1/patients/{id}/timeline` resolves every entry through its source owner's metadata port. Assigned doctors can read clinical history; reception reads operational entries; clinic administrators and nurses honor chamber/clinic scope. Patient SELF links and guardians with VIEW_RECORDS see only currently patient-shared records. Account links, guardianship, membership, assignment and scope are checked on each request. Successful reads append TIMELINE_READ audit metadata without record contents.

All scoped redaction markers are applied before audience filtering and pagination, including markers hidden from the requesting audience. The reader also checks live source withdrawal and encounter ancestry, so revoked source records disappear while projection is behind. Missing source references fail closed. Responses contain safe labels and resolved identifiers; no note prose, prescription lines, document titles or chain internals are returned. Redaction marker responses have no source reference.

Cursors use authenticated AES-256-GCM encryption with a domain-separated key derived from the existing CSRF_SECRET. They expire after 15 minutes and bind tenant, patient, user, audience, membership/guardian scope and active projection version. Chronological order uses occurredAt/id, with an initial sequence watermark excluding later appends. Scanning is capped at 1,000 rows per request; a continuation can lead to an empty page when intervening rows are hidden. Freshness checks exact missing event receipts and completed source-bootstrap jobs, not the timestamp checkpoint alone. Purged bootstrap job records conservatively show history as updating until bootstrap runs again.

The web patient details and consultation workspace expose the panel to permitted staff. Doctor and patient mobile apps use a generated typed endpoint and an online-only shared view. English/Bangla event labels, Dhaka timestamps, refresh, pagination, empty/error states and an updating notice are included. Mobile context changes discard late responses; refresh/access errors clear displayed records. Timeline data is not added to the mobile persistent/offline cache. Native-speaker Bangla review remains the existing H-7 release follow-up.

Validation: 469 unit/architecture tests; repository ESLint, secret scan, 18 migration lint checks; affected TypeScript app/package and API test compilation; generated OpenAPI parity; clean mobile analysis; all 24 web flows, including two timeline flows with desktop/phone screenshot review; native workspace tests including two timeline widget tests. MariaDB 10.6 passed all 35 timeline repository/projector/HTTP tests; MariaDB 11.8 passed 26 repository/projector tests and all 9 HTTP tests in the final rerun. The full release checkpoint, push/merge, deployment and checkpoint tag remain separate work.
### FUP-001 follow-up core (2026-10-08)

The next MVP core now has migration 0020, plans/tasks, assigned clinical writes, scoped audited reads, optimistic updates and atomic follow-up booking through scheduling's public facade. The plan lock precedes the existing day/serial locks; idempotency completion joins the mutation transaction. Integration tests cover concurrent duplicate booking, rollback, real calendar dates/Dhaka midnight, tenant/assignment isolation, SELF/guardian scope and engine constraints. Follow-up timeline entries use the owner's metadata port and inherit encounter withdrawal masking.

The consultation web panel supports plan creation, status actions and a physical booking on its start date in the current chamber. API/typed clients support other dates/chambers/care modes/slots; richer controls and native follow-up screens remain client completion work. Clinical plan cancellation/completion does not alter an appointment implicitly. The new labels make that distinction explicit.

Validation is recorded in IMPLEMENTATION-STATUS. Test cleanup now deletes follow-up children before encounters, appointments and serials; raw test connections use the same 10-second connection budget as the production database client to avoid Docker socket-startup flakes. Historical migrations are unchanged. Automated reminder delivery is next in COM-001–003, followed by transactional SMS/credential monitoring; this milestone does not send messages.
### Communication delivery core (2026-10-10)

The notification core now has communication persistence, effective consent preferences, owner-port eligibility checks, due follow-up scanning, identifier-only jobs, duplicate-safe mock delivery, raw-byte signed webhook verification and append-only receipt deduplication. Operational reads/preferences are authorized for staff and resolved patient contexts; communication timeline metadata inherits the source encounter redaction. Real messaging, failure fallback, short-link behavior, additional triggers/channels and native delivery UI remain open. Production mock delivery/scanning/webhooks are disabled.

Tests found a date-dependent fixture issue: a CALLED serial was inserted without advancing next_serial_number and its day used the host date. The shared fixture now advances the counter; the follow-up fixture passes its fixed clock so booking assertions always use the intended different day. Migration/receipt design decisions are recorded as C-59. Validation is recorded in IMPLEMENTATION-STATUS; no production deployment or release checkpoint is included.

Validation: 507 unit/architecture checks; 79 targeted MariaDB 11.8 integration checks; corresponding MariaDB 10.6 suites plus five SMS OTP regressions; 25 existing web flows and two notification flows; mobile analysis and all six package test suites. TypeScript builds, repository lint, format, migration lint (20), applied migration immutability, contract parity (135), dependency boundaries (468 modules/1,971 dependencies) and secret scan passed.

### Follow-up transactional SMS (2026-10-10)

The dedicated SMS worker is connected to non-production follow-up notification selection and the existing configured SMS provider runtime. It pins credentials in identifier-only jobs, enforces configured account rate/concurrency limits, reloads live owner eligibility before sends and applies the tested SMS outcome policy. Unknown outcome recovery uses one flagged resend; insufficient balance waits for verified balance recovery with a 24-hour limit. Contracts and the web preference panel support SMS. Production enablement, other triggers and short links remain open. Validation is recorded in IMPLEMENTATION-STATUS. The only added dependency is the existing secrets workspace package for integration-test fixtures; no external version changed.
## Tenant SMS account settings (2026-10-10)

Tenant owners with sms.credentials.manage can add an encrypted Zaman IT key, list masked account metadata, validate it with a free balance check, read the latest balance and revoke it. Validation joins the status, snapshot and audit in one transaction after provider I/O; a changed version or concurrent revocation rejects the result. Unparsed balances never activate a pending account. Free validation leaves sender-ID verification unchanged and sends no SMS. Repeated revocation preserves the secret tombstone.

The web settings page clears the key immediately on submission, never stores it in browser storage, and clears account records after an authorization failure. The platform balance endpoint requires the existing operator context, permission and authentication guards. It returns at most 10,000 safe snapshots from 30 days, a truncation flag and daily estimates based on observed balance declines; top-ups are excluded, and this is not a billing ledger. TypeScript and Dart clients now expose 141 operations.

SMS-006/007 remain partial: other business triggers, short links, authorized fallback, operator/outcome UI, native settings and production enablement remain open. Scheduled balance alerting remains the existing CheckSmsBalance maintenance behavior. No external SMS or deployment was performed.
Validation: 508 unit/architecture tests passed. All 70 targeted integration tests passed on MariaDB 11.8 (42 communication, eight credential vault, 20 HTTP); the 42 communication and eight vault tests passed on 10.6, followed by all 20 HTTP tests in the corrected platform-context rerun. Both SMS settings browser flows passed, including immediate key clearing, permission denial and record removal after access loss; the 390-pixel phone screenshot was reviewed. Affected TypeScript builds/test compilation, Dart client analysis, repository lint, dependency boundaries (474 modules/2,020 dependencies), secret scan, 20 migration lint checks, applied-migration immutability and 141-operation OpenAPI parity passed. The initial HTTP failure was an incorrect fixture expecting permission rejection while sending a tenant header to a platform route; application authorization was unchanged.
## Authenticated reminder-link landing (2026-10-10)

The authenticated communication-link API now resolves only a live SELF or guardian VIEW_RECORDS patient context. The optional dedicated SHORT_LINK_PEPPER enables resolution; missing configuration disables the endpoint. The web /r/:token landing preserves its exact path through login, lets the user choose an authorized patient context and opens that patient's timeline. Patient requests carry explicit tenant/context headers independently of remembered staff tenancy. Link failures, revoked access and failed context refresh hide patient data. Tokens are not persisted in browser storage. Typed OpenAPI and Dart clients now cover 142 operations.

Validation: the existing 20 HTTP cases passed on MariaDB 10.6 and 11.8, and all four new authorization/expiry/configuration cases passed on both after correcting an expiry fixture. The full 508 unit/architecture checks passed; five web unit checks include the safe return-path case. Ten existing browser cases and all three new reminder-link cases passed. The 390-pixel phone screenshot was reviewed. TypeScript builds, Dart analysis, lint, dependency checks (480 modules/2,051 dependencies), generated-contract parity, 21 migration checks, migration immutability and secret scanning passed.

Outgoing SMS links and expired-row maintenance remain open. This work is on codex/timeline-foundation, unmerged and undeployed; no external SMS was sent.

## Follow-up SMS links and retention (2026-10-10)

Non-production API and worker SMS composition now includes reminder links when SHORT_LINK_PEPPER is configured. Both processes must use the same key and WEB_PUBLIC_URL origin. The generic pinned English/Bangla message carries only /r/<opaque-token>; configured path/query/fragment are discarded, and userinfo or unsupported URL schemes are rejected. Missing key retains the generic reminder without a URL.

Link issuance follows the account rate check and runs outside the send-preparation transaction to preserve patient/source lock ordering. Preparation then rechecks live consent and source eligibility before any paid provider call. Rendering validates the final segment budget before creating an attempt. Tokens never enter jobs, attempts, audit or outbox payloads. A cancelled or interrupted send can leave an unused hash until retention removes it; unknown-outcome retries retain the existing single-resend policy. The existing bounded TTL job now deletes links strictly older than seven days after expiry using the indexed expiry column.

Validation: 509 unit/architecture tests passed. All 63 communication and worker integration checks passed on both MariaDB 10.6 and 11.8, including English/Bangla link resolution, token privacy, rate denial, consent withdrawal after issuance and final segment-budget rejection. Builds/test compilation, repository lint, dependency boundaries (480 modules/2,052 dependencies) and secret scanning passed. Cleanup boundary validation is recorded separately below.

Production reminder scanning and this SMS composition remain disabled. Other business triggers, authorized channel failure fallback, native notification screens and release enablement remain open. No external SMS or deployment was performed.
Cleanup validation: the new bounded-delete test passed on MariaDB 10.6 and 11.8. It removes one expired row per batch, retains the exact seven-day boundary and preserves a resolvable live link.

## Remote-session provider foundation (2026-10-10)

The previously empty telemedicine package now provides the provider port, terminal lifecycle rules, disabled recording and a five-minute/session-expiry join-token policy. A local/CI mock supports scoped opaque tokens, refresh, creation timeout/unavailability, unauthorized participant rejection, end-session failure/retry and duplicate or changed participant-event replays. No clinical identifiers are required at the provider boundary.

Validation: all 522 unit/architecture tests passed, including 13 new remote-session tests; package build/test compilation, lint, dependency boundaries (484 modules/2,060 dependencies) and secret scanning passed. No dependency or database migration changed. TELE-001/002 remain partial: durable persistence, application authorization, HTTP routes and remote-session clients are not composed yet. No live provider or deployment was enabled.

## Durable remote sessions and HTTP (2026-10-10)

Remote sessions now have durable session/participant/event tables (migration 0022), encounter and patient/guardian authorization, create/read/join/end HTTP routes and generated TypeScript/Dart clients. Provider calls run outside ranked transactions; live access is checked again afterwards. Join tokens expire within five minutes/session expiry and are never stored; credential replay is refused. Verified participant receipts are append-only and deduplicate identical events. Recording is disabled, and ending a session never completes the clinical encounter.

Validation: 524 unit/architecture tests; 109 distinct targeted integration cases on each MariaDB series (10.6 and 11.8), including seven remote HTTP cases. Builds/test compilation, full mobile analysis, lint, dependency boundaries (489 modules/2,096 dependencies), 146-operation contract parity, 22 migration checks, applied-migration immutability and secret scanning passed. Fixture corrections added child-first cleanup and the new schema section; worker scheduling assertions now check one job per type/window across minute boundaries. A loaded 11.8 readiness failure passed on the final rerun without weakening the health check.

TELE-001/002 remain partial: only a non-production mock is composed. Live provider selection, TURN/ICE, call UI, verified ingress and interrupted-creation/background expiry recovery remain open. Production routes are disabled. No live video, external SMS, deployment, merge or release tag was performed. AI credentials/policy/drafts, payments, uploads/labs and the remaining client/release work are still open.

## AI policy and credential lifecycle foundation (2026-10-10)

The AI package now exports a pure effective-policy evaluator, ordered fallback selector and credential lifecycle policy. Evaluation requires explicit tenant opt-in, active doctor-scoped credentials, encounter assignment, current patient consent, matching adapter metadata and both tenant/runtime provider allowlists. UNKNOWN data-use classifications take the may-train path, requiring minimization, a current acknowledgement and the free-tier permission. Production additionally requires closed reviewed provider gates; mock remains blocked. Billing modes match declared tiers; platform-managed use requires explicit enablement and is never selected as a fallback. Raw media requires a contractual no-training policy, capability and feature opt-in.

Fallbacks preserve tenant/doctor scope, order and data-use protection while enforcing model compatibility and the retry budget. Credential disable/re-enable requires validation again; revocation is terminal. These functions consume trusted live snapshots: persistence owners must resolve consent/acknowledgement versions and assignment again before provider I/O. They do not activate credentials, store secrets, issue jobs or write clinical records.

Validation: all 548 unit/architecture tests passed, including 24 AI cases covering all 256 combinations of eight required policy gates, scope and production restrictions, fallback protection and every credential state/action pair. AI build/test compilation, lint and dependency boundaries (493 modules/2,100 dependencies) passed. No dependency, API contract or migration changed. AICRED/AIPOL remain partial: encrypted credential storage, policy/acknowledgement APIs, adapter register parity, provider validation, job execution and draft review/approval are still open. No provider request or patient data was sent.
