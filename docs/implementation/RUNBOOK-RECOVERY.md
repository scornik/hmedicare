# Runbook — account recovery and restore drills

Two operator procedures, both run on the host by someone who already has shell and database access.
Neither grants a privilege that person did not already have; both make an irreversible operation
reviewed, audited and hard to do by accident.

---

## 1. Owner password reset (OPS-001)

**When.** Nobody can sign in. The installation's only account is locked out, the deployed password-reset
notifier is a no-op (D-18), and there is no other way in.

**What it does.** Sets a new password on one user, revokes every session and refresh token for that user,
bumps `token_version` so access tokens already issued stop working, and writes an audit row naming the
operator and the backup it verified.

**What it does not do.** It does not close gate **G-1**. G-1 asks for a recovery path a *user* can reach;
this one needs SSH. Whether that is sufficient is the owner's decision, not the script's — the status
document records the gate as still open.

### Procedure

```bash
# 1. Take a fresh dump first. The reset revokes every session, and you want a point to return to.
#    The guarded migration writes one automatically on deploy; if the last is older than 24 h, take one.

# 2. Run once with no --confirm. Nothing changes; it prints a token.
cd ~/domains/<domain>/hbuilds/current/nodejs
set -a; . ../../config/.env; set +a
export PRE_MIGRATION_DUMP_DIR=~/hmedic-db-dumps
pnpm ops:reset-owner-password --email owner@example.invalid

# 3. Re-run within 15 minutes with the token it printed.
pnpm ops:reset-owner-password --email owner@example.invalid --confirm <token>
```

The new password is printed once, to that terminal. It is generated on the host, never read from a flag
(a password in a flag lands in shell history and in `ps` for every other process), and never written to a
file or a log. Sign in and change it.

### Why it is awkward on purpose

| Guard | Reason |
|---|---|
| Two invocations with a token | A destructive command that works on the first try is one that works by accident. The token is derived from the email and the quarter-hour, so repeating the command is not enough — you have to have read the first output. |
| Refuses without a dump in the last 24 h | If you have the wrong installation open, revoking every session is disruptive and hard to undo. A backup makes "I was sure this was staging" recoverable. Override with `--allow-stale-dump` only if you accept restoring to that older point. |
| Password generated, not supplied | Keeps it out of shell history and `ps`. |
| Every session revoked | If the account was lost because somebody else holds it, leaving their session alive defeats the exercise. |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. Password printed once. |
| 2 | Usage: missing `--email` or `DATABASE_URL`. |
| 3 | No confirmation token, or the wrong one. Nothing changed. |
| 4 | No dump directory, no dump, or the newest dump is too old. Nothing changed. |
| 5 | No user with that email. Nothing changed. |

---

## 2. Restore drill (OPS-002)

**When.** Before trusting a backup, and before gate **G-4** can be recorded. A backup nobody has restored
is not a backup — DEPLOY-002 automated *taking* the dump, which removed the step people forget; this is
the step people never do.

**What it does.** Creates a throwaway database, restores a dump into it, and checks that what came back
matches what the manifest said went in: table count, row count, and the migration state. Then drops it.

**What it never does.** Touch the source database. The target must be named `restore_drill_*` and cannot
be the source; a target that does not look disposable is refused outright, because restoring over a live
database is the accident this exists to prevent rather than cause.

### Procedure

```bash
# The application user cannot CREATE DATABASE, and should not be able to. Use an operator credential.
export RESTORE_DRILL_DATABASE_URL='mariadb://<operator>:<password>@<host>:3306/<any-db>'

pnpm ops:restore-drill --dump ~/hmedic-db-dumps/pre-migration-production-<version>-<stamp>.sql.gz
```

A pass looks like this:

```json
{
  "event": "RESTORE_DRILL_PASSED",
  "manifest": { "tables": 60, "rows": 13 },
  "restored": { "tables": 60, "rows": 13, "migrations": 13, "statements": 138, "lines": 1632 },
  "problems": []
}
```

`--keep` leaves the restored database in place for inspection; remember to drop it afterwards.

### What it checks, and why each one

| Check | What it catches |
|---|---|
| sha256 against the manifest | A dump altered or truncated since it was written. |
| Table count against the manifest | A restore that silently stopped part-way. |
| Row count against the manifest | A restore that ran every statement but wrote nothing, which a table count alone would pass. |
| `_prisma_migrations` non-empty | A restore that lost the migration state. This looks completely healthy until the next deploy tries to re-apply every migration onto a full database. |
| Statements vs lines | A dump with a multi-line statement the line-oriented reader would split. |

### Recording the result

A drill against a **production** dump is the evidence gate G-4 asks for, and it stays a human action
(H-6/G-4). Record the JSON output with the date and the dump it used. A drill against a development dump
proves the mechanism works; it does not prove the production backup is restorable.
