# Developer Walkthrough — running, seeding and testing HMedicare locally

Everything needed to get a working local installation, log in as a doctor or a patient, see the app in
a real browser and on a phone emulator, and reset it all when it drifts.

`LOCAL-DEVELOPMENT.md` is the contract — what the services are and why. This is the walkthrough.

Every command here was run against this repository. Where something is a trap, it says so.

---

## 1. One-time setup

| Need | Version | Where it is pinned |
|---|---|---|
| Node | **24.21.0** | `.nvmrc` |
| pnpm | **11.8.0** | `package.json` → `packageManager` |
| Docker | Compose v2 | — |
| Flutter (mobile only) | **3.44.8** | `mobile/.fvmrc` |

If `corepack enable` is refused because you lack admin rights, activate the pinned pnpm without it:

```bash
node scripts/host/ensure-pnpm.mjs
```

Install, generate a local `.env`, and start the containers:

```bash
pnpm install
```

```bash
node scripts/generate-local-secrets.mjs
```

```bash
pnpm infra:up
```

`generate-local-secrets.mjs` writes `.env` with fresh peppers, an Ed25519 JWT key pair and KEKs. It
refuses to overwrite an existing `.env`; pass `--force` if you mean to. `pnpm infra:up` starts MariaDB
on `127.0.0.1:3306` and the provider mocks on `4010`, and waits for their health checks.

Then create the schema and the demo data:

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

---

## 2. Logins

The seed generates a random password per account. In development and test it also writes them to
`.local/dev-credentials.json` (gitignored), so you can read them back at any time:

```bash
pnpm db:credentials
```

If you ever need new passwords, `pnpm db:seed --rotate-passwords` replaces them all and re-records them.

### Staff and doctors — email + password

| Role | Login | Use it for |
|---|---|---|
| `doctor` | `dr.a1@example.invalid` | The main demo doctor: chambers, queue, consultations |
| `doctor` | `dr.a2@example.invalid` | A second doctor, for coverage and cross-doctor checks |
| `doctor (solo owner)` | `dr.b1@example.invalid` | The second tenant — use it to prove tenant isolation |
| `tenant_owner` | `owner.a@example.invalid` | Clinic and membership administration |
| `clinic_admin` | `admin.a@example.invalid` | Chambers, schedules, staff |
| `nurse` | `nurse.a@example.invalid` | Scoped clinical access (no assignment) |
| `receptionist` | `reception.a@example.invalid` | Queue desk: check-in, call, skip |
| `billing_manager` | `billing.a@example.invalid` | Billing surfaces |
| `platform operator` | `operator@example.invalid` | Platform routes, including `medication.import` |

The passwords are in `pnpm db:credentials`. Emails are all `@example.invalid`, a reserved domain that
can never resolve — nothing here can accidentally email a real person.

### Patients — phone + OTP, no password

| Patient phone |
|---|
| `+8801700000101` |
| `+8801700000102` |
| `+8801700000103` |
| `+8801700000104` |

Patients have no password. Enter the phone number, then read the code:

```bash
pnpm dev:otp
```

That prints the code for the most recent challenge. It works only when `APP_ENV` is `development` or
`test`. The API also exposes `GET /internal/test/otp/:challengeId` in those environments, which is what
the integration tests use.

### The platform operator needs a second step

Platform routes (`POST /admin/medications/imports`, `POST /tenants`) require **all** of:

- an operator account holding the permission — the seeded one has `medication.import`,
  `platform.tenants.bootstrap`, `ops.jobs.replay`, `ops.metrics.read`, `ops.sms.read`;
- a session with **both** password *and* OTP (step-up) — a password-only session is refused;
- the header `X-Platform-Context: operator`, and **no** `X-Tenant-ID` (the two are mutually exclusive).

Every platform request writes a `PLATFORM_REQUEST` audit row on the platform chain, whether it succeeds
or is denied.

---

## 3. What the seed contains

Two tenants, so tenant isolation is testable rather than assumed:

- **`demo-chamber-group`** — a group practice with the full staff list above.
- **`demo-solo-practice`** — a solo doctor (`dr.b1`).

Chamber days in `CLOSED`, `OPEN` and `SCHEDULED`, with a recorded delay on today's day, and serials
covering every status a receptionist actually sees:

`BOOKED` · `CONFIRMED` · `CHECKED_IN` · `WAITING` · `CALLED` · `SKIPPED` · `IN_CONSULTATION` ·
`COMPLETED` · `NO_SHOW` · `CANCELLED` · `RESCHEDULED`

The day is deliberately left **mid-consultation**: one serial in `IN_CONSULTATION`, several still
waiting, one `CONFIRMED` patient who has not turned up. A dataset where every serial is terminal shows
nothing about the queue board.

Clinical data includes completed consultations, one with an amended note, one with a diagnosis that was
voided and replaced, and an interrupted encounter.

Check the seed is intact at any time:

```bash
pnpm db:seed:verify
```

---

## 4. The medication catalog

The seed inserts only a handful of clearly synthetic `DEMO-` catalog rows. The real ~50,000-product
Stage M dataset is a separate, opt-in step:

```bash
pnpm meddata:import --dir tools/medicine-data/dist/medicine-dataset-20260917-4
```

That takes roughly 70–90 seconds and writes 50,214 medications (732 veterinary products are excluded by
policy). Re-running it is a no-op — the version is already imported — so add `--force` to genuinely redo
the work, or `--dry-run` to verify checksums and count lines without writing anything.

See where everything stands, including which dataset-card gates are attested:

```bash
pnpm meddata:status
```

**All four gates are open and production imports are refused.** That is the designed state:
`medicine-dataset-20260917-4` is `UNVERIFIED`, and attesting a gate is a person recording a review they
actually performed, through the audited operator route — never a CLI. Free-text prescribing is built to
work against an empty catalog, so nothing is blocked by this.

To exercise the operator path rather than the CLI, stage the dataset where the server reads it:

```bash
pnpm meddata:stage --dir tools/medicine-data/dist/medicine-dataset-20260917-4 --root ./.local/storage
```

Then set `STORAGE_DISK_ROOT=./.local/storage` in `.env`, restart, and call
`POST /api/v1/admin/medications/imports {"datasetVersion":"medicine-dataset-20260917-4"}` as the
platform operator. The import runs as a background job on the `catalog` queue, so the worker must be
running (`pnpm dev`, or `pnpm dev:api` alone which runs jobs embedded).

---

## 5. Running it

```bash
pnpm dev
```

| Process | URL | Notes |
|---|---|---|
| API | http://localhost:3000 | `JOB_RUNNER_MODE=off` — the worker owns the job loop |
| Worker | http://localhost:3001 | Runs the job loop, including catalog imports |
| Web | http://localhost:5173 | Vite, strict port |

Running `pnpm dev:api` on its own instead puts the job runner *inside* the API (`embedded`), which is
simpler when you are not testing worker behaviour.

### In a real browser

Open **http://localhost:5173**. It redirects to `/login`, which has two tabs — **staff** (email +
password) and **patient** (phone + OTP). The interface is Bangla-first with an English toggle.

Health endpoints, useful when something looks wrong:

```bash
curl -s http://localhost:3000/health/ready
```

`db: ok` and `sessionMode: ok` mean the database is reachable and the ADR-014 per-connection session
init applied. `realPatientDataAllowed: false` is correct and expected locally.

### On a mobile emulator

Two apps: `mobile/apps/doctor_app` and `mobile/apps/patient_app`.

```bash
pnpm mobile:bootstrap
```

Start an Android emulator, then:

```bash
cd mobile/apps/doctor_app && flutter run
```

**The networking trap.** The app defaults to `http://10.0.2.2:3000`. That is the Android emulator's
loopback to your host — inside the emulator, `localhost` means the emulator itself, not your machine.
The default is already right for a standard Android emulator.

For a **physical device**, point it at your machine's LAN address:

```bash
flutter run --dart-define=API_BASE_URL=http://192.168.1.50:3000
```

On an **iOS simulator**, `http://localhost:3000` works directly, because the simulator shares the host's
network.

---

## 6. Testing

| Command | Covers | Needs Docker |
|---|---|---|
| `pnpm test:unit` | Pure logic across packages, apps, tooling, scripts | no |
| `pnpm test:architecture` | Dependency-cruiser rules and ESLint rule fixtures | no |
| `pnpm test:integration` | Everything against a real MariaDB, on **both** pinned series | yes |
| `pnpm test:security` | The security suite | yes |
| `pnpm test:e2e` | Playwright against the built web app with a mocked API | no |
| `pnpm mobile:test` | Flutter tests | no |

Integration tests use Testcontainers and start their **own** MariaDB — they never touch your dev
database, so you can run them while `pnpm dev` is up.

Narrow to one file while iterating:

```bash
node scripts/test/run-integration.mjs packages/prescriptions/test/integration/medication-import-job.test.ts
```

Pin a single engine series to roughly halve the time:

```bash
MARIADB_IMAGES=mariadb:11.8 node scripts/test/run-integration.mjs packages/prescriptions/test/integration
```

### The full gate

The same twenty checks CI runs — static analysis, both MariaDB series, Playwright, and the Flutter
suite:

```bash
node scripts/checkpoint-verify.mjs
```

Two things it will not forgive, both learned the hard way:

- **It requires a clean, committed working tree, and it means it.** Editing files while it runs produces
  a result that describes no tree that ever existed. If you change anything mid-run, throw the result
  away and start again.
- **It saturates the machine** for around twenty minutes — two MariaDB containers, a Playwright browser
  and the Flutter toolchain. Do not run imports or `pnpm dev` against your dev database at the same
  time; connection contention produces failures that pass in isolation and waste an afternoon.

---

## 7. Resetting

| Command | Does | Takes |
|---|---|---|
| `pnpm db:seed` | Re-runs the seed; idempotent, safe any time | seconds |
| `pnpm db:seed --rotate-passwords` | New passwords for every demo account | seconds |
| `pnpm db:reset` | Drops every table, re-migrates, re-seeds | ~30 s |
| `pnpm db:reset:full` | The same, then re-imports the real catalog | ~2 min |

`db:reset` drops **every** table, so the medication catalog goes with everything else.
`db:reset:full` is the one to reach for when you want a complete environment back in one command.

Both are refused unless `APP_ENV` is `development` or `test`.

If the containers themselves are the problem:

```bash
pnpm infra:reset
```

That removes the volumes too, so the database starts genuinely empty — follow it with `pnpm db:migrate`
and `pnpm db:reset:full`.

---

## 8. When something is wrong

| Symptom | Cause |
|---|---|
| `DATABASE_URL is not set` | An older script that did not read `.env`. `db:reset`, `db:seed`, `meddata:*` all read it now; if you hit this elsewhere, `set -a; . ./.env; set +a` first |
| `seed:verify` fails right after a reset | Should not happen. It did until 2026-09-26 (the queue seed consumed the only `CONFIRMED` serial); if it returns, that is a real bug |
| Catalog search returns nothing | The catalog is probably empty — run `pnpm meddata:status` and import if so |
| A production import is refused | Correct. All four dataset-card gates are open; `pnpm meddata:status` names which |
| Mobile app cannot reach the API | Almost always the `10.0.2.2` versus `localhost` distinction — see §5 |
| Integration tests fail but pass alone | Load contention. Stop `pnpm dev` and any import, then re-run |
