# Queue Concurrency Design (MariaDB)

**Stage 3.1 rewrite (2026-09-17).** Engine: MariaDB (ADR-014), with the 10.6 feature set. Locking behavior was proven locally (`HOSTING-VERIFICATION.md` §3.2).

## 1. Locking model

- **Isolation:** `READ COMMITTED` for every queue transaction (Prisma `isolationLevel: 'ReadCommitted'`). Under READ COMMITTED, InnoDB releases locks on rows that do not match the WHERE clause, but **keeps** locks on every matching row it scanned. Lock queries therefore use primary-key lookups (`lockRow`) or indexes that avoid scanning unrelated rows.
- **Lock order** (always):
  1. `chamber_days` row(s) by id;
  2. `serials` rows by id;
  3. `encounters`;
  4. the chain checkpoint row.
  
  Because every queue command locks the chamber day first, commands on the same day serialize, and commands on different days never contend.
- **Tokens:**

  | Token | Role |
  |---|---|
  | `chamber_days.next_serial_number` | Allocation counter only |
  | `chamber_days.queue_order_version` | Reorder, delay and policy conflicts |
  | `chamber_days.row_version` | Administrative day edits |
  | `serials.row_version` | Per-serial transition conflicts |

- **Timeouts:** session `innodb_lock_wait_timeout = DB_LOCK_WAIT_TIMEOUT_SECONDS` (default 5); Prisma transaction `timeout` 5,000 ms, `maxWait` 2,000 ms.
- **Retries:** errors 1205 (lock wait timeout) and 1213 (deadlock) retry the whole transaction up to `DB_TX_RETRY_MAX` (3) with full-jitter backoff (25–200 ms), then return `QUEUE_BUSY`.
- **Nothing slow inside locks:** no notification, video, PDF, AI or storage call inside a queue transaction.

## 2. Walk-in race

```mermaid
sequenceDiagram
  participant A as Receptionist A
  participant B as Receptionist B
  participant API1 as API process 1
  participant API2 as API process 2
  participant DB as MariaDB

  A->>API1: IssueWalkInSerial(day D, key KA)
  B->>API2: IssueWalkInSerial(day D, key KB)
  API1->>DB: BEGIN (READ COMMITTED); INSERT idempotency KA IN_PROGRESS
  API2->>DB: BEGIN (READ COMMITTED); INSERT idempotency KB IN_PROGRESS
  API1->>DB: SELECT ... FROM chamber_days WHERE id=D AND tenant_id=T FOR UPDATE
  DB-->>API1: lock granted (next_serial_number=N)
  API2->>DB: SELECT ... FROM chamber_days WHERE id=D AND tenant_id=T FOR UPDATE
  Note over API2,DB: API2 waits (<= innodb_lock_wait_timeout)
  API1->>DB: UPDATE next_serial_number=N+1; INSERT serial N (CHECKED_IN->WAITING, pos P+1); INSERT queue_events x3, audit, outbox; UPDATE idempotency KA COMPLETED
  API1->>DB: COMMIT
  DB-->>API2: lock granted (next_serial_number=N+1)
  API2->>DB: UPDATE next_serial_number=N+2; INSERT serial N+1 (pos P+2); events; idempotency KB COMPLETED
  API2->>DB: COMMIT
  API1-->>A: 201 serial N
  API2-->>B: 201 serial N+1
```

If API2's wait exceeds the lock timeout (error 1205), it rolls back and retries. The idempotency insert rolls back too, so a retry is clean. After `DB_TX_RETRY_MAX` attempts it returns `503 QUEUE_BUSY`, and the client retries with key KB.

## 3. Lost response

```mermaid
sequenceDiagram
  participant M as Mobile/Web
  participant API as API
  participant DB as MariaDB

  M->>API: IssueWalkInSerial(Idempotency-Key K, body hash H)
  API->>DB: BEGIN; INSERT idempotency (K, H, IN_PROGRESS); lock day; allocate N; insert serial; events
  API->>DB: UPDATE idempotency K COMPLETED (snapshot of serial N); COMMIT
  API--xM: response lost (timeout / network drop / process idle-stop after commit)
  M->>API: retry same K, same body
  API->>DB: INSERT idempotency (K, H) -> 1062 duplicate
  API->>DB: SELECT idempotency WHERE tenant_scope, scope, K
  DB-->>API: COMPLETED, request_hash H, snapshot N
  API-->>M: 201 serial N, meta.replayed=true
  M->>API: retry K with different body H2
  API-->>M: 422 IDEMPOTENCY_KEY_REUSED
```

If the process dies **before** commit, nothing persists (the idempotency row is in the same transaction), so a retry allocates normally.

## 4. Call/skip race

```mermaid
sequenceDiagram
  participant D as Doctor
  participant R as Receptionist
  participant API as API
  participant DB as MariaDB

  D->>API: CallSerial(S, expectedRowVersion=4, key K1)
  R->>API: SkipSerial(S, expectedRowVersion=4, key K2)
  API->>DB: BEGIN; lock day D; lock serial S
  DB-->>API: S status WAITING, row_version 4
  API->>DB: UPDATE status=CALLED, row_version=5, recall_deadline_at; queue_event CALLED; outbox; COMMIT
  API-->>D: 200 CALLED (rowVersion 5)
  API->>DB: BEGIN; lock day D; lock serial S
  DB-->>API: S status CALLED, row_version 5
  API->>DB: ROLLBACK (no mutation, no event, idempotency row not kept)
  API-->>R: 409 STALE_VERSION (current: CALLED, rowVersion 5)
  Note over R: UI reloads; receptionist may now SkipSerial with rowVersion=5 (valid edge CALLED->SKIPPED)
```

If the receptionist had sent `expectedRowVersion=5` but the serial had moved to a state where skip is invalid (e.g. `IN_CONSULTATION`), the response is `409 QUEUE_STATE_CONFLICT`.

## 5. Reorder race (with concurrent walk-in)

```mermaid
sequenceDiagram
  participant M as Manager
  participant R as Receptionist
  participant API as API
  participant DB as MariaDB

  Note over DB: Day D queue_order_version=7; WAITING: S1(pos1) S2(pos2) S3(pos3)
  M->>API: ReorderQueue(D, expectedQueueOrderVersion=7, [S3, S1])
  R->>API: IssueWalkInSerial(D, key KW)
  API->>DB: [walk-in] BEGIN; lock day D; next_serial_number++; insert S4 WAITING pos4; COMMIT
  Note over DB: queue_order_version still 7 (walk-in appends, does not reorder)
  API->>DB: [reorder] BEGIN; lock day D (version 7 == expected); lock S1,S3 by id
  API->>DB: positions {1,3} sorted -> S3=1, S1=3; S2 stays 2; S4 stays 4
  API->>DB: queue_event QUEUE_REORDERED; queue_order_version=8; COMMIT
  API-->>M: 200 order S3,S2,S1,S4 (version 8)
  M->>API: ReorderQueue(D, expectedQueueOrderVersion=7, [S2, S3])  (stale tab)
  API->>DB: BEGIN; lock day D (version 8 != 7); ROLLBACK
  API-->>M: 409 QUEUE_VERSION_CONFLICT (current order, version 8)
```

## 6. Deadlock retry

The lock order (§1) prevents deadlocks between queue commands. Two sources remain possible:
- (a) cross-context transactions that touch queue tables in a different order, which is forbidden by the lock-order lint (`hmedic/lock-order` checks `lockRow` call order against the declared table ranking in `packages/database/src/lock-ranking.ts`);
- (b) InnoDB gap or next-key locks on secondary-index inserts.

The retry path handles both.

```mermaid
sequenceDiagram
  participant T1 as Tx 1 (API process 1)
  participant T2 as Tx 2 (API process 2)
  participant DB as MariaDB

  T1->>DB: BEGIN; lock row X
  T2->>DB: BEGIN; lock row Y
  T1->>DB: request lock on Y (waits)
  T2->>DB: request lock on X
  DB-->>T2: ERROR 1213 Deadlock found (victim T2 rolled back)
  DB-->>T1: lock on Y granted; T1 continues; COMMIT
  T2->>T2: withTransaction catches 1213; attempt 2 after jitter (25-200 ms)
  T2->>DB: BEGIN; lock X; lock Y; ...; COMMIT
  Note over T2: after DB_TX_RETRY_MAX failures -> QUEUE_BUSY (503, Retry-After: 1); metric db_tx_retry_exhausted_total
```

## 7. Invariants and tests

**Invariants:**
- Unique serial number per chamber day (`uq_serials_number`).
- No duplicate non-terminal serial for the same patient/day without an audited override (`uq_serials_active_patient_day`, generated column).
- One non-error encounter per serial (`uq_encounters_serial`).
- Only valid transition edges; every mutation has exactly one audit event and one or more queue events, and the outbox row is in the same transaction.
- Notifications are post-commit and never decide queue truth.

**Mandatory tests** (Vitest + Testcontainers `@testcontainers/mysql` 12.1.0 **with the pinned `mariadb` image digest**; the MySQL module speaks the same protocol, and the image is overridden):

| Test | Setup | Assertion |
|---|---|---|
| **Two API processes allocate serials concurrently** | Start two real `apps/api` Node processes (child processes, separate Prisma pools) against one MariaDB container; fire 200 walk-in requests (100 per process, distinct keys, same chamber day) with `Promise.all` | 200 serials; serial numbers exactly `1..200` with no gaps or duplicates; `next_serial_number=201`; 200 `SERIAL_ISSUED` events; queue positions unique |
| Same key ×10 across both processes | 10 concurrent requests, same key and body, split across processes | exactly 1 serial; 9 responses `replayed=true` or `IDEMPOTENCY_IN_PROGRESS` followed by replay on retry |
| **Lock-wait timeout mapping** | Hold `FOR UPDATE` on the chamber day from a raw connection for 8 s; set `DB_LOCK_WAIT_TIMEOUT_SECONDS=1`, `DB_TX_RETRY_MAX=2`; issue a walk-in | 503 `QUEUE_BUSY` with `Retry-After`; no serial; no idempotency row; metric incremented |
| Deadlock retry | Test-only use case that locks rows in reverse order in two transactions with a barrier | one transaction retries and both commit; retry metric = 1 |
| Call/skip race | Barrier-synchronized call and skip at the same `expectedRowVersion` | exactly one transition, one `STALE_VERSION`; one event |
| **Reorder not invalidated by concurrent walk-in** | Barrier: reorder at version V and walk-in on the same day | reorder succeeds; new serial at the last position; `queue_order_version=V+1` |
| Stale reorder | Two reorders with the same V | one success, one `QUEUE_VERSION_CONFLICT` |
| Duplicate active serial | Two concurrent walk-ins for the same patient/day, different keys | one 201, one `DUPLICATE_ACTIVE_SERIAL` |
| **Bangla patient name round-trip** | Create a patient `legal_name_bn = "মোছাঃ রহিমা খাতুন"` (NFC) and a walk-in; read the queue staff view | name bytes equal; ordering unaffected |
| **Asia/Dhaka day boundary with DATETIME UTC** | Chamber day local date 2026-09-17 (Asia/Dhaka); simulate clock `2026-09-16T18:05:00Z` (00:05 local) for walk-in and `2026-09-17T18:05:00Z` (00:05 next local day) for no-show policy | walk-in allowed (day open on local date); no-show job cut-offs computed in local time; no serial attributed to 2026-09-16 |
| Idle-stop resilience | Kill an API process after COMMIT, before responding; retry via the other process | replay returns the original serial |
| Claim-query EXPLAIN | `EXPLAIN` job and outbox claim queries | no `Using filesort` |
