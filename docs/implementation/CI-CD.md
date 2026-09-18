# CI/CD Contract

**Stage 3.1 rewrite (2026-09-17).** CI is **GitHub Actions** with every action pinned by full commit SHA (a comment carries the tag). CD is **Hostinger GitHub integration** (build on push) from protected branches (ADR-013).

## 1. Branches

| Branch | Protection | Deploys to |
|---|---|---|
| `main` | PR required; all blocking checks green; 1 approval; linear history | nothing (integration branch) |
| `staging` | fast-forward from `main` via the `promote-staging` workflow only; checks re-run | Hostinger staging apps (`api-staging`, `worker-staging`, `app-staging`) |
| `production` | fast-forward from `staging` via `promote-production` (manual approval environment `production` + required reviewers); checks re-run | Hostinger production apps |

- Direct pushes to `staging`/`production` are blocked.
- Hostinger is configured to deploy each app from its branch and subfolder (`apps/api`, `apps/worker`, `apps/web`) with the build command `hostinger:build` (DEPLOYMENT §3).
- **Staging uses synthetic data only**, with separate database, DB user, storage root and secrets.

## 2. Node and tool versions

`actions/setup-node` (SHA-pinned) with `node-version-file: .nvmrc` (**24.21.0**, the same major as Hostinger's selected "24.x"). Corepack enables pnpm 12.4.2. Flutter comes from `mobile/.fvmrc`. Dart generation uses the same FVM Flutter.

## 3. Pull request workflow (`ci.yml`): blocking jobs

1. **setup**: checkout (SHA), setup-node, corepack, `pnpm install --frozen-lockfile`, turbo cache.
2. **static**: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm depcruise`, architecture rule fixtures.
3. **security-static**: gitleaks (pinned binary + checksum), `pnpm audit --prod --audit-level high`, OSV-Scanner (pinned), license allow-list check.
4. **unit**: `pnpm test:unit`.
5. **db**:
   - service container `mariadb:10.6@sha256:<pinned>` (moves with HOST-001);
   - `pnpm db:migration:lint`;
   - migrate from clean;
   - Prisma client generation;
   - schema snapshot diff;
   - engine-contract suite, including EXPLAIN no-filesort, Bangla round-trip and the Asia/Dhaka boundary.
6. **integration**: MariaDB + MinIO (service containers or Testcontainers); integration, storage-contract (s3 + disk), job-runner and TTL suites.
7. **api**: Supertest suites and OpenAPI response validation.
8. **concurrency**: multi-process serial allocation, lock-wait mapping, reorder vs walk-in, deadlock retry, GET_LOCK runner singleton, two-deploy migration lock (T13).
9. **security-tests**: `pnpm test:security` (T1–T17, tenant isolation, redaction).
10a. **providers (Stage 3.2)**: SMS adapter contract and payment gateway contract against `mock-providers`; payment and medicine-import integration suites; template lint (no PHI placeholders); OpenAPI money-field lint. `SMS_PROVIDER=mock`, `PAYMENT_GATEWAY_ADAPTER=mock`; `undici` `MockAgent.disableNetConnect()` except localhost. **The SMS live smoke (`tests/live-smoke`) and aamarPay sandbox tests are excluded from every workflow** (path filter + `CI=true` abort); no Zaman IT or aamarPay credentials exist in GitHub secrets.
10. **ai**: adapter contract with mock and recorded fixtures, register ↔ metadata test, prompt lock, minimization, worker DI container test. Tests install `undici` `MockAgent` with `disableNetConnect()`, so any real provider call fails the test.
11. **contracts**: `pnpm contracts:generate` then `git diff --exit-code packages/contracts/generated`; TS client compile.
12. **dart-client**: FVM Flutter; `swagger_parser` generation from `openapi.v1.oas30.json` → `build_runner` → `dart analyze`; **plus** a 3.1-input smoke generation (non-blocking warning job if only 3.1 fails).
13. **web**: `pnpm --filter web build` (with the `VITE_*` secret-name check), Vitest component tests, Playwright smoke against the local stack (docker compose in CI).
14. **mobile**: `melos run analyze`, `melos run test`, debug Android build check.

Optional (non-blocking) on PR: full Playwright, Flutter integration tests on emulator (nightly).

## 4. `main` workflow

Re-runs all blocking jobs, plus:
- full Playwright;
- SBOM (CycloneDX) for `apps/api`, `apps/worker`, `apps/web`, retained 90 days;
- `hostinger-build-rehearsal`: runs `pnpm hostinger:build` for each app in a clean container with `NODE_ENV=production` and only the files Hostinger receives (subfolder + workspace deps via `pnpm deploy --filter`), to catch build-command issues before promotion. Migrations run against an ephemeral MariaDB.

## 5. Promotion workflows

### 5.1 `promote-staging` (manual dispatch)

1. Verify the `main` SHA has green checks.
2. Fast-forward `staging` to that SHA.
3. Hostinger builds staging apps; the build step runs guarded migrations against the staging DB (DEPLOYMENT §4).
4. Poll `https://api-staging.<domain>/health/ready` and `https://worker-staging.<domain>/health/ready` until `version == SHA` (timeout 20 min).
5. Run staging smoke tests (`tests/smoke`: login OTP mock, walk-in, queue poll, prescription approve, upload (disk), AI mock draft) with synthetic accounts.
6. On failure: open an incident issue. Hostinger keeps the previous live version if the *build* failed. If the build succeeded but smoke failed, promote a revert commit.

### 5.2 `promote-production` (manual dispatch, `production` environment approval)

Preconditions (checked by the workflow):
- the staging SHA passed smoke tests within 72 h;
- no open critical security findings;
- the latest restore drill passed within 30 days (`restore_drills` via staging diagnostics export) or an explicit waiver;
- HOST-001…HOST-013 results recorded in `HOSTING-VERIFICATION.md` (before the first production release);
- if the release contains a `-- contract` migration: a second approver and a confirmed pre-migration dump.

Steps:
1. Fast-forward `production`.
2. Hostinger builds; the guarded migration takes a pre-migration encrypted dump first.
3. Health polling.
4. Production smoke (read-only checks plus a synthetic health tenant).
5. Record the release in `runs/releases.md` (automated PR).

## 6. Secrets in CI

CI uses only test secrets generated per run (`pnpm secrets:generate-local`). No production or staging secrets exist in GitHub. Hostinger holds environment values in hPanel. The workflow token has `contents: write` only for promotion jobs, and no Hostinger API credentials are stored.

## 7. Release strategy

- Versioned by git SHA. `APP_VERSION` is injected by `hostinger:build`.
- Migrations are expand-only per release; contract migrations ship at least one release after code stops using the old schema.
- Feature flags (`AI_*`, `STORAGE_ADAPTER`, provider selections) gate capabilities per environment.
- **Rollback:** Hostinger keeps the latest two successful builds, but has no one-click rollback, so a revert commit is promoted. Schema is not rolled back; the previous app version must be compatible with the expanded schema (expand/contract rule).
