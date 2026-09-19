# HOST Verification Runbook (HOST-001 … HOST-013)

**Stage 4 harness.** This runbook is for the account owner or an operator with hPanel access. It proves or disproves the Hostinger assumptions in `HOSTING-VERIFICATION.md` §5 on the **real plan**, using synthetic data and a **dedicated probe database**. Record every result with `pnpm host:record-results` (§4). Until HOST-001, HOST-003 and HOST-005 are recorded as PASS:
- DB-dependent Stage 4 work stays **PROVISIONAL** in `IMPLEMENTATION-STATUS.md`;
- the real API is **not** deployed to staging.

> hPanel menu labels change over time. The steps below name the menu areas descriptively. If a label differs, use the equivalent item and note the difference in the evidence.

## 0. Preparation (local)

1. `pnpm install && pnpm --filter @hmedic/host-probe build`.
2. Generate a probe token (at least 32 characters) and keep it in your password manager. **Never commit it.**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
3. You need an HTTP client that can send an `Authorization` header (for example `curl`).

## 1. hPanel setup (once)

1. **Create the probe database.** hPanel → *Databases → MySQL/MariaDB Databases*:
   - create the database `…_hmedic_probe` and a user `…_probe` with a generated password;
   - grant it **all privileges on this database only**;
   - write down the host and port that hPanel shows for application access.
2. **Create a Node.js app for the probe.** hPanel → *Websites → Add website → Node.js app* (or the Node.js application section of your plan):
   - subdomain `probe-staging.<domain>`;
   - Node **24.x**;
   - source: this repository, root directory `apps/host-probe` (monorepo subfolder);
   - build command `pnpm install --frozen-lockfile && pnpm --filter @hmedic/host-probe build`;
   - start command `node apps/host-probe/dist/main.js` (or `pnpm --filter @hmedic/host-probe start`).
3. **Environment variables** (app → *Environment variables*):
   | Name | Value |
   |---|---|
   | `APP_ENV` | `staging` |
   | `HOST_PROBE_TOKEN` | the token from §0 |
   | `HOST_PROBE_DATABASE_URL` | `mariadb://<probe user>:<password>@<host>:<port>/<probe db>` |
   | `HOST_PROBE_STORAGE_DIR` | leave empty (defaults to `~/hmedic-storage`) |
   | `HOST_PROBE_EGRESS` | `https://generativelanguage.googleapis.com/` plus any provider hosts to check, comma-separated, `https://` only |
   | `NODE_OPTIONS` | the heap budget you intend to use (for example `--max-old-space-size=512`) |
4. Deploy, then open `https://probe-staging.<domain>/health/live`. You should see `{"status":"ok","app":"host-probe","bootId":…}`.

Every probe below uses `-H "Authorization: Bearer $TOKEN"`. Save each JSON answer to a file for §4.

```bash
export PROBE=https://probe-staging.<domain>
export TOKEN='<probe token>'
```

## 2. Probes

| ID | Command | Pass when |
|---|---|---|
| HOST-001 | `curl -s -H "Authorization: Bearer $TOKEN" $PROBE/probe/db > host-001.json` | `pass: true` (MariaDB ≥ 10.6, `utf8mb4_unicode_520_ci` available, ≥ 30 connections) |
| HOST-002 | `curl -s -H "Authorization: Bearer $TOKEN" $PROBE/probe/runtime > host-002.json` | `node24: true`; `heapSizeLimitMb` matches `NODE_OPTIONS`; `modules.argon2 = loaded` |
| HOST-003 | `curl -s -X POST -H "Authorization: Bearer $TOKEN" $PROBE/probe/engine > host-003.json` | `pass: true` (SKIP LOCKED, conditional claim, CHECK, generated unique, JSON + Bangla, lock wait timeout) |
| HOST-004 | `curl -s -X POST -H "Authorization: Bearer $TOKEN" $PROBE/probe/locks > host-004.json` | `getLockExclusive: true` (ALTER/TRIGGER are informational) |
| HOST-005 | Configure the cron in §3, then record `bootId` and `uptimeSeconds` from `/health/live` every few hours for 24 h. Then disable the cron for 2 h and record when `bootId` changes (idle stop). | `bootId` changes only on deploys/crashes while the cron pings |
| HOST-006 | See §3; check the probe's access log timestamps in hPanel → app → *Logs*. | 1-minute interval honoured; `curl` available |
| HOST-007 | `curl -s -X POST -H "Authorization: Bearer $TOKEN" "$PROBE/probe/storage?mode=write"` → redeploy twice → `…?mode=verify > host-007.json`. Then try to fetch `https://probe-staging.<domain>/hmedic-storage/staging/probe.bin` and other plausible public paths. | `matches: true`, and no public URL serves the file |
| HOST-008 | Deploy a staging **worker** with `pnpm hostinger:build:worker` (build logs show `MIGRATION_*` JSON lines). Repeat with a deliberately failing migration on a scratch branch; trigger two deploys back to back. | (a) DB reachable at build, (b) a failed migration keeps the previous version serving, (c) the lock log shows no concurrent migration |
| HOST-009 | From Dhaka broadband and 4G: `curl -o /dev/null -s -w "%{time_total}\n" $PROBE/health/live` 20 times each; then `curl -s -H "Authorization: Bearer $TOKEN" $PROBE/probe/egress > host-009.json`. Then run the SMS-002 provider probe from the staging worker (`pnpm ops:capture-sms-probe`, ZAMANIT-VERIFICATION §3.1) | p95 recorded; all egress targets reachable; SMS-002 capture stored |
| HOST-010 | hPanel → *Backups*: download the latest DB backup and file backup; restore the DB locally (`pnpm infra:up`, then import into a scratch DB of the same MariaDB series); compare row counts; check whether `~/hmedic-storage` is in the file backup. | restore succeeds |
| HOST-011 | `curl -s -X POST -H "Authorization: Bearer $TOKEN" $PROBE/probe/logs`, then open hPanel → app → *Logs*; redeploy and check again. | line visible; the `AIza…` value shows as `[REDACTED]`; note whether logs survive the redeploy |
| HOST-012 | Build with `VITE_API_BASE_URL=https://api.<domain> pnpm --filter @hmedic/web build` (the build copies `web.htaccess` into `dist/.htaccess` with `__API_ORIGIN__` replaced); upload `apps/web/dist/` (including the dotfile) to the `app.<domain>` document root. Then `curl -sI https://app.<domain>/dashboard` and `curl -sI https://app.<domain>/no/such/page`, and reload `/dashboard` in a browser. | both deep links return 200 with `index.html`; CSP (with the API origin in `connect-src`), HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy` present; `index.html` is `no-cache`, hashed assets `immutable`; `.map` files 403. If rewrites are unavailable: fall back to `createHashRouter` (WEB-IMPLEMENTATION §3) and record a deviation |
| HOST-013 | `head -c 8388608 /dev/urandom > 8m.bin`, then `curl -s -X POST -H "Authorization: Bearer $TOKEN" --data-binary @8m.bin $PROBE/probe/limits/body`; `curl -s -H "Authorization: Bearer $TOKEN" "$PROBE/probe/limits/download?mb=50" -o /dev/null -w "%{size_download}\n"`; `curl -s -H "Authorization: Bearer $TOKEN" "$PROBE/probe/limits/slow?seconds=25"`; `curl -s -H "Authorization: Bearer $TOKEN" $PROBE/probe/limits/headers > host-013.json` | all succeed; `forwardedFor`/`forwardedProto` present. Record `remoteAddress` from `host-013.json` (the proxy the app sees) as `TRUST_PROXY` (audit C-48; a CIDR if the proxy fleet is a range) |

## 3. Cron (HOST-005, HOST-006)

hPanel → *Advanced → Cron Jobs* → *Custom*:
- schedule `* * * * *`;
- command:
  ```bash
  curl -fsS -m 50 -X POST -H "Authorization: Bearer <INTERNAL_CRON_TOKEN>" https://worker-staging.<domain>/internal/jobs/run > /dev/null
  ```
  For the probe-only phase, point it at `$PROBE/health/live` (no token) to measure keep-alive.
- **Never put a real token in a file that is committed.** Store the token only in the hPanel cron command field or in a private file readable only by your hosting user (see `STAGING-DEPLOY-RUNBOOK.md`).

## 4. Recording results

For each item:
```bash
pnpm host:record-results --id HOST-001 --result PASS --evidence "MariaDB 10.6.x, 150 max conns" --json host-001.json --by "<your name>"
```
The script appends a dated row to `HOSTING-VERIFICATION.md` §5.1. It removes tokens, passwords, credentials in URLs and phone numbers from the evidence. Then:
1. Commit the doc change on a branch `stage4/HOST-results-<date>`.
2. If a result differs from the ADR default (for example MariaDB 10.5, no `GET_LOCK`, no persistent directory), add an audit row in `ARCHITECTURE-CONSISTENCY-AUDIT.md` and update `IMPLEMENTATION-STATUS.md` "Open HOST items".
3. When HOST-001, HOST-003 and HOST-005 are PASS, change FOUND-004 and JOB-* from PROVISIONAL to DONE in `IMPLEMENTATION-STATUS.md`.

## 5. Teardown

After sign-off:
- delete the probe app, the probe database and user, and the probe cron;
- run `rm -rf ~/hmedic-storage/staging/probe.*` in the hPanel file manager;
- rotate the probe token (it is no longer used).
