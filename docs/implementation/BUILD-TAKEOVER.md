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