# Implementation Status — Stage 4 (Foundation + Tenant/Identity)

Living document for Stage 4 (BUILD-CONTRACT; Stage 4 prompt §8). Updated after every merged task.
Legend: **DONE** merged to `main` with tests · **PROVISIONAL** merged, final only after the listed HOST items pass ·
**IN PROGRESS** · **TODO** · **DEFERRED** (out of phase, reason given) · **BLOCKED** (human action required).

## 1. Checkpoint status

| Checkpoint | Scope | Status | Tag |
|---|---|---|---|
| CP1 Foundation | FOUND-*, JOB-*, HOST harness, CI, api/worker shells | IN PROGRESS | `stage4-cp1-foundation` (pending) |
| CP2 Tenant/Identity | ID-001…ID-007, SMS-001…005/008, web + mobile shells, seed | TODO | `stage4-cp2-identity` (pending) |

## 2. Tasks

| Task | Status | Branch / commit | Tests added | Notes |
|---|---|---|---|---|
| FOUND-001 repo + tooling | DONE | `3c015b7` | architecture: depcruise fixtures (every rule fires), ESLint rule tests (32) | pnpm 12.4.2, turbo, ESLint 10 flat + `eslint-plugin-hmedic` (tooling/), Prettier, pre-commit hook |
| FOUND-002 config | DONE | `fc4b451` | unit 10 | fail-closed Zod env; names-only errors; `TRUST_PROXY_HOPS` added in FOUND-006 (C-38) |
| FOUND-003 kernel | DONE | `6a10339` | unit 74 (error-code doc parity) | `SESSION_REVOKED` added (C-35) |
| FOUND-004 database | PROVISIONAL (HOST-001/003/005) | `0fbd5b5` | unit 13, integration 22 (engine contract 19, migrate-guarded 3) × 10.6/11.4 | Prisma 7.10.0 + MariaDB adapter; migrations 0001/0002/0003/0014(part)/0015/0016; lockRow only in `packages/database` |
| FOUND-005 local infra | DONE | `0fbd5b5` | compose healthchecks | `infrastructure/docker/compose.yaml` (MariaDB 10.6 by digest, mock-providers, MinIO under `storage` profile) |
| FOUND-006 api shell | DONE | `5a1de2d`, `b83c3e3` | integration 21 (http-kit 18, api 3) | new `packages/http-kit` (C-36); `nestjs-pino` not used (C-37) |
| FOUND-007 worker shell | DONE | `dd0c7f0` | integration 5 | diagnostics moved to `apps/host-probe` (deviation D-06) |
| FOUND-008 observability | DONE | `900363f`, `733e72f` | unit 19 (redaction T1 patterns) | pino + prom-client 15.1.3 |
| FOUND-009 CI | TODO | — | — | |
| FOUND-010 contracts | TODO | — | — | |
| FOUND-011 deploy scripts | TODO | — | — | staging deploy blocked until HOST-001/003/005 |
| FOUND-012 audit chain | DONE | `4d0bff5` | unit 5, integration 10 (T15 tamper, CLI) | `pnpm verify-audit-chain [--full]` |
| FOUND-013 idempotency + rate limits | DONE | `991cf0a`, `5a1de2d` | integration 6 + HTTP 6 | DB-backed; interceptor + guard in http-kit |
| JOB-001…JOB-007 job queue | PROVISIONAL (HOST-003/005) | `991cf0a`, `a441fb8`, `dd0c7f0` | unit 14, integration 27 + worker 5 | two runners, crash reclaim, poison → dead letter, outbox exactly-once, TTL cleanup, runner modes |
| ID-003a localization | DONE | `96fe04f` | unit 33 | BD mobile E.164, Bangla digits, locale, Asia/Dhaka |

## 3. Test summary (latest full run)

| Suite | Count | Engines |
|---|---|---|
| unit + architecture | 200 | — |
| integration + security | 85 | mariadb:10.6 ✔, mariadb:11.4 ✔ |

## 4. Open HOST items

All HOST-001…013 are pending the human run of `docs/implementation/runbooks/HOST-VERIFICATION-RUNBOOK.md`
(harness task in progress). DB-dependent tasks stay PROVISIONAL until HOST-001, HOST-003 and HOST-005 pass.

## 5. Human action queue

| # | Action | Why | Blocking |
|---|---|---|---|
| H-1 | Create a GitHub repository and push `main` (no remote is configured locally) | CI cannot run until the workflows reach GitHub | CI evidence for checkpoints |

## 6. Deviations

| ID | Deviation | Reason | Follow-up |
|---|---|---|---|
| D-01 | Pre-migration dump is a manual gate (`PRE_MIGRATION_DUMP_CONFIRMED=<APP_VERSION>`) | OPS-002 (EncryptedDatabaseDump) is outside Stage 4 | automate in OPS-002 |
| D-02 | `MIGRATION_APPLIED` is written by api/worker on startup, not by migrate-guarded | avoids a `database → audit` dependency cycle | — |
| D-03 | Migration 0014 creates only `integrity_chain_checkpoints` | `backup_runs`/`restore_drills` belong to OPS tasks | later OPS migration |
| D-04 | `@testcontainers/mariadb` instead of `@testcontainers/mysql` | native MariaDB module; TECHNOLOGY-STACK updated | — |
| D-05 | `tooling/*` workspace for the ESLint plugin (and the seed) | keeps tools out of `packages/` contexts | — |
| D-06 | `apps/host-probe` replaces worker diagnostics endpoints | HOST probes need scratch tables and a dedicated probe DB; the worker stays minimal | — |
| D-07 | Runner mode names follow the docs (`worker`/`embedded`/`cron`/`off`) instead of the prompt's "dedicated/cron-kick" | docs precede the prompt wording (BUILD-CONTRACT precedence) | — |
| D-08 | MinIO runs under a compose profile | object storage is out of Stage 4 scope | — |
| D-09 | No git remote; branches are squash-merged locally | repository hosting is a human action (H-1) | — |
| D-10 | `packages/http-kit` added (C-36); `nestjs-pino` not used (C-37); `TRUST_PROXY_HOPS` (C-38) | see audit rows | — |
