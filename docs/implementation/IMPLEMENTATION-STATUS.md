# Implementation Status — Stage 4 (Foundation + Tenant/Identity)

Living document for Stage 4 (BUILD-CONTRACT; Stage 4 prompt §8). Updated after every merged task.
Legend:
- **DONE:** merged to `main` with tests.
- **PROVISIONAL:** merged with tests; final only after the listed HOST items or human actions pass.
- **DEFERRED:** out of phase (reason given).
- **BLOCKED:** a human action is required.

## 1. Checkpoint status

| Checkpoint | Scope | Status | Tag |
|---|---|---|---|
| CP1 Foundation | FOUND-*, JOB-*, HOST harness, CI, api/worker shells, SEC suite, seed | PASS (local gates; CI evidence pending H-1, HOST evidence pending H-2) | `stage4-cp1-foundation` |
| CP2 Tenant/Identity | ID-001…ID-007, SMS-001…005/008, web + mobile shells | PASS (local gates; SMS-002 capture and SMS-008 live send are human-run) | `stage4-cp2-identity` |

## 2. Tasks

| Task | Status | Commit(s) | Tests added | Notes |
|---|---|---|---|---|
| FOUND-001 repo + tooling | DONE | `3c015b7` | architecture: depcruise fixtures, ESLint rule tests | pnpm 12.4.2, turbo, ESLint flat + `eslint-plugin-hmedic`, Prettier, pre-commit hook |
| FOUND-002 config | DONE | `fc4b451` (+ SEC, SMS-002) | unit 11 | fail-closed Zod env; refuses `NODE_TLS_REJECT_UNAUTHORIZED=0`; diagnostics refused in production |
| FOUND-003 kernel | DONE | `6a10339` | unit 74 | `SESSION_REVOKED` (C-35) |
| FOUND-004 database | PROVISIONAL (HOST-001/003/005) | `0fbd5b5` | unit 13, integration 22 × 10.6/11.4 | Prisma 7.10.0 + MariaDB adapter |
| FOUND-005 local infra | DONE | `0fbd5b5` | compose healthchecks | MariaDB 10.6 by digest, mock-providers |
| FOUND-006 api shell | DONE | `5a1de2d`, `b83c3e3` | integration 21 | `packages/http-kit` (C-36); no `nestjs-pino` (C-37) |
| FOUND-007 worker shell | DONE | `dd0c7f0` | integration 7 | + SMS-002 diagnostic route (D-17) |
| FOUND-008 observability | DONE | `900363f`, `733e72f` | unit 19 | pino + prom-client |
| FOUND-009 CI | PROVISIONAL (H-1: no GitHub remote yet) | `f5ed321`, `fa6dfb5` | — | SHA-pinned actions, MariaDB 10.6/11.4 matrix by digest, gitleaks, OSV, SBOM, license scans, web + Playwright, mobile analyze/test/drift |
| FOUND-010 contracts | DONE | `b9f4f98`, `e43719f` | unit (contracts) | OpenAPI 3.1 + 3.0, 25 operations, `openapi:check`, TS client (`credentials: 'omit'` default) |
| FOUND-011 deploy scripts | PROVISIONAL (H-1, H-2, H-6) | `2dae83c`, `f90f878`, this branch | unit (build-info) | `hostinger:build:*`, `infrastructure/hostinger/*`, `promote-staging.yml`, `dist/build-info.json` version, `pnpm dev` full stack |
| FOUND-012 audit chain | DONE | `4d0bff5` | unit 5, integration 10 | `pnpm verify-audit-chain [--full]` |
| FOUND-013 idempotency + rate limits | DONE | `991cf0a`, `5a1de2d` | integration 12 | credential routes non-replayable (C-40) |
| Seed (SEED-DATA) | DONE | `b3cdef0` | integration 3 | idempotent, `--verify`, `--rotate-passwords`; commit message mislabels it FOUND-010 |
| SEC suite | DONE | `0fd93e0` | security 10 | tenant isolation over HTTP, composite tenant FKs, internal endpoints (T10/T27), secret leakage (T1/T2/T22) |
| JOB-001…JOB-007 | PROVISIONAL (HOST-003/005) | `991cf0a`, `a441fb8`, `dd0c7f0` | unit 14, integration 32 | two runners, crash reclaim, dead letter, outbox, TTL cleanup, runner modes |
| HOST-001…013 harness | DONE (harness) / verification BLOCKED (H-2) | `0bab249` | integration 4 (host-probe), unit 2 (record-results) | `apps/host-probe`, `pnpm host:record-results`, runbooks; engine probe falls back to `@@tx_isolation` on 10.6 |
| ID-001 tenants/memberships schema | PROVISIONAL (HOST-001/003) | `149f50d` | integration | |
| ID-002 sessions/tokens/password | PROVISIONAL (HOST-001/003) | `8cf7130`, `928c58a` | unit + integration | Argon2id, EdDSA (jose), rotation + reuse detection |
| ID-003 OTP login | PROVISIONAL (HOST-001/003) | `a220a23` | integration | HMAC codes, 180 s TTL, 5 attempts, resend supersedes |
| ID-003a localization | DONE | `96fe04f` | unit 33 | |
| ID-004 CSRF + cookie transport | PROVISIONAL (HOST-012/013) | `8cf7130`, `928c58a` | integration | signed double-submit + Origin; `__Host-` cookies when Secure |
| ID-005 authorization | DONE (5a) / PROVISIONAL (5b) | `b3cdb13`, `928c58a` | unit matrix, integration | `ROLE_PERMISSIONS_VERSION` 2 (C-39) |
| ID-006 memberships/coverages | PROVISIONAL (HOST-001/003) | `149f50d` | integration | |
| ID-007 platform operators | PROVISIONAL (HOST-001/003) | `149f50d` | integration | pwd + OTP step-up, `X-Platform-Context` |
| SMS-001 envelope + vault + gates | PROVISIONAL (HOST-001/003) | `ea8b1dd` | unit + integration | AES-256-GCM, KEK ring, GATE-SMS-HTTP chain |
| SMS-002 free provider probe | PROVISIONAL (H-4: staging capture) | this branch | unit 5, integration 2 | worker `GET /internal/diagnostics/sms-balance` + `pnpm ops:capture-sms-probe` |
| SMS-003 port + mock adapter | DONE | `f0d999a` | unit contract | |
| SMS-004 Zaman IT adapter | PROVISIONAL (parser until SMS-002 fixtures) | `f0d999a` | unit contract 17 | |
| SMS-005 OTP over SMS | PROVISIONAL (HOST-001/003) | `b612e4c` | integration | CheckSmsBalance, ReencryptProviderCredentials |
| SMS-008 live smoke | BLOCKED (H-5, account owner only) | `b612e4c` | aborts on `CI=true` | never run by the agent (no real SMS) |
| WEB-001 web shell | PROVISIONAL (HOST-012, staging deploy) | `79994a4`, `ffa92c4` | unit 4, e2e 4 | in-memory tokens, CSRF refresh, bn/en + Noto Sans Bengali |
| MOB-001 mobile workspace + shells | DONE | `12c6fe6`, `615088c`, `47bcfb7`, `fa6dfb5` | Flutter 13 | Melos 8.7.0, generated Dart client, secure storage, OTP mock login |

Out of Stage 4 scope (not started): patients, chambers, schedules, appointments, queue, clinical, prescriptions, MEDDATA, payments, AI, SMS-006/007/009, communications beyond OTP, MOB-002+ (`hm_offline`), WEB-002+.

## 3. Test summary (latest full run)

| Suite | Count | Notes |
|---|---|---|
| unit | __UNIT__ | Vitest `unit` project (packages, apps, tooling, scripts) |
| architecture | 37 | depcruise + ESLint rule fixtures |
| integration + security | __INT106__ on mariadb:10.6 · __INT114__ on mariadb:11.4 | Testcontainers, `node scripts/test/run-integration.mjs` |
| e2e (Playwright) | 4 | built web app against a mocked API |
| mobile (Flutter) | 13 | `dart run melos run test`; `flutter analyze --fatal-infos` clean |

## 4. Open HOST items

All HOST-001…013 are pending the human run of `docs/implementation/runbooks/HOST-VERIFICATION-RUNBOOK.md` (H-2).
DB-dependent tasks stay PROVISIONAL until HOST-001, HOST-003 and HOST-005 pass. Record results with `pnpm host:record-results`.

## 5. Human action queue

| # | Action | Why | Blocking |
|---|---|---|---|
| H-1 | Create the GitHub repository, push `main` and tags, protect `main`/`staging` | CI has never run on GitHub (no remote) | CI evidence; FOUND-009/011 |
| H-2 | Run the HOST verification runbook on the Hostinger plan and record results | HOST-001…013 evidence | PROVISIONAL → DONE for DB tasks; staging deploy |
| H-3 | Pin the gitleaks tarball SHA-256 in `ci.yml` (today it is checked against the release checksums file) | supply-chain hardening | — |
| H-4 | SMS-002 capture on staging (`pnpm ops:capture-sms-probe`, ZAMANIT-VERIFICATION §3.1) with the owner's Zaman IT key | fixtures for the adapter parser; ZAMANIT-VER-01/02 | SMS-004 final |
| H-5 | SMS-008: exactly one live SMS by the account owner (ZAMANIT-VERIFICATION §4) | charge/format evidence | SMS-008 |
| H-6 | Staging setup: DB, three Hostinger apps, env vars, repository variables `STAGING_API_URL`/`STAGING_WORKER_URL`/`STAGING_WEB_URL`, `staging` environment | first staging deploy via `promote-staging` | after H-1, H-2 |
| H-7 | Native-speaker review of the Bangla UI strings (web `messages.ts`, mobile `strings.dart`) | copy quality | — |

## 6. Deviations

| ID | Deviation | Reason | Follow-up |
|---|---|---|---|
| D-01 | Pre-migration dump is a manual gate (`PRE_MIGRATION_DUMP_CONFIRMED=<APP_VERSION>`) | OPS-002 is outside Stage 4 | automate in OPS-002 |
| D-02 | `MIGRATION_APPLIED` is written by api/worker on startup, not by migrate-guarded | avoids a `database → audit` cycle | — |
| D-03 | Migration 0014 creates only `integrity_chain_checkpoints` | `backup_runs`/`restore_drills` belong to OPS | later OPS migration |
| D-04 | `@testcontainers/mariadb` instead of `@testcontainers/mysql` | native MariaDB module | — |
| D-05 | `tooling/*` workspace for the ESLint plugin and the seed | keeps tools out of `packages/` | — |
| D-06 | `apps/host-probe` holds the HOST diagnostics (amended by D-17) | probes need scratch tables and a dedicated DB | — |
| D-07 | Runner mode names follow the docs (`worker`/`embedded`/`cron`/`off`) | BUILD-CONTRACT precedence | — |
| D-08 | MinIO runs under a compose profile | object storage is out of Stage 4 | — |
| D-09 | No git remote; tasks merged locally (fast-forward of task-scoped commits, split per the 600-line rule) | H-1 | squash policy applies once PRs exist |
| D-10 | `packages/http-kit` (C-36); no `nestjs-pino` (C-37); `TRUST_PROXY_HOPS` (C-38) | see audit rows | — |
| D-11 | The dev OTP inbox (`/internal/test/otp/:id`) is enabled in `development` as well as `test` | `pnpm dev` OTP login without SMS | never in staging/production (config-guarded) |
| D-12 | Seed uses `@example.invalid` (prompt) instead of `@example.test` (SEED-DATA) | Stage 4 prompt precedence | align SEED-DATA wording |
| D-13 | `ResponseMeta.replayed` is `boolean` (was literal `true`) | swagger_parser emits a broken enum for boolean enums | server behaviour unchanged |
| D-14 | Mobile pins below latest: `go_router` 17.5.0, `build_runner` 2.15.1, `retrofit_generator` 10.2.9 | newer versions need a Flutter newer than 3.44.8 (FVM pin) | revisit with the next Flutter pin |
| D-15 | `hm_offline` (Drift, outbox, uploads) not created | MOB-002 scope | MOB-002 |
| D-16 | Bangla font: web bundles `@fontsource/noto-sans-bengali` (OFL-1.1, font-only license exception); mobile uses the platform Noto Sans Bengali | no font CDN; mobile bundle size | bundle a font in mobile if iOS rendering needs it |
| D-17 | The worker exposes one diagnostic route (`/internal/diagnostics/sms-balance`, SMS-002), off by default and refused in production | the SMS-002 spec requires the probe from the staging worker (egress proof) | — |
| D-18 | Password reset uses a no-op notifier in deployed environments | the email adapter is out of Stage 4 | email adapter stage |
| D-19 | Local Playwright may use an installed browser (`PW_CHANNEL=msedge`); CI installs the pinned bundled Chromium | no browser download on the dev machine | — |
| D-20 | `/me/patient-contexts` returns `[]` until patients exist | Stage 5 | Stage 5 |
| D-21 | `apps/web` re-implements the `VITE_*` secret-name check instead of importing `packages/config` | dependency rule `web-only-contracts-and-ui` | — |
