# Staging Deploy Runbook (human-run)

**Stage 4.** Deploys `api-staging`, `worker-staging` and `app-staging` on Hostinger from the `staging` branch with **synthetic data only**. Nothing in this runbook touches production. **Never push to `production` and never deploy to production from Stage 4.**

**Precondition — do not skip.** The real API is deployed to staging only after HOST-001, HOST-003 and HOST-005 are recorded as PASS (`HOSTING-VERIFICATION.md` §5.1). Until then, only the host probe (`HOST-VERIFICATION-RUNBOOK.md`) runs on the plan.

## 1. One-time setup

1. **GitHub.** Create the repository, push `main`, and create the `staging` branch from a green `main` commit. Protect `main` (required CI checks) and `staging` (pushes by the promotion workflow only). Do **not** create a `production` branch yet.
2. **Database.** hPanel → *Databases*: create `…_hmedic_staging` with its own user (all privileges on that DB only). Keep the credentials in your password manager.
3. **Secrets.** Generate staging secrets locally and paste them into hPanel (never commit them):
   ```bash
   node scripts/generate-local-secrets.mjs --env staging --print
   ```
   KEK ids must start with `staging-` (the config refuses reused ids).
4. **Apps.** hPanel → *Websites → Node.js apps* (per `DEPLOYMENT.md` §2):
   | App | Branch | Build command | Entry |
   |---|---|---|---|
   | `api-staging.<domain>` | `staging` | `pnpm hostinger:build:api` | `apps/api/dist/main.js` |
   | `worker-staging.<domain>` | `staging` | `pnpm hostinger:build:worker` | `apps/worker/dist/main.js` |
   | `app-staging.<domain>` (static) | `staging` | `pnpm hostinger:build:web` | output `apps/web/dist` |
5. **Environment variables.** Follow the api and worker columns of `ENVIRONMENT-CONTRACT.md`. Staging essentials:
   - `APP_ENV=staging`, `DATABASE_URL`, `CORS_ALLOWED_ORIGINS=https://app-staging.<domain>`, `TRUST_PROXY` (the proxy address from HOST-013; leave empty until recorded);
   - api `JOB_RUNNER_MODE=off`, worker `JOB_RUNNER_MODE=worker` (or `cron` if HOST-005 showed idle stops);
   - `SMS_PROVIDER=mock`, `OTP_PROVIDER=mock` (staging is synthetic; no Zaman IT key on staging unless an owner-approved SMS-002 probe is running).
6. **Cron.** Upload `infrastructure/hostinger/cron/kick-worker.sh` to `~/hmedic-ops/` and create the token file (mode 600) as shown in the script header. Then add the hPanel Custom Cron `* * * * *`.

## 2. Each staging deploy

1. Confirm CI is green on the `main` commit you want to promote.
2. **Migrations.** The api build runs `pnpm db:migrate` (guarded, `GET_LOCK`). On staging, a pre-migration dump is confirmed manually until OPS-002 (deviation D-01):
   - hPanel → *Databases → phpMyAdmin / Backups*: export `…_hmedic_staging`;
   - set `PRE_MIGRATION_DUMP_CONFIRMED=<APP_VERSION>` on the api app for this deploy only.
3. Fast-forward `staging` to the green commit. Use the **`promote-staging`** workflow (*Actions → promote-staging → Run*, optional `sha`); it needs the repository variables `STAGING_API_URL`, `STAGING_WORKER_URL` and `STAGING_WEB_URL` and a `staging` environment. It refuses non-green or non-`main` SHAs and never force-pushes. It then waits until `/health/live` reports `version == SHA`. The build writes `dist/build-info.json` from `git rev-parse HEAD`. If the Hostinger build has no git metadata, set `APP_VERSION=<sha>` in hPanel for that deploy. Finally it runs the Stage 4 smoke checks and opens an issue on failure.
4. Watch the build logs:
   - `MIGRATION_SKIPPED` / `MIGRATION_APPLIED` JSON lines;
   - exit code 3 (`MIGRATION_LOCKED`) or 4 (`PRE_MIGRATION_DUMP_REQUIRED`) means the deploy stopped safely and the previous version keeps serving.
5. **Verify:**
   ```bash
   curl -s https://api-staging.<domain>/health/ready
   curl -s https://worker-staging.<domain>/health/ready
   curl -s -H "Authorization: Bearer <INTERNAL_METRICS_TOKEN>" https://worker-staging.<domain>/internal/metrics | grep job_lag_seconds
   ```
6. **Seed** (synthetic, staging only, from a trusted shell with `DATABASE_URL` for staging): `pnpm db:seed`. The printed demo passwords go to your password manager, never into chat or tickets.
7. **Chain check:** `DATABASE_URL=… pnpm verify-audit-chain --full` must print `"broken":0`.
8. Remove `PRE_MIGRATION_DUMP_CONFIRMED` from the api app after the deploy.

## 3. Rollback

- **Code.** Re-point `staging` to the previous green commit and redeploy.
- **Schema.** Migrations are expand-only; the previous code runs on the expanded schema. For a broken migration, restore the pre-migration dump into a **new** database, switch `DATABASE_URL`, and write a forward fix (`DEPLOYMENT.md` §4.2).

## 4. What is never done here

- Deploying to production or creating/pushing the `production` branch.
- Real patient data, real phone numbers, real provider keys on staging.
- `ZAMANIT_LIVE_SMOKE=true` on staging, except for the single SMS-008 run by the account owner (see `ZAMANIT-VERIFICATION.md` §4).
