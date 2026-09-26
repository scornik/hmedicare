# Deployment Contract

**Stage 3.1 rewrite (2026-09-17).** Target: **Hostinger Cloud Startup** (ADR-013). Evidence: `HOSTING-VERIFICATION.md`.

**Stage 3.2 update (2026-09-17):** provider secrets and rotation (Zaman IT, aamarPay, provider KEK), payment callback URLs and App Links, production gates, medicine dataset staging (§9).

## 1. Topology

See ADR-013 §1 for the diagram.

| Environment | Where | Data |
|---|---|---|
| Development | local Docker Compose (MariaDB, MinIO, mock providers) | synthetic |
| Staging | Hostinger same plan: `api-staging`, `worker-staging`, `app-staging` apps; DB `hmedic_staging`; storage `~/hmedic-storage/staging` (disk adapter) | **synthetic only** |
| Production | Hostinger: `api`, `worker`, `app` apps; DB `hmedic_prod`; storage S3 adapter (or disk if HOST-007 passes) | real, only after production gates |

Region: **India** data center (HOST-009). DNS: `app.`, `api.`, `worker.`, plus the staging equivalents. SSL comes from Hostinger's automatic certificates.

## 2. Hostinger app configuration (per app)

> **Stage 6 (ADR-023): production runs the single-app profile.** One Node app on the domain serves the web
> client at `/`, the API under `/api/v1`, `/health/*` and `/internal/*`, and embeds the job runner
> (`JOB_RUNNER_MODE=embedded`). Set `WEB_DIST_DIR=apps/web/dist` and leave `CORS_ALLOWED_ORIGINS` empty — the
> client is same-origin and needs no grant, and a `localhost` entry is now refused in a deployed
> environment. `WEB_DIST_DIR` must be an **absolute** path — Passenger starts the process in the home
> directory, not the application root — for example
> `/home/<user>/domains/<domain>/hbuilds/current/nodejs/apps/web/dist`, where `current` is a stable
> symlink that survives releases. Leave hPanel's *Output directory* empty and the *Entry file* at
> `apps/api/dist/main.js`: the single app is the API process, which also serves the client. The build command is the root `build`, which produces `apps/web/dist` alongside the server
> bundles. The three-app table below remains the reference for splitting them apart again, which is a
> configuration change: unset `WEB_DIST_DIR`, set `CORS_ALLOWED_ORIGINS`, and build the client with
> `VITE_API_BASE_URL`.

| Setting | api / api-staging | worker / worker-staging | app / app-staging |
|---|---|---|---|
| Type | Node.js web app | Node.js web app | Static (Vite) |
| Git branch | `production` / `staging` | `production` / `staging` | `production` / `staging` |
| Root/subfolder | repository root (monorepo), app entry `apps/api` | root, entry `apps/worker` | `apps/web` |
| Node version | 24.x | 24.x | 24.x (build only) |
| Build command (npm script) | `hostinger:build:api` | `hostinger:build:worker` | `hostinger:build:web` |
| Entry file | `apps/api/dist/main.js` | `apps/worker/dist/main.js` | output `apps/web/dist` |
| Env vars | ENVIRONMENT-CONTRACT (api column) | ENVIRONMENT-CONTRACT (worker column) | `VITE_*` only |

The subfolder/monorepo mechanics are confirmed by HOST-002/HOST-008. If Hostinger cannot build a pnpm workspace subfolder, the fallback is a CI-produced deploy branch per app (`deploy/api-production` etc.) containing a `pnpm deploy --filter` output with a self-contained `package.json`, pushed by the promotion workflow. Hostinger then builds from that branch.

## 3. Build scripts (root `package.json`)

```text
hostinger:build:api     = pnpm install --frozen-lockfile && turbo run build --filter=@hmedic/api... && pnpm db:migrate:guarded

> **The build command must start with `node`, not `pnpm`** (2026-09-26):
>
> ```
> hostinger:build:api = node scripts/host/ensure-pnpm.mjs && pnpm install --frozen-lockfile && turbo run build --filter=@hmedic/api... && pnpm db:migrate:guarded
> ```
>
> A command whose first token is `pnpm` cannot bootstrap pnpm. That is what broke the deploy of
> `5e07e95`: the build image's corepack is 0.34.0 (the one bundled with Node 24.6.0), which records
> pnpm's entry point as `bin/pnpm.cjs`. pnpm 12 ships `bin/pnpm.mjs` instead, so corepack downloaded
> 12.4.2 successfully and then died with `MODULE_NOT_FOUND` on a path that was never in the tarball.
> Earlier deploys survived only because corepack fell back to pnpm 11.8.0, which warned about the
> version mismatch (`devEngines.packageManager.onFail: "warn"`) and carried on.
>
> `node scripts/host/ensure-pnpm.mjs` runs before any pnpm exists, activates the pinned version, and
> writes the entry-point stub corepack is looking for (`scripts/host/corepack-repair.mjs`). On an image
> with a current corepack it finds nothing to do. The real fix is a newer corepack on the build image;
> this keeps deploys working until then.
>
> **Do not switch the project to npm.** It was suggested as a workaround and it does not apply here:
> 209 `package.json` entries use the `workspace:*` protocol, which npm cannot resolve, and
> `pnpm-lock.yaml` (`lockfileVersion: 9.0`) plus its supply-chain verification would be discarded.
hostinger:build:worker  = pnpm install --frozen-lockfile && turbo run build --filter=@hmedic/worker...
hostinger:build:web     = pnpm install --frozen-lockfile && turbo run build --filter=@hmedic/web...
```

- **Migrations run only in the api build** (one place). The worker build never migrates.
- The build duration must stay under Hostinger's 15 min + 15 min limits. `turbo` builds only the dependency graph of the app.

## 4. Database migrations on Hostinger

### 4.1 Guarded migration command (`pnpm db:migrate:guarded`, `packages/database/scripts/migrate-guarded.ts`)

1. Connect with a dedicated connection (1 of the ops budget).
2. `SELECT GET_LOCK('hmedic:migrate:<APP_ENV>', MIGRATION_LOCK_TIMEOUT_SECONDS)`. If not acquired, **exit non-zero** with `MIGRATION_LOCKED` (the build fails, and the previous live version keeps serving). Fallback when `GET_LOCK` is unavailable: a `singleton_locks` lease row.
3. `prisma migrate status`. If nothing is pending → release the lock, exit 0.
4. **Pre-migration dump:** run `EncryptedDatabaseDump` (§6.2) synchronously to `BACKUP_DESTINATION` with tag `pre-migration-<sha>`. If the dump fails → release, **exit non-zero** (no migration without a dump). If the pending migrations include a file flagged `-- contract`, require env `ALLOW_CONTRACT_MIGRATION=<sha>` (set during the approved promotion).
5. `prisma migrate deploy` (Prisma 7 `migrate deploy` with the MariaDB adapter).
6. Verify with `prisma migrate status` clean and the engine-contract "smoke" subset (constraint presence query).
7. `RELEASE_LOCK`; write an audit row (platform chain) `MIGRATION_APPLIED` with migration names, SHA and dump id.

### 4.2 Failure semantics

- **DDL is non-transactional on MariaDB.** A migration failing midway can leave a partial schema. Mitigations:
  - one DDL change per migration file where practical;
  - expand-only migrations that are safe for the running version;
  - the pre-migration dump;
  - a runbook `runbooks/migration-failure.md` (restore the dump to a new DB, or apply a forward fix).
- **Hostinger keeps the previous live version when a build fails**, so the old code keeps running against an expanded (compatible) schema.
- **Two deploys** (e.g. two quick pushes): Hostinger runs one build per site at a time (queue up to 20). Across `api` and `api-staging` the lock names differ. The `GET_LOCK` guard protects against concurrency regardless (T13).

### 4.3 Fallback if the database is unreachable during build (HOST-008)

- Set `MIGRATE_ON_STARTUP=true` on the **worker** app only. The api stays `false`.
- On boot, the worker runs the same guarded script **before** `listen()`. It reports `/health/ready` 503 `migrating`, and exits non-zero on failure, so Hostinger restarts it and the api keeps serving the previous schema-compatible code.
- The api build step must then skip migrations (`HOSTINGER_BUILD_SKIP_MIGRATIONS=true`).

## 5. Health, readiness and job lag

- `GET /health/live`: process up (`bootId`, `version`, `uptimeSeconds`).
- `GET /health/ready`:
  - DB `SELECT 1` ≤ 500 ms;
  - storage adapter probe (`head` on `health/probe`);
  - config validity;
  - worker only: `job_lag_seconds` per queue, `degraded` when above thresholds (notifications 90 s, documents 600 s, ai 600 s), runner heartbeat age, last successful backup age.
  
  Returns 200 `{status:"ok"|"degraded", checks:{…}}` or 503 when the DB or storage is down.
- **hPanel cron (every minute, Custom):** `curl -fsS -m 55 -X POST -H @/home/<user>/.hmedic/cron-<env>.hdr https://worker(.|-staging.)<domain>/internal/jobs/run > /dev/null`. It keeps the worker warm and runs a bounded batch (ADR-015 §7).

## 6. Backups

### 6.1 Layers

| Layer | What | Frequency / retention | Notes |
|---|---|---|---|
| Hostinger plan backups | files + DB | daily (7 days) and weekly (6 weeks) (VERIFIED #20) | Not sufficient alone: same provider, no application-level encryption, Node builds/env coverage unverified, restore granularity limited |
| **App-level encrypted DB dump** | logical dump of the environment database | daily at `BACKUP_DB_DUMP_CRON_UTC` (02:30 Asia/Dhaka) + pre-migration | off-site via `BackupDestinationPort` |
| **App-level file backup** (disk adapter only) | `<STORAGE_DISK_ROOT>/objects` | daily incremental (by `document_versions.created_at` since last run) + weekly full | off-site |
| Secrets | hPanel env values | on change | exported manually into the organization's password manager (not in Git); documented in runbook |

### 6.2 `EncryptedDatabaseDump` job (`packages/backup-adapters/encrypted-dump`)

- No `mysqldump` dependency, since the binary is not guaranteed on the host.
- Streams each table in primary-key order (`SELECT … WHERE id > ? ORDER BY id LIMIT 5000`) inside a consistent snapshot (`START TRANSACTION WITH CONSISTENT SNAPSHOT`, REPEATABLE READ), writes `CREATE TABLE` DDL from `SHOW CREATE TABLE` plus `INSERT` batches.
- Pipes through gzip → AES-256-GCM (`BACKUP_ENCRYPTION_KEY`, random IV, authenticated chunks) → `BackupDestinationPort.put(objectKey)` in multipart streaming. The heap stays bounded by batch size.
- Records a manifest (tables, row counts, SHA-256 of plaintext stream and ciphertext) in `backup_runs`.
- `BackupDestinationPort` adapters: `destination-mock` (local), S3-compatible (same adapter family, **separate bucket and credentials from document storage**; provider = external decision).

### 6.3 Retention

`BACKUP_RETENTION_DAILY=14`, `WEEKLY=8`, `MONTHLY=12` via a destination lifecycle job. Pre-migration dumps are kept 30 days. These are defaults pending legal retention research.

### 6.4 Restore drill (monthly; mandatory before first production data and before each contract migration)

1. Download the latest encrypted dump (and the file backup if the disk adapter is used) to an operator workstation.
2. Decrypt with the key (operator-held, never on the workstation disk unencrypted beyond the session).
3. Start local `mariadb` of the **same series** via Docker Compose (`infrastructure/docker/restore-compose.yaml`).
4. Restore (`pnpm ops:restore-dump --file … --target local`).
5. Run `pnpm ops:verify-restore`:
   - row counts vs manifest;
   - `VerifyAppendOnlyChains`;
   - composite FK check;
   - `prisma migrate status` equals the recorded migration set;
   - sample document checksum verification against the restored `document_versions`.
6. Record a `restore_drills` row via `POST /internal/ops/restore-drills` (platform operator; audited) with results. Delete local restored data.

Also test a Hostinger plan backup restore into Docker (HOST-010) once per quarter.

## 7. Secrets and key rotation

| Secret | Rotation procedure |
|---|---|
| JWT signing key | Add a new `kid` to `JWT_VERIFICATION_KEYS`, switch `JWT_SIGNING_*`, remove the old key after `JWT_ACCESS_TTL_SECONDS` × 2 |
| `AI_CREDENTIAL_KEK` | ADR-017 §4 (previous KEK env + `ReencryptAICredentials` job + verification + removal) |
| `PHI_FIELD_KEK`, `PUSH_TOKEN_KEK` | same pattern with their re-encrypt jobs |
| Peppers (refresh, OTP, rate limit, fingerprint) | refresh pepper change forces re-login (documented); rate-limit pepper change resets counters; fingerprint pepper change requires a recompute job (duplicate detection only) |
| Internal tokens | generate new, update hPanel env and the cron header file, verify, done |
| `BACKUP_ENCRYPTION_KEY` | new key id for new dumps; old key retained (offline) until the last dump using it expires |
| `ZAMANIT_API_KEY` (Stage 3.2) | Regeneration invalidates the old key **immediately**, so OTP fails until the new key is live. Runbook `runbooks/zamanit-key-rotation.md`: (1) off-peak window (02:00–04:00 Asia/Dhaka); (2) regenerate in the dashboard; (3) update hPanel env for `api` and `worker` and set `ZAMANIT_API_KEY_ISSUED_ON` (the save triggers a redeploy); (4) verify with `CheckSmsBalance` on demand; (5) audit `SMS_KEY_ROTATED`. Every ≤ 90 days, and immediately on suspicion (balance-drop alert) |
| `AAMARPAY_PLATFORM_SIGNATURE_KEY` (Stage 3.2) | New key from aamarPay support; update hPanel; verify with a random-id Search Transaction (`VALID`); audit. Doctor-owned keys: the doctor replaces the credential in `/settings/payments` |
| `PROVIDER_CREDENTIAL_KEK` (Stage 3.2) | Same pattern as `AI_CREDENTIAL_KEK` (`_PREVIOUS` env + `ReencryptProviderCredentials` job + verification + removal) |
| `SHORT_LINK_PEPPER` (Stage 3.2) | Rotation invalidates outstanding short links (they expire in ≤ 7 days); schedule accordingly |

Every rotation is audited (platform chain) and follows the runbook `runbooks/secret-rotation.md`.

## 8. Deployment gates

A release is blocked on any of:
- failed migration guard;
- failed authorization or tenant tests;
- secret scan finding;
- critical vulnerability;
- failed staging smoke;
- stale restore drill;
- unhealthy worker backlog after deploy (`degraded` > 15 min);
- HOST verification missing (first production release);
- (Stage 3.2) SMS enabled in production with an `http://` base URL and no valid `GATE-SMS-HTTP` decision (startup refuses);
- `PAYMENTS_PLATFORM_COLLECTION_ENABLED=true` in production without a valid `GATE-PAY-PLATFORM-COLLECTION` decision (startup refuses);
- `PAYMENTS_ENABLED=true` in production before PAY-014 is recorded;
- `MEDICATION_IMPORT_PRODUCTION_ALLOWED=true` without the four attestations for the target version (import refuses).

## 9. Stage 3.2 provider operations

- **aamarPay callback URLs:** `https://api.<domain>/api/v1/payments/aamarpay/return/{intentId}/{success|fail|cancel}` (set per request).
  - The IPN listener `https://api.<domain>/api/v1/payments/aamarpay/ipn` is registered with aamarPay technical support **per store**: the platform store by Hakeemify, doctor stores by each doctor (documented in the merchant setup screen).
  - Staging uses `api-staging.<domain>` with sandbox stores.
- **App Links / Universal Links:** `app.<domain>/.well-known/assetlinks.json` and `apple-app-site-association` are shipped in `apps/web/public/.well-known/` (static site; `.htaccess` serves them with `application/json`). HOST-012 verifies they are reachable.
- **Egress:** the worker and api reach `103.89.240.228:80` (Zaman IT) and `sandbox.aamarpay.com`/`secure.aamarpay.com:443`. HOST-009 records reachability and the egress IP (for Zaman IT allow-listing, ZAMANIT-VER-10/16).
- **Gate decisions:** recorded only by `pnpm ops:record-risk-decision --gate <GATE> --env production --owner <name> --evidence <ref> --expires <date>`, run by the accountable owner with DB access. Each decision is audited and expires (alert 14 days before).
- **Medicine dataset staging:**
  - `s3`: `pnpm meddata:stage --dir <dataset dir> --env staging` (operator credentials from the operator's shell, not committed);
  - `disk`: SFTP to `<STORAGE_DISK_ROOT>/platform/medicine-datasets/<version>/`;
  - then `POST /admin/medications/imports`. Production follows only after the gates (ADR-020).
