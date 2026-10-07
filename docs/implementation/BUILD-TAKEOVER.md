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

## Remaining timeline work

TL-001 has local implementation and focused validation; the full timeline checkpoint is not complete. The chain source will be registered in the runtime when the projector is activated. TL-002 needs event subscriptions, an idempotent projector, source resolution through public ports, redaction handling, checkpoint advancement, and retained-event/source-backfill rebuild comparison. TL-003 needs authorized cursor API, generated contracts/clients, and doctor/patient views. These are not complete, and no timeline checkpoint tag has been created.

Before activating projection, fix the existing outbox TTL rule so unpublished-to-timeline events cannot be deleted. Checkpoint semantics must account for out-of-order processing and retries; the maximum observed timestamp alone cannot prove every earlier event was projected. Retained events alone are insufficient for rebuilding history older than 30 days.

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

A marker masks all entries for its source within the same tenant, patient and projection version. An encounter marker also masks descendants whose structured references name that encounter. The original-row FK and all original rows remain intact. TL-003 must apply `isTimelineEntryRedacted` before visibility/pagination, so a clinical encounter marker also suppresses related patient-shared records without revealing the clinical marker itself.

### TL-002 validation (2026-10-07)

- MariaDB 10.6: **165/165 integration tests**, covering projector/repository/schema, engine contracts, queue concurrency/lifecycle, scheduling, jobs, worker shell and API single-app profile.
- MariaDB 11.8: **82/82 final focused integration tests**, covering projector/repository/schema, engine contracts (including composite tenant FKs), worker shell and API profile. The earlier queue/scheduling/jobs regression run passed **122/122**.
- All unit and architecture tests: **469/469**. Compilation of affected packages and both app roots, timeline tests, and shared security/support tests passed. Repository ESLint, Prettier, dependency-cruiser (437 modules), secrets scan, migration immutability and all **18 normalized migration** checks passed. Frozen-lockfile install and Prisma generation completed successfully after test processes released the Windows engine file.
- One initial document fixture lacked the schema-required scanner identity. Correcting the fixture made that test pass; product checks were not relaxed. Windows refused Prisma engine replacement during an overlapping test run; the install succeeded after tests finished.

TL-002 is complete locally. The full release checkpoint script, merge/push, deployment and checkpoint tagging have not been performed. TL-003 remains open. Its reader must apply scoped redactions before pagination/visibility, resolve sources through their public ports, enforce doctor/patient authorization, and check pending receipts plus source-bootstrap completion for freshness. Existing phone PDF, staging, host-duration, Bangla review, production walkthrough and credential/access follow-ups remain as recorded in the prior handover.
