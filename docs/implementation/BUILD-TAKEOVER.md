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
