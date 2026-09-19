# Database Implementation Contract

**Stage 3.1 rewrite (2026-09-17)** for **MariaDB** (Hostinger, ADR-014), job queue in DB (ADR-015), per-doctor AI (ADR-017).
**Stage 3.2 update (2026-09-17):** platform operators, gate decisions and generalized provider credentials (ADR-018/019), SMS (ADR-018), payments and subscriptions (ADR-019), medication catalog import (ADR-020).
**Evidence:** every engine construct used here was proven on `mariadb:10.6.28` and `mariadb:11.4.13` (`HOSTING-VERIFICATION.md` §3).

---

## 1. Conventions

### 1.1 Types (shorthand used in §3)

| Shorthand | SQL | Prisma | Notes |
|---|---|---|---|
| `id36` | `VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin` | `String @db.VarChar(36)` | Application-generated **UUIDv7** via `packages/kernel` `newId()`. Never `CHAR`: MariaDB rejects CHAR sources in generated columns |
| `code(n)` | `VARCHAR(n) CHARACTER SET ascii COLLATE ascii_bin` + table-level `CHECK (col IN (…))` | `String @db.VarChar(n)` | Enum. The Zod enum is the source of truth; CI asserts CHECK list == Zod values |
| `key(n)` | `VARCHAR(n) CHARACTER SET ascii COLLATE ascii_bin` | `String @db.VarChar(n)` | Machine keys, hashes, idempotency keys |
| `text(n)` | `VARCHAR(n) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci` | `String @db.VarChar(n)` | Human text (Bangla allowed), case-insensitive comparisons |
| `longtext` | `TEXT` (utf8mb4, ≤ 65,535 bytes) or `MEDIUMTEXT` where stated | `String @db.Text` | Clinical narrative sections; length validated in application (default 20,000 chars) |
| `ts` | `DATETIME(3)` | `DateTime @db.DateTime(3)` | **UTC always.** Session `time_zone='+00:00'` |
| `date` | `DATE` | `DateTime @db.Date` | Local calendar dates only (chamber day, DOB, due dates) |
| `tz` | `VARCHAR(64) ascii_bin` | `String` | IANA zone, default `Asia/Dhaka` |
| `json:<Schema>` | `JSON` (= `LONGTEXT` + `JSON_VALID` CHECK) | `Json` | Validated with the named Zod schema on write **and** read. Never used for business filtering |
| `bool` | `TINYINT(1) NOT NULL DEFAULT 0` | `Boolean` | |
| `int` / `bigint` | `INT` / `BIGINT` (unsigned where noted) | `Int` / `BigInt` | |
| `money` | `DECIMAL(12,2)` | `Decimal @db.Decimal(12,2)` | BDT, non-negative amounts. Serialized as decimal **strings** in APIs/events; arithmetic in kernel `Money` (integer paisa, `bigint`). **`FLOAT`/`DOUBLE`/`REAL` are forbidden for money** (`db:migration:lint` + `hmedic/no-float-money`) |
| `smoney` | `DECIMAL(14,2)` | `Decimal @db.Decimal(14,2)` | Signed ledger amounts (BDT) |
| `hash64` | `VARCHAR(64) ascii_bin` | `String` | Hex SHA-256 / HMAC-SHA-256 |

### 1.2 Tables, charsets and naming

- Every table: `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci`. Tables are plural `snake_case`, columns `snake_case`, Prisma models singular PascalCase with `@@map`, and JSON DTO fields camelCase.
- **Standard columns** (tenant-owned mutable tables):
  - `id id36 PK`
  - `tenant_id id36 NOT NULL` + `UNIQUE (tenant_id, id)` (target of composite FKs)
  - `created_at ts NOT NULL`, `updated_at ts NOT NULL`
  - `created_by_user_id id36 NULL`, `updated_by_user_id id36 NULL`
  - `row_version INT UNSIGNED NOT NULL DEFAULT 1`
- **`row_version` vs `revision` (resolves C-06):**
  - **`row_version`** is optimistic locking only. Every update is `UPDATE … SET …, row_version = row_version + 1 WHERE id = ? AND tenant_id = ? AND row_version = ?`; 0 rows affected → `STALE_VERSION` (or the context-specific conflict code). Clients send it as **`expectedRowVersion`**.
  - **`revision`** is a clinical/business version that users see and that is referenced by audit and documents (signed note revision, prescription revision, document file revision). It is never used as a concurrency token.
  - No table has a bare column named `version`.
- **Soft delete:** `deleted_at ts NULL` only on operational tables that document it (appointments drafts, clinics, chambers). Clinical records use status/void/redaction, never `deleted_at`.
- **Append-only tables:** no `updated_at`, no `row_version`, no `deleted_at`. Repositories expose insert/read only. Hash-chained where listed (§5).

### 1.3 Migrations

- Prisma Migrate 7.10.0 generates SQL. **Every migration file is post-processed** by `pnpm db:migration:normalize`, which:
  - sets table charset/collation;
  - converts `id`/FK/key columns to `ascii_bin`;
  - appends generated columns, table-level CHECKs and composite FKs from `packages/database/sql/constraints/<table>.sql`.
  
  `pnpm db:migration:lint` fails CI if any of these are missing.
- **Naming:** `YYYYMMDDHHMM_<nnnn>_<context>_<change>`. The logical sequence numbers in §2 are the `<nnnn>` part. They identify content, not apply order: files are created in backlog order (for example 0015 in Phase 2b before 0004), and the timestamp prefix determines the apply order. A migration may only reference tables created by migrations that exist earlier in backlog order.
- **Forward-only.** DDL is non-transactional on MariaDB, so every migration must be **expand-compatible** with the currently running app (ADR-014). Destructive changes live in a separate `-- contract` migration shipped in a later release.
- **No triggers, stored procedures, events or `DEFINER` clauses** (Hostinger restriction; HOSTING-VERIFICATION #7). `db:migration:lint` rejects `CREATE TRIGGER|PROCEDURE|FUNCTION|EVENT` and `DEFINER`.
- **Generated columns** are declared only in constraint SQL, omitted from the Prisma schema, and never written by the application.

### 1.4 Transactions and locks

- `packages/database/src/tx.ts`: `withTransaction(fn, { isolation: 'ReadCommitted' | 'RepeatableRead', timeoutMs, maxWaitMs, retry: { max: DB_TX_RETRY_MAX, on: [1205, 1213] } })`.
- `packages/database/src/locks.ts`: `lockRow`, `lockRows` (stable id order), `acquireNamedLock` (`GET_LOCK`) / `releaseNamedLock`, `singletonLease` fallback. **The only place `FOR UPDATE` and `GET_LOCK` appear** (ESLint `hmedic/no-raw-sql`).
- `packages/database/src/claims.ts`: job and outbox claim SQL (ADR-015).
- **Error mapping** (`packages/database/src/errors.ts`):

  | Engine error | Maps to |
  |---|---|
  | 1062 duplicate key | `UniqueViolation{constraint}`, mapped per use case (e.g. `uq_serials_active_patient_day` → `DUPLICATE_ACTIVE_SERIAL`) |
  | 1451/1452 FK | `ReferenceViolation` → usually `RESOURCE_NOT_FOUND` or `TENANT_MISMATCH` (500 plus alert if tenant composite FK fails) |
  | 4025 CHECK | `ConstraintViolation` → `VALIDATION_FAILED` (plus alert: the application should have rejected it first) |
  | 1205 / 1213 | retry, then `QUEUE_BUSY` (queue contexts) or `CONCURRENCY_RETRY_EXHAUSTED` |

---

## 2. Migration sequence

| # | Migration | Tables |
|---|---|---|
| 0001 | `platform_jobs` | `singleton_locks`, `jobs`, `dead_letters`, `job_concurrency_leases`, `rate_limit_counters` |
| 0002 | `identity_tenants` | `tenants`, `users`, `tenant_memberships`, `clinics`, `doctor_profiles`, `staff_profiles`, `doctor_coverages`, `audit_logs`, `outbox_events`, `idempotency_records` |
| 0003 | `auth_sessions` | `sessions`, `refresh_tokens`, `otp_challenges`, `password_reset_tokens`, `email_verification_tokens`, `push_devices` |
| 0004 | `patient_identity` | `patients`, `patient_search_tokens` (Stage 5, C-41), `patient_contacts`, `patient_identifiers`, `patient_consents`, `patient_merge_cases`, `patient_accounts`, `patient_guardianships`, `care_team_members` |
| 0005 | `scheduling` | `chambers` (+ payment modes, Stage 3.2), `doctor_schedule_rules`, `chamber_days`, `appointment_slots`, `appointments` (+ `PENDING_PAYMENT`, hold and waiver columns, Stage 3.2). Created in Stage 5 (`202609191236_0005_scheduling`) |
| 0006 | `queue` | `serials`, `check_ins`, `queue_events`. Created in Stage 5 (`202609191237_0006_queue`) |
| 0007 | `encounters` | `encounters`, `encounter_participants`, `encounter_notes`, `encounter_note_versions` |
| 0008 | `clinical_catalog` | `symptom_observations`, `diagnoses`, `medications`, `medication_generics`, `medication_generic_links`, `medication_manufacturers`, `medication_aliases`, `medication_price_observations`, `medication_usage_stats`, `medication_dataset_imports`, `medication_dataset_gate_attestations`, `patient_medications` (catalog redesigned in Stage 3.2, ADR-020) |
| 0009 | `prescriptions` | `prescriptions`, `prescription_items` |
| 0010 | `documents_labs` | `documents`, `document_versions`, `upload_sessions`, `upload_session_parts`, `lab_reports`, `lab_results` |
| 0011 | `timeline_followup` | `timeline_events`, `projection_checkpoints`, `follow_up_plans`, `follow_up_tasks` |
| 0012 | `communication_telemedicine` | `communications`, `communication_attempts` (+ SMS columns, Stage 3.2), `communication_preferences`, `provider_webhook_events`, `communication_short_links`, `telemedicine_sessions`, `telemedicine_participants` |
| 0013 | `ai` | `tenant_ai_policies`, `tenant_ai_policy_events`, `ai_data_use_acknowledgements`, `ai_provider_credentials`, `ai_credential_fallbacks`, `ai_model_catalog`, `ai_usage_counters`, `ai_usage_ledger`, `ai_jobs`, `ai_transcripts`, `ai_drafts`, `ai_suggestions`, `ai_approvals`; `ALTER TABLE diagnoses ADD ai_approval_id` + composite FK |
| 0014 | `operations_integrity` | `integrity_chain_checkpoints`, `backup_runs`, `restore_drills`; maintenance indexes proven by query plans |
| 0015 | `platform_credentials` | `platform_operators`, `platform_gate_decisions`, `provider_credentials` (Stage 3.2; created in Phase 2b) |
| 0016 | `sms` | `sms_balance_snapshots` (Stage 3.2, ADR-018) |
| 0017 | `payments` | `tenant_payment_settings`, `payment_merchant_accounts`, `fee_schedules`, `payment_intents`, `payment_attempts`, `payment_gateway_events`, `payment_verifications`, `ledger_entries`, `refunds`, `payouts`, `payout_items` (Stage 3.2, ADR-019) |
| 0018 | `subscriptions` | `subscription_plans`, `subscriptions`, `subscription_invoices` (Stage 3.2, ADR-019) |

**Billing:** payments and platform subscriptions are MVP since Stage 3.2 (ADR-019 supersedes audit row S3-13). Insurance, claims and complex invoicing remain Future, with no tables.

---

## 3. Tables

Notation: `FK→t(tenant_id,id)` means a composite tenant FK `(tenant_id, <col>) REFERENCES t(tenant_id, id)`. `FK→t(id)` means a simple FK (global table). Standard columns (§1.2) are implied as "std" and not repeated.

### 3.1 Platform and jobs (0001)

**`singleton_locks`** (global): `name key(128) PK`, `holder key(128) NOT NULL`, `lease_expires_at ts NOT NULL`, `updated_at ts`. Fallback for `GET_LOCK` (ADR-015 §7).

**`jobs`** (tenant nullable; not std):
- `id id36 PK`, `tenant_id id36 NULL`, `queue key(64)`, `type key(96)`, `payload json:JobPayload.<type>` (IDs/enums only)
- `status code(24)` CHECK `QUEUED|RUNNING|WAITING_RATE_LIMIT|SUCCEEDED|FAILED|CANCELLED|DEAD`
- `priority SMALLINT NOT NULL DEFAULT 100`, `run_at ts`, `attempts INT NOT NULL DEFAULT 0`, `max_attempts INT NOT NULL DEFAULT 8`
- `concurrency_key key(128) NULL`, `locked_by key(128) NULL`, `locked_at ts NULL`, `lease_expires_at ts NULL`
- `last_error_class key(64) NULL`, `idempotency_key key(191) NULL`, `correlation_id id36`, `causation_id id36 NULL`
- `created_at`, `updated_at`, `finished_at ts NULL`
- Unique: `uq_jobs_queue_idem (queue, idempotency_key)`
- Indexes: `ix_jobs_claim (queue, status, priority, run_at)` (**must** serve `ORDER BY priority, run_at` without filesort; EXPLAIN test); `ix_jobs_reclaim (status, lease_expires_at)`; `ix_jobs_tenant (tenant_id, created_at)`; `ix_jobs_concurrency (concurrency_key, status)`
- CHECK: `attempts >= 0 AND max_attempts > 0`

**`dead_letters`**: `id id36 PK`, `job_id id36 UNIQUE`, `tenant_id id36 NULL`, `queue`, `type`, `payload json:JobPayload.<type>`, `attempts INT`, `last_error_class key(64)`, `failed_at ts`, `replayed_at ts NULL`, `replayed_by_user_id id36 NULL`, `replay_job_id id36 NULL`. Index `(queue, failed_at)`.

**`job_concurrency_leases`**: `concurrency_key key(128)`, `slot_no SMALLINT`, PK `(concurrency_key, slot_no)`; `job_id id36 UNIQUE`, `lease_expires_at ts`. CHECK `slot_no >= 1`.

**`rate_limit_counters`**: `scope key(64)`, `subject_hash hash64`, `window_start ts`, `window_seconds INT`, `count INT UNSIGNED NOT NULL`, `expires_at ts`; PK `(scope, subject_hash, window_start)`; index `(expires_at)`. `subject_hash = HMAC-SHA-256(RATE_LIMIT_PEPPER, subject)`, never raw phone or IP.

### 3.2 Identity, tenants, audit, outbox, idempotency (0002)

**`tenants`** (global root; not tenant-scoped std):
- `id id36 PK`, `name text(200) NOT NULL`, `slug key(80) UNIQUE`
- `status code(16)` CHECK `ACTIVE|SUSPENDED|CLOSED`
- `practice_type code(16)` CHECK `SOLO|GROUP` DEFAULT `GROUP`
- `owner_doctor_profile_id id36 NULL` (FK added after `doctor_profiles`; required when `SOLO`, CHECK `practice_type <> 'SOLO' OR owner_doctor_profile_id IS NOT NULL`)
- `default_locale key(20) DEFAULT 'bn-BD'`, `default_timezone tz DEFAULT 'Asia/Dhaka'`
- `created_at`, `updated_at`, `row_version`

**`users`** (global):
- `id id36 PK`, `email text(254) NULL`, `email_normalized key(254) NULL` (NFKC + lowercase, ASCII punycode domain; UNIQUE), `phone_e164 key(20) NULL` UNIQUE, `display_name text(120) NULL`
- `status code(16)` CHECK `ACTIVE|LOCKED|DISABLED`
- `password_hash key(255) NULL` (Argon2id encoded string; null for OTP-only users)
- `password_changed_at ts NULL`, `email_verified_at ts NULL`, `phone_verified_at ts NULL`, `last_login_at ts NULL`
- `token_version INT UNSIGNED NOT NULL DEFAULT 1` (bumps revoke all access tokens)
- `created_at`, `updated_at`, `row_version`
- CHECK `email_normalized IS NOT NULL OR phone_e164 IS NOT NULL`

**`tenant_memberships`** (std):
- `user_id FK→users(id)`
- `role code(24)` CHECK `tenant_owner|clinic_admin|doctor|nurse|receptionist|billing_manager`
- `permissions json:MembershipPermissionOverrides` (`{"grants":[],"denials":[]}` validated against the catalog)
- `clinic_ids json:IdArray`, `chamber_ids json:IdArray` (scope; empty = per-role default)
- `status code(16)` CHECK `INVITED|ACTIVE|SUSPENDED|REMOVED`
- `role_permissions_version INT NOT NULL` (version of the code constant at last change)
- UNIQUE `(tenant_id, user_id)`; index `(tenant_id, role, status)`

**`clinics`** (std): `name text(200)`, `name_normalized_hash hash64`, `sms_display_name text(40) NULL` (Stage 3.2: neutral name used in SMS templates; defaults to `name`), `address json:Address`, `timezone tz NULL`, `locale key(20) NULL`, `status code(16)` CHECK `ACTIVE|INACTIVE`, `deleted_at ts NULL`. Generated `active_name_key = IF(status='ACTIVE' AND deleted_at IS NULL, name_normalized_hash, NULL)`; UNIQUE `uq_clinics_active_name (tenant_id, active_name_key)`.

**`doctor_profiles`** (std): `user_id FK→users(id)`, `display_name text(120)`, `display_name_bn text(120) NULL`, `registration_body text(80) NULL`, `registration_number text(40) NULL`, `specialties json:StringArray`, `status code(16)` CHECK `ACTIVE|INACTIVE`. UNIQUE `(tenant_id, user_id)`. FK `tenants.owner_doctor_profile_id` → `doctor_profiles(tenant_id,id)` composite via `(id, owner_doctor_profile_id)` (added in the same migration after table creation).

**`staff_profiles`** (std): `user_id FK→users(id)`, `title text(80)`, `status code(16)`. UNIQUE `(tenant_id, user_id)`.

**`doctor_coverages`** (std):
- `covered_doctor_profile_id FK→doctor_profiles(tenant_id,id)`, `covering_doctor_profile_id FK→doctor_profiles(tenant_id,id)`
- `starts_at ts`, `ends_at ts`, `reason text(300)`
- `status code(16)` CHECK `ACTIVE|REVOKED`, `granted_by_user_id id36`
- CHECK `ends_at > starts_at`, CHECK `covered_doctor_profile_id <> covering_doctor_profile_id`
- Index `(tenant_id, covering_doctor_profile_id, status, starts_at, ends_at)`
- Overlap is allowed (multiple coverers). The maximum duration `COVERAGE_MAX_DAYS` (default 30) is validated in the application.

**`audit_logs`** (append-only, hash-chained; tenant nullable for platform/auth events):
- `id id36 PK`, `tenant_id id36 NULL`, `seq BIGINT UNSIGNED NOT NULL` (per `chain_key`), `chain_key key(64)` (`tenant:<id>` or `platform`)
- `actor_user_id id36 NULL`, `actor_type code(16)` CHECK `USER|SYSTEM|PATIENT_CONTEXT|OPERATOR`, `acting_as code(16) NULL` CHECK `SELF|GUARDIAN`, `on_behalf_of_patient_id id36 NULL`
- `action key(96)`, `resource_type key(64)`, `resource_id id36 NULL`
- `outcome code(16)` CHECK `SUCCESS|DENIED|FAILED`
- `request_id id36 NULL`, `correlation_id id36 NULL`
- `ip_hash hash64 NULL`, `user_agent_hash hash64 NULL`
- `metadata json:AuditMetadata` (redacted; **never secrets, never PHI values**)
- `role_permissions_version INT NULL`
- `occurred_at ts`
- `prev_row_hash hash64 NULL`, `row_hash hash64 NOT NULL`
- UNIQUE `(chain_key, seq)`; indexes `(tenant_id, resource_type, resource_id, occurred_at)`, `(tenant_id, actor_user_id, occurred_at)`
- Written in the same transaction as the audited change via `AuditPort`. Sequence allocation locks the chain head row in `integrity_chain_checkpoints` (0014; until then a `GET_LOCK('audit-chain:<chain_key>')` within the tx).

**`outbox_events`**:
- `id id36 PK` (= eventId), `tenant_id id36 NULL`, `event_name key(96)`, `event_version SMALLINT`
- `aggregate_type key(64)`, `aggregate_id id36`, `payload json:EventPayload.<name>.v<version>` (IDs/statuses)
- `occurred_at ts`, `correlation_id id36`, `causation_id id36 NULL`, `actor_user_id id36 NULL`, `idempotency_key key(191) NULL`
- `status code(16)` CHECK `PENDING|CLAIMED|PUBLISHED|FAILED`
- `claimed_by key(128) NULL`, `claim_expires_at ts NULL`, `published_at ts NULL`, `attempts INT DEFAULT 0`, `last_error_class key(64) NULL`
- Indexes `ix_outbox_claim (status, occurred_at)` (claim `ORDER BY occurred_at`; EXPLAIN test), `(aggregate_type, aggregate_id, occurred_at)`
- Retention: `PUBLISHED` rows deleted after `OUTBOX_RETENTION_DAYS` (default 30) by the TTL job, **after** timeline projection checkpoints pass them.

**`idempotency_records`**:
- `id id36 PK`, `tenant_id id36 NULL`, generated `tenant_scope key(36) AS (IFNULL(tenant_id, 'platform')) PERSISTENT`
- `scope key(96)` (e.g. `POST /chamber-days/{id}/walk-ins`), `idem_key key(191)` (client `Idempotency-Key`)
- `actor_user_id id36 NULL`, `request_hash hash64` (SHA-256 of canonical JSON of method, path params and body)
- `status code(16)` CHECK `IN_PROGRESS|COMPLETED|FAILED_RETRYABLE`
- `response_status SMALLINT NULL`, `response_snapshot json:IdempotentResponse NULL` (**redacted DTO**, never secrets), `resource_type key(64) NULL`, `resource_id id36 NULL`
- `created_at ts`, `completed_at ts NULL`, `expires_at ts` (default created + `IDEMPOTENCY_TTL_HOURS`, 24)
- UNIQUE **`uq_idem (tenant_scope, scope, idem_key)`**; index `(expires_at)`
- **Semantics:**
  - Same key and same `request_hash`: `COMPLETED` → replay the snapshot with `meta.replayed=true`; `IN_PROGRESS` → `409 IDEMPOTENCY_IN_PROGRESS` (client retries after `Retry-After: 1`); `FAILED_RETRYABLE` → re-execute.
  - Same key and a **different** `request_hash` → **`422 IDEMPOTENCY_KEY_REUSED`**.
  - The record is inserted `IN_PROGRESS` in the same transaction as the mutation. A crash before commit leaves nothing.

### 3.3 Auth (0003)

**`sessions`**:
- `id id36 PK`, `user_id FK→users(id)`
- `client_type code(16)` CHECK `WEB|ANDROID|IOS`, `device_label text(80) NULL`
- `created_at ts`, `last_seen_at ts`, `idle_expires_at ts`, `absolute_expires_at ts`
- `revoked_at ts NULL`, `revoke_reason code(24) NULL` CHECK `LOGOUT|LOGOUT_ALL|REFRESH_REUSE|ADMIN|PASSWORD_CHANGED|EXPIRED`
- `authn_methods json:AuthnMethods` (e.g. `["otp"]`), `ip_hash hash64 NULL`
- Index `(user_id, revoked_at)`, `(absolute_expires_at)`

**`refresh_tokens`**:
- `id id36 PK`, `session_id FK→sessions(id)`, `family_id id36`
- `token_hash hash64 UNIQUE` (HMAC with `REFRESH_TOKEN_PEPPER`)
- `issued_at ts`, `expires_at ts`, `used_at ts NULL`, `replaced_by_id id36 NULL`, `revoked_at ts NULL`
- Index `(family_id)`. Reuse of a `used_at IS NOT NULL` token revokes the family and session and writes a security audit event.

**`otp_challenges`**:
- `id id36 PK`, `purpose code(24)` CHECK `LOGIN|PHONE_VERIFY|RECOVERY`
- `destination_hash hash64` (HMAC of E.164), `channel code(16)` CHECK `SMS|WHATSAPP|MOCK`
- `code_hash hash64` (HMAC with `OTP_PEPPER` and challenge id)
- `attempts SMALLINT DEFAULT 0`, `max_attempts SMALLINT DEFAULT 5`
- `status code(16)` CHECK `PENDING|VERIFIED|EXPIRED|LOCKED|SUPERSEDED`
- `created_at ts`, `expires_at ts` (default +5 min), `consumed_at ts NULL`, `ip_hash hash64 NULL`
- Generated `pending_key = IF(status='PENDING', CONCAT(purpose, ':', destination_hash), NULL)`; UNIQUE `uq_otp_pending (pending_key)`. A new request marks the previous one `SUPERSEDED` in the same transaction.
- Index `(expires_at)`

**`password_reset_tokens`**: `id id36 PK`, `user_id FK→users(id)`, `token_hash hash64 UNIQUE`, `created_at ts`, `expires_at ts` (+30 min), `used_at ts NULL`, `ip_hash hash64 NULL`. Index `(expires_at)`.

**`email_verification_tokens`**: `id id36 PK`, `user_id FK→users(id)`, `email_normalized key(254)`, `token_hash hash64 UNIQUE`, `created_at`, `expires_at` (+24 h), `used_at ts NULL`. Index `(expires_at)`.

**`push_devices`**:
- `id id36 PK`, `user_id FK→users(id)`, `session_id id36 NULL`
- `platform code(16)` CHECK `ANDROID|IOS|WEB`, `app code(24)` CHECK `DOCTOR_APP|PATIENT_APP|WEB`
- `token_hash hash64` (lookup), `token_encrypted key(1024)` (AES-256-GCM with `PUSH_TOKEN_KEK`; needed to send)
- `created_at ts`, `last_seen_at ts`, `revoked_at ts NULL`
- Generated `active_token_key = IF(revoked_at IS NULL, token_hash, NULL)`; UNIQUE `uq_push_active_token (active_token_key)`. Index `(user_id, revoked_at)`.

### 3.4 Patient identity, accounts, guardianship, care team (0004)

**`patients`** (std):
- `medical_record_number key(64)`, `legal_name text(200)`, `legal_name_bn text(200) NULL`, `display_name text(120)`
- `date_of_birth date NULL`, `birth_year SMALLINT NULL`, `sex code(16) NULL` CHECK `FEMALE|MALE|INTERSEX|UNKNOWN`, `gender_identity text(60) NULL`
- `address json:Address NULL`, `preferred_locale key(20) NULL`
- `status code(16)` CHECK `ACTIVE|MERGED|INACTIVE`, `merged_into_patient_id id36 NULL` FK→patients(tenant_id,id)
- UNIQUE `(tenant_id, medical_record_number)`; index `(tenant_id, legal_name)`

**`patient_search_tokens`** (derived; Stage 5, audit C-41):
- `id id36 PK`, `tenant_id`, `patient_id FK→patients(tenant_id,id)`, `token_kind code(16)` CHECK `NAME|SKELETON`, `token key(64)`, `translit_version SMALLINT`, `created_at ts`
- UNIQUE `uq_patient_search_tokens (tenant_id, patient_id, token_kind, token)`; index `ix_patient_search_tokens_token (tenant_id, token, patient_id)`
- Rebuilt from `patients` names in the same transaction as every name change (delete + insert). Never a source of truth; a version bump of the normalization triggers a rebuild job.

**`patient_contacts`** (std):
- `patient_id FK→patients(tenant_id,id)`, `type code(16)` CHECK `PHONE|EMAIL|WHATSAPP`
- `normalized_value text(254)` (E.164 or normalized email), `normalized_value_hash hash64` (app-computed SHA-256), `display_value text(254)`
- `verification_status code(16)` CHECK `UNVERIFIED|VERIFIED`, `verified_at ts NULL`, `is_preferred bool`
- `status code(16)` CHECK `ACTIVE|INACTIVE`
- `relationship code(24)` CHECK `SELF|CAREGIVER|EMERGENCY`
- Generated `active_contact_key = IF(status='ACTIVE', CONCAT(patient_id, ':', type, ':', normalized_value_hash), NULL)`; UNIQUE `uq_patient_contacts_active (tenant_id, active_contact_key)`
- Index `(tenant_id, type, normalized_value_hash)` (phone lookup)

**`patient_identifiers`** (std):
- `patient_id FK→patients(tenant_id,id)`, `identifier_type code(24)` CHECK `NID|BIRTH_REGISTRATION|PASSPORT|OTHER`
- `identifier_value_encrypted key(512)` (AES-GCM, `PHI_FIELD_KEK`), `identifier_value_hash hash64` (HMAC)
- `source code(16)`, `verification_status code(16)` CHECK `UNVERIFIED|VERIFIED`, `verified_at ts NULL`
- Generated `verified_identifier_key = IF(verification_status='VERIFIED', CONCAT(identifier_type, ':', identifier_value_hash), NULL)`; UNIQUE `uq_patient_identifiers_verified (tenant_id, verified_identifier_key)`

**`patient_consents`** (std):
- `patient_id FK→patients(tenant_id,id)`
- `purpose code(32)` CHECK `care|in_app|sms|whatsapp|email|telemedicine|ai_assistance|research`
- `status code(16)` CHECK `GRANTED|WITHDRAWN`, `policy_version INT`
- `given_by_user_id id36 NULL`, `given_by_relationship code(24)` CHECK `SELF|GUARDIAN|STAFF_RECORDED`
- `evidence_ref key(191) NULL`, `captured_at ts`, `withdrawn_at ts NULL`
- Index `(tenant_id, patient_id, purpose, status)`. New consent = new row; withdrawal updates `status` and `withdrawn_at` (the only permitted update).

**`patient_merge_cases`** (std):
- `source_patient_id FK→patients(tenant_id,id)`, `target_patient_id FK→patients(tenant_id,id)`
- `reason text(500)`, `duplicate_score DECIMAL(5,4) NULL`
- `status code(16)` CHECK `OPEN|IN_REVIEW|APPROVED|REJECTED|REVERSED`
- `requested_by_user_id id36`, `reviewed_by_user_id id36 NULL`, `reviewed_at ts NULL`
- CHECK `source_patient_id <> target_patient_id`
- Generated `open_source_key = IF(status IN ('OPEN','IN_REVIEW'), source_patient_id, NULL)`; UNIQUE `uq_merge_open_source (tenant_id, open_source_key)`

**`patient_accounts`** (std):
- `user_id FK→users(id)`, `patient_id FK→patients(tenant_id,id)`, `relationship code(8)` CHECK `SELF`
- `verification_method code(32)` CHECK `OTP_PHONE_MATCH|STAFF_VERIFIED_IN_PERSON|STAFF_VERIFIED_DOCUMENT`
- `verified_by_user_id id36 NULL`, `verified_at ts NULL`
- `status code(16)` CHECK `PENDING|ACTIVE|SUSPENDED|REVOKED`
- Generated `live_account_key = IF(status IN ('PENDING','ACTIVE'), CONCAT(user_id, ':', patient_id), NULL)`; UNIQUE `uq_patient_accounts_live (tenant_id, live_account_key)`
- Index `(user_id, status)` (tenant picker across tenants)

**`patient_guardianships`** (std):
- `guardian_user_id FK→users(id)`, `guardian_patient_id id36 NULL` FK→patients(tenant_id,id), `dependent_patient_id FK→patients(tenant_id,id)`
- `relationship code(24)` CHECK `PARENT|LEGAL_GUARDIAN|SPOUSE|CHILD|OTHER_CAREGIVER`
- `authority_scope json:GuardianScope` (subset of `VIEW_RECORDS|BOOK_APPOINTMENTS|MANAGE_SERIALS|JOIN_TELEMEDICINE|UPLOAD_DOCUMENTS|MANAGE_COMMUNICATION_PREFERENCES|GIVE_CONSENT`; non-empty)
- `verification_method code(32)` CHECK `STAFF_VERIFIED_IN_PERSON|STAFF_VERIFIED_DOCUMENT`, `verified_by_user_id id36 NULL`, `verified_at ts NULL`, `evidence_ref key(191) NULL`
- `status code(16)` CHECK `PENDING|ACTIVE|ENDED|REVOKED`, `starts_on date`, `ends_on date NULL`
- CHECK `ends_on IS NULL OR ends_on >= starts_on`, CHECK `guardian_patient_id IS NULL OR guardian_patient_id <> dependent_patient_id`
- Generated `live_guardianship_key = IF(status IN ('PENDING','ACTIVE'), CONCAT(guardian_user_id, ':', dependent_patient_id), NULL)`; UNIQUE `uq_guardianships_live (tenant_id, live_guardianship_key)`
- Index `(guardian_user_id, status)`

**`care_team_members`** (std):
- `patient_id FK→patients(tenant_id,id)`, `member_user_id FK→users(id)`
- `role code(16)` CHECK `DOCTOR|NURSE|OTHER`, `starts_at ts`, `ends_at ts NULL`, `reason text(300) NULL`, `added_by_user_id id36`
- CHECK `ends_at IS NULL OR ends_at > starts_at`
- Generated `open_member_key = IF(ends_at IS NULL, CONCAT(patient_id, ':', member_user_id, ':', role), NULL)`; UNIQUE `uq_care_team_open (tenant_id, open_member_key)`
- Index `(tenant_id, member_user_id, ends_at)`

### 3.5 Scheduling (0005)

**`chambers`** (std):
- `clinic_id FK→clinics(tenant_id,id)`, `doctor_profile_id FK→doctor_profiles(tenant_id,id)`, `name text(120)`
- `supports_physical bool`, `supports_remote bool`, `supports_hybrid bool` (replaces `text[] mode_capability`)
- `default_queue_policy json:QueuePolicy`, `status code(16)` CHECK `ACTIVE|INACTIVE`, `deleted_at ts NULL`
- **Stage 3.2:** `chamber_payment_mode code(20)` CHECK `PAY_AT_CHAMBER|PREPAID_REQUIRED|OPTIONAL_ONLINE` DEFAULT `PAY_AT_CHAMBER`; `telemedicine_payment_mode code(20)` CHECK `PREPAID_REQUIRED|OPTIONAL_ONLINE` DEFAULT `PREPAID_REQUIRED`
- CHECK `supports_physical + supports_remote + supports_hybrid >= 1`
- Index `(tenant_id, doctor_profile_id, status)`, `(tenant_id, clinic_id)`

**`doctor_schedule_rules`** (std):
- `chamber_id FK→chambers(tenant_id,id)`, `doctor_profile_id FK→doctor_profiles(tenant_id,id)`
- `rule_type code(16)` CHECK `WEEKLY|EXCEPTION_OPEN|EXCEPTION_CLOSED`, `weekday TINYINT NULL` (1–7 ISO), `exception_date date NULL`
- `local_start_time TIME(0)`, `local_end_time TIME(0)`, `capacity SMALLINT NULL`, `effective_from date`, `effective_to date NULL`
- CHECKs: `local_end_time > local_start_time`; `rule_type='WEEKLY'` ⇒ `weekday IS NOT NULL`; exceptions ⇒ `exception_date IS NOT NULL`

**`chamber_days`** (std):
- `chamber_id FK→chambers(tenant_id,id)`, `doctor_profile_id FK→doctor_profiles(tenant_id,id)`
- `local_date date`, `timezone tz`, `local_start_time TIME(0)`, `local_end_time TIME(0)`
- `status code(16)` CHECK `SCHEDULED|OPEN|PAUSED|CLOSED|CANCELLED`
- `queue_policy json:QueuePolicy` (snapshot at open)
- **`next_serial_number INT UNSIGNED NOT NULL DEFAULT 1`**: allocation counter. Incremented under the day row lock. **Not** a conflict token.
- **`queue_order_version INT UNSIGNED NOT NULL DEFAULT 1`**: bumped only by reorder, delay and policy change.
- `expected_delay_minutes SMALLINT NULL`, `closed_at ts NULL`, `closed_by_user_id id36 NULL`
- `row_version` (std): bumped by administrative changes (open, pause, close, cancel, capacity edits); **not** by serial issuance, check-in or reorder
- UNIQUE `(tenant_id, chamber_id, local_date)`; index `(tenant_id, doctor_profile_id, local_date)`

**`appointment_slots`** (std): `chamber_day_id FK→chamber_days(tenant_id,id)`, `starts_at ts`, `ends_at ts`, `local_label text(40)`, `capacity SMALLINT`, `booked_count SMALLINT DEFAULT 0`, `status code(16)` CHECK `OPEN|FULL|CLOSED`. CHECKs `ends_at > starts_at`, `booked_count <= capacity`. Index `(tenant_id, chamber_day_id, starts_at)`.

**`appointments`** (std):
- `patient_id FK→patients(tenant_id,id)`, `doctor_profile_id FK→doctor_profiles(tenant_id,id)`, `chamber_id FK→chambers(tenant_id,id)`, `chamber_day_id FK→chamber_days(tenant_id,id)`, `slot_id id36 NULL` FK→appointment_slots(tenant_id,id)
- `source code(24)` CHECK `ADVANCE_BOOKING|WALK_IN|FOLLOW_UP|RESCHEDULE`
- `care_mode code(16)` CHECK `PHYSICAL|REMOTE|HYBRID`
- `status code(16)` CHECK `REQUESTED|PENDING_PAYMENT|BOOKED|CANCELLED|RESCHEDULED|FULFILLED|NO_SHOW`
- **Stage 3.2 payment columns:** `payment_requirement code(16)` CHECK `NONE|OPTIONAL|PREPAID` (snapshot of chamber policy at booking), `payment_status code(16)` CHECK `NOT_REQUIRED|PENDING|PAID|WAIVED|REFUNDED` (informational; written only by payment consumers and the waiver use case), `payment_hold_expires_at ts NULL`, `payment_waived_reason text(300) NULL`, `payment_waived_by_user_id id36 NULL`, `cancel_reason code(32) NULL` (incl. `PAYMENT_NOT_COMPLETED`). CHECKs `status <> 'PENDING_PAYMENT' OR payment_hold_expires_at IS NOT NULL`; `payment_status <> 'WAIVED' OR payment_waived_reason IS NOT NULL`. **No serial exists for a `PENDING_PAYMENT` appointment** (use case + test). A `PENDING_PAYMENT` appointment counts toward `appointment_slots.booked_count` until released.
- `reason text(300) NULL`, `rescheduled_from_appointment_id id36 NULL` FK→appointments(tenant_id,id), `follow_up_plan_id id36 NULL`, `booked_by_user_id id36`, `booked_on_behalf code(16) NULL` CHECK `SELF|GUARDIAN|STAFF`, `deleted_at ts NULL`
- Index `(tenant_id, patient_id, created_at)`, `(tenant_id, doctor_profile_id, chamber_day_id, status)`, `ix_appointments_hold (status, payment_hold_expires_at)`

### 3.6 Queue (0006)

**`serials`** (std):
- `chamber_day_id FK→chamber_days(tenant_id,id)`, `patient_id FK→patients(tenant_id,id)`, `appointment_id id36 NULL` FK→appointments(tenant_id,id), `encounter_id id36 NULL` (FK added in 0007 → encounters(tenant_id,id))
- `serial_number INT UNSIGNED`, `queue_position INT UNSIGNED NULL` (null until queue-active)
- `source code(24)` CHECK `ADVANCE_BOOKING|WALK_IN|FOLLOW_UP|RESCHEDULE`, `care_mode code(16)` CHECK `PHYSICAL|REMOTE|HYBRID`
- `status code(16)` CHECK `BOOKED|CONFIRMED|CHECKED_IN|WAITING|CALLED|IN_CONSULTATION|SKIPPED|NO_SHOW|CANCELLED|RESCHEDULED|COMPLETED`
- `recall_count SMALLINT DEFAULT 0`, `recall_deadline_at ts NULL`, `late_arrival bool`
- `duplicate_override bool` + `duplicate_override_reason text(300) NULL` + `duplicate_override_by_user_id id36 NULL` (audited)
- `rescheduled_from_serial_id id36 NULL` FK→serials(tenant_id,id), `rescheduled_to_serial_id id36 NULL`
- Timestamps: `booked_at`, `confirmed_at`, `checked_in_at`, `waiting_at`, `called_at`, `consultation_started_at`, `completed_at`, `cancelled_at`, `no_show_at` (all `ts NULL`)
- `cancel_reason code(32) NULL`, `row_version` (std)
- UNIQUE `uq_serials_number (tenant_id, chamber_day_id, serial_number)`
- Generated **`active_patient_day_key = IF(status IN ('BOOKED','CONFIRMED','CHECKED_IN','WAITING','CALLED','SKIPPED','IN_CONSULTATION') AND duplicate_override = 0, CONCAT(chamber_day_id, ':', patient_id), NULL)`**; UNIQUE `uq_serials_active_patient_day (tenant_id, active_patient_day_key)` (resolves C-08; proven behavior HOSTING-VERIFICATION §3.1)
- CHECK `duplicate_override = 0 OR duplicate_override_reason IS NOT NULL`
- Index `ix_serials_queue (tenant_id, chamber_day_id, status, queue_position, serial_number)`; `(tenant_id, patient_id, created_at)`

**`check_ins`** (std):
- `serial_id FK→serials(tenant_id,id)`, `method code(24)` CHECK `STAFF_DESK|PATIENT_APP|REMOTE_READY|KIOSK`
- `remote_ready bool`, `remote_ready_at ts NULL`, `checked_in_at ts`, `verified_by_user_id id36 NULL`
- `device_meta json:MinimalDeviceMeta NULL` (network type, app version only)
- `revoked_at ts NULL`
- Generated `active_serial_key = IF(revoked_at IS NULL, serial_id, NULL)`; UNIQUE `uq_check_ins_active (tenant_id, active_serial_key)`

**`queue_events`** (append-only, hash-chained per chamber day):
- `id id36 PK`, `tenant_id`, `chamber_day_id FK→chamber_days(tenant_id,id)`, `serial_id id36 NULL` FK→serials(tenant_id,id) (null for day-level events), `seq INT UNSIGNED` (per chamber day)
- `event_type code(32)` CHECK `SERIAL_ISSUED|CONFIRMED|CHECKED_IN|REMOTE_READY|WAITING|CALLED|SKIPPED|RECALLED|NO_SHOW|CANCELLED|RESCHEDULED|CONSULTATION_STARTED|COMPLETED|QUEUE_REORDERED|DELAY_RECORDED|DAY_OPENED|DAY_PAUSED|DAY_CLOSED|DAY_CANCELLED|POLICY_CHANGED|DUPLICATE_OVERRIDE` (`DAY_CANCELLED`: Stage 5, the day-level event of `CancelChamberDay`, audit C-43)
- `from_status code(16) NULL`, `to_status code(16) NULL`, `position_before INT NULL`, `position_after INT NULL`
- `details json:QueueEventDetails` (e.g. reorder before/after arrays of serial ids; delay minutes; reason code)
- `reason text(300) NULL`, `actor_user_id id36 NULL`, `actor_type code(16)` CHECK `USER|SYSTEM|PATIENT_CONTEXT`
- `idempotency_key key(191) NULL`, `occurred_at ts`, `prev_row_hash hash64 NULL`, `row_hash hash64`
- UNIQUE `(tenant_id, chamber_day_id, seq)`, UNIQUE `(tenant_id, idempotency_key)`; index `(tenant_id, serial_id, occurred_at)`

### 3.7 Encounters and notes (0007)

**`encounters`** (std):
- `patient_id FK→patients(tenant_id,id)`, `doctor_profile_id FK→doctor_profiles(tenant_id,id)`, `chamber_id FK→chambers(tenant_id,id)`, `serial_id FK→serials(tenant_id,id)`, `appointment_id id36 NULL` FK→appointments(tenant_id,id)
- `care_mode code(16)`
- `status code(20)` CHECK `IN_PROGRESS|INTERRUPTED|COMPLETED|ENTERED_IN_ERROR`
- `started_at ts`, `interrupted_at ts NULL`, `interruption_reason code(32) NULL`, `resumed_at ts NULL`, `completed_at ts NULL`, `completion_reason code(32) NULL`, `entered_in_error_reason text(300) NULL`
- Generated `serial_encounter_key = IF(status <> 'ENTERED_IN_ERROR', serial_id, NULL)`; UNIQUE `uq_encounters_serial (tenant_id, serial_encounter_key)` (one encounter per serial)
- Index `(tenant_id, patient_id, started_at)`, `(tenant_id, doctor_profile_id, status)`
- FK `serials.encounter_id` → `encounters(tenant_id,id)` added here

**`encounter_participants`** (std): `encounter_id FK→encounters(tenant_id,id)`, `participant_type code(16)` CHECK `DOCTOR|STAFF|PATIENT|GUARDIAN|INTERPRETER|EXTERNAL`, `participant_user_id id36 NULL`, `participant_patient_id id36 NULL`, `role code(16)`, `authorization_status code(16)` CHECK `INVITED|AUTHORIZED|REVOKED`, `joined_at ts NULL`, `left_at ts NULL`. Index `(tenant_id, encounter_id)`.

**`encounter_notes`** (draft; std) (resolves C-10):
- `encounter_id FK→encounters(tenant_id,id)`, `author_doctor_profile_id FK→doctor_profiles(tenant_id,id)`
- `status code(16)` CHECK `DRAFT|SIGNED_LOCKED`
- `chief_complaint longtext NULL`, `history longtext NULL`, `examination longtext NULL`, `assessment longtext NULL`, `plan longtext NULL`
- `extensions json:NoteExtensions.v<schema_version> NULL` (bounded ≤ 16 KB), `schema_version SMALLINT`
- `section_sources json:NoteSectionSources` (`[{section, source:'doctor'|'ai_approved'|'nurse', aiApprovalId?}]`)
- `last_signed_revision INT UNSIGNED NULL`, `row_version` (std; autosave conflict token)
- Generated `open_draft_key = IF(status='DRAFT', encounter_id, NULL)`; UNIQUE `uq_encounter_notes_open_draft (tenant_id, open_draft_key)`
- **Single mutable draft row per encounter.** Autosave is a debounced client (≥ 2 s idle, ≤ 1 per 5 s) sending `expectedRowVersion`. A conflict returns `STALE_VERSION` with the server copy.

**`encounter_note_versions`** (append-only, hash-chained per encounter):
- `id id36 PK`, `tenant_id`, `encounter_id FK→encounters(tenant_id,id)`, `note_id FK→encounter_notes(tenant_id,id)`
- `revision INT UNSIGNED` (1, 2, …)
- `signed_by_doctor_profile_id FK→doctor_profiles(tenant_id,id)`, `signed_at ts`
- Frozen sections: `chief_complaint`, `history`, `examination`, `assessment`, `plan` (longtext), `extensions json`, `section_sources json`, `schema_version`
- `correction_reason text(500) NULL` (required when `revision > 1`), `supersedes_revision INT NULL`
- `content_sha256 hash64`, `prev_row_hash`, `row_hash`
- UNIQUE `(tenant_id, encounter_id, revision)`; CHECK `revision = 1 OR correction_reason IS NOT NULL`
- **Signing:** lock draft → insert version with `revision = IFNULL(last_signed_revision,0)+1` → set draft `last_signed_revision`. The draft stays `DRAFT` for further corrections, or becomes `SIGNED_LOCKED` when the encounter completes and no correction is open. **Signed notes are corrected only by a new signed revision with a reason.**

### 3.8 Clinical and catalog (0008)

**`symptom_observations`** (std): `encounter_id FK→encounters(tenant_id,id)`, `patient_id FK→patients(tenant_id,id)`, `normalized_code key(64) NULL`, `code_system key(32) NULL`, `display text(200)`, `detail text(1000) NULL`, `onset text(80) NULL`, `severity code(16) NULL` CHECK `MILD|MODERATE|SEVERE|UNKNOWN`, `source code(16)` CHECK `PATIENT_REPORTED|CLINICIAN_OBSERVED|AI_APPROVED`, `certainty code(16)`, `status code(20)` CHECK `ACTIVE|ENTERED_IN_ERROR`.

**`diagnoses`** (std):
- `encounter_id FK→encounters(tenant_id,id)`, `patient_id FK→patients(tenant_id,id)`, `author_doctor_profile_id FK→doctor_profiles(tenant_id,id)`
- `code_system key(32) NULL`, `code key(32) NULL`, `display text(300)`, `display_bn text(300) NULL`
- `clinical_status code(20)` CHECK `ACTIVE|RESOLVED|RULED_OUT|ENTERED_IN_ERROR`, `certainty code(16)` CHECK `CONFIRMED|PROVISIONAL|DIFFERENTIAL`
- `source code(16)` CHECK `doctor|ai_approved`, `ai_approval_id id36 NULL` (column and FK→`ai_approvals(tenant_id,id)` added in 0013)
- CHECK `source <> 'ai_approved' OR ai_approval_id IS NOT NULL` (added in 0013)
- `notes text(1000) NULL`

**Medication catalog (Stage 3.2, ADR-020).** Global tables (no `tenant_id`) filled only by the dataset importer or by the synthetic seed. The import contract is the Stage M JSON Schemas; field mapping is in ADR-020 §1. Search normalization: `*_search_key` = NFKC → lowercase → Bangla digits to ASCII → punctuation and whitespace runs collapsed to a single space.

**`medications`** (global):
- `id id36 PK`
- `canonical_key text(1024)` (`utf8mb4_bin`; = dataset `record_key`, up to 540 bytes in `medicine-dataset-20260917-4`), `canonical_key_sha256 hash64` **UNIQUE** (upsert key)
- `dataset_record_id key(32)` UNIQUE (dataset `id`, `med_<16 hex>`; synthetic seed rows use `syn_<16 hex>`)
- `dataset_version key(64)` (last import that wrote the row), `first_seen_version key(64)`, `deactivated_in_version key(64) NULL`
- `brand_name text(200)`, `brand_search_key text(200)`, `brand_name_bn text(200) NULL`, `brand_bn_search_key text(200) NULL`
- `generic_display text(500)` (generic names joined with " + "), `generic_set_key text(500)`
- `strength_text text(300) NULL`, `strength_parsed json:StrengthComponents`
- `dosage_form key(40)` (dataset vocabulary incl. `unmapped`; not a CHECK list), `dosage_form_raw json:StringArray`, `route key(32) NULL`
- `manufacturer_id id36 NULL` FK→medication_manufacturers(id), `manufacturer_display text(200)`
- `registration_number key(40) NULL`, `registration_alternatives json:ProvenancedValues NULL`
- `dgda_match code(16)` CHECK `MATCHED|NOT_FOUND|AMBIGUOUS|NOT_CHECKED`
- `review_status code(20)` CHECK `UNVERIFIED|SAMPLED_REVIEWED|VERIFIED`
- `monograph_source_url text(500) NULL` (link only)
- `source_ids json:StringArray`, `field_provenance json:FieldProvenance` (≤ 16 KB; `{field: {sources, agreementCount}}`)
- `active bool`, `is_synthetic bool`, `imported_at ts`, `updated_at ts`
- Indexes `ix_med_brand (active, brand_search_key(191))`, `ix_med_brand_bn (active, brand_bn_search_key(191))`, `ix_med_generic (active, generic_set_key(191))`, `(manufacturer_id)`
- **Never hard-deleted.** Rows referenced by `prescription_items` or `patient_medications` are deactivated at most. No invented rows: real data only from a Stage M dataset import, demo data only from clearly synthetic seed rows (`is_synthetic=1`, brands prefixed `DEMO-`, `canonical_key` prefixed `synthetic:`).

**`medication_generics`** (global): `id id36 PK`, `generic_key text(300)` + `generic_key_sha256 hash64` UNIQUE, `name text(300)`, `name_search_key text(300)` (index `(name_search_key(191))`), `aliases json:StringArray`, `salt_forms json:StringArray`, `dataset_record_id key(32)` UNIQUE, `dataset_version key(64)`, `active bool`.

**`medication_generic_links`** (global): `medication_id` FK→medications(id), `generic_id` FK→medication_generics(id), `position SMALLINT`; PK `(medication_id, generic_id)`; index `(generic_id)`.

**`medication_manufacturers`** (global): `id id36 PK`, `manufacturer_key text(200)` + `manufacturer_key_sha256 hash64` UNIQUE, `name text(200)`, `aliases json:ManufacturerAliases` (raw name, rule, sources), `dataset_record_id key(32)` UNIQUE, `dataset_version key(64)`, `active bool`.

**`medication_aliases`** (global): `id id36 PK`, `target_type code(12)` CHECK `MEDICATION|GENERIC`, `medication_id id36 NULL` FK→medications(id), `generic_id id36 NULL` FK→medication_generics(id), `alias text(200)`, `alias_search_key text(200)`, `script code(8)` CHECK `latin|bengali`, `kind code(24)` CHECK `brand_bn|banglish|brand_variant|generic_variant`, `alias_origin code(16)` CHECK `source|generated`, `sources json:StringArray`, `dataset_version key(64)`, `active bool`, `alias_identity_sha256 hash64` UNIQUE (SHA-256 of target type, target id, alias, kind). CHECK `(target_type='MEDICATION' AND medication_id IS NOT NULL AND generic_id IS NULL) OR (target_type='GENERIC' AND generic_id IS NOT NULL AND medication_id IS NULL)`. Index `(active, alias_search_key(191))`. Generated aliases rank lowest and are search-only.

**`medication_price_observations`** (global): `id id36 PK`, `medication_id` FK→medications(id), `dataset_version key(64)`, `source_id key(48)`, `source_url text(500)`, `unit_price money NULL`, `pack_price money NULL`, `price_label text(80) NULL`, `is_official_mrp bool`, `observed_at ts`. UNIQUE `(medication_id, source_id, observed_at)`. CHECK `unit_price IS NOT NULL OR pack_price IS NOT NULL`. **Displayed only as "observed price, may differ"** unless `is_official_mrp=1`.

**`medication_usage_stats`** (tenant): `tenant_id` FK→tenants(id), `medication_id` FK→medications(id), PK `(tenant_id, medication_id)`; `prescribed_count INT UNSIGNED`, `last_prescribed_at ts`. Updated by the `PrescriptionApproved` consumer (`INSERT … ON DUPLICATE KEY UPDATE`). Used only for tenant-scoped search boosting.

**`medication_dataset_imports`** (global): `id id36 PK`, `dataset_version key(64)`, `dataset_status key(16)` (from `latest.json`/records, e.g. `UNVERIFIED`), `environment code(16)`, `execution_path code(8)` CHECK `CLI|JOB`, `status code(16)` CHECK `QUEUED|RUNNING|SUCCEEDED|FAILED|REFUSED`, `refusal_reason key(48) NULL`, `requested_by key(128)` (operator user id or CLI OS user), `file_checksums json:FileChecksums`, `schema_hashes json:FileChecksums`, `counts json:ImportCounts` (per file: read, inserted, updated, unchanged, deactivated, excluded_veterinary, rejected_schema, rejected_price_precision), `checkpoint json:ImportCheckpoint NULL`, `error_class key(64) NULL`, `started_at ts NULL`, `finished_at ts NULL`, `created_at ts`. Generated `succeeded_version_key = IF(status='SUCCEEDED', dataset_version, NULL)` UNIQUE; generated `active_import_key = IF(status IN ('QUEUED','RUNNING'), 'active', NULL)` UNIQUE (one import at a time).

**`medication_dataset_gate_attestations`** (append-only, hash-chained `meddata:platform`): `id id36 PK`, `seq BIGINT UNSIGNED` UNIQUE, `dataset_version key(64)`, `gate_code code(32)` CHECK `LEGAL_SOURCE_REVIEW|CLINICAL_SAMPLE_REVIEW|DGDA_CROSS_REFERENCE|IMPORT_SAFEGUARDS_VERIFIED`, `evidence_ref text(500)`, `summary text(1000)` (e.g. sample size and error rate), `recorded_by_user_id id36`, `recorded_at ts`, `prev_row_hash`, `row_hash`. UNIQUE `(dataset_version, gate_code)`.

**`patient_medications`** (std): `patient_id FK→patients(tenant_id,id)`, `medication_id id36 NULL` FK→medications(id), `free_text_name text(200) NULL`, `dose_text text(200) NULL`, `instructions text(500) NULL`, `start_date date NULL`, `end_date date NULL`, `status code(16)` CHECK `ACTIVE|STOPPED|ENTERED_IN_ERROR`, `source_prescription_id id36 NULL`, `source_encounter_id id36 NULL`. CHECK `medication_id IS NOT NULL OR free_text_name IS NOT NULL`.

### 3.9 Prescriptions (0009) (resolves C-11)

**`prescriptions`** (std; each row is one **revision** of the encounter's prescription):
- `patient_id FK→patients(tenant_id,id)`, `encounter_id FK→encounters(tenant_id,id)`, `doctor_profile_id FK→doctor_profiles(tenant_id,id)`
- `revision INT UNSIGNED` (1…), `supersedes_prescription_id id36 NULL` FK→prescriptions(tenant_id,id)
- `clinical_status code(16)` CHECK `DRAFT|REVIEWED|APPROVED|VOID`
- `render_status code(16)` CHECK `NOT_REQUESTED|QUEUED|RENDERING|AVAILABLE|FAILED`
- `reviewed_by_user_id id36 NULL`, `reviewed_at ts NULL`
- `approved_by_doctor_profile_id id36 NULL`, `approved_at ts NULL`, `attestation_version SMALLINT NULL`, `approved_snapshot_sha256 hash64 NULL`
- `voided_by_user_id id36 NULL`, `voided_at ts NULL`, `void_reason text(500) NULL`, `clinical_reviewer_doctor_profile_id id36 NULL`
- `rendered_document_id id36 NULL` FK→documents(tenant_id,id) (added in 0010), `render_template_version key(32) NULL`
- `row_version` (std; draft editing token)
- UNIQUE `(tenant_id, encounter_id, revision)`
- Generated `approved_encounter_key = IF(clinical_status='APPROVED', encounter_id, NULL)`; UNIQUE `uq_prescriptions_one_approved (tenant_id, approved_encounter_key)`
- Generated `open_draft_encounter_key = IF(clinical_status IN ('DRAFT','REVIEWED'), encounter_id, NULL)`; UNIQUE `uq_prescriptions_one_open_draft (tenant_id, open_draft_encounter_key)`
- CHECKs:
  - `clinical_status <> 'APPROVED' OR (approved_by_doctor_profile_id IS NOT NULL AND approved_at IS NOT NULL AND approved_snapshot_sha256 IS NOT NULL)`
  - `clinical_status <> 'VOID' OR void_reason IS NOT NULL`
  - `render_status = 'NOT_REQUESTED' OR clinical_status IN ('APPROVED','VOID')`

**`prescription_items`** (std):
- `prescription_id FK→prescriptions(tenant_id,id)`, `sequence SMALLINT`
- `medication_id id36 NULL` FK→medications(id), `medication_dataset_version key(64) NULL`, `catalog_snapshot json:CatalogItemSnapshot NULL` (brand, generics, strength, form, manufacturer, `review_status`, `dgda_match` at selection time; Stage 3.2), `free_text_name text(200) NULL`, `is_free_text bool`
- `strength text(120) NULL`, `dosage_form code(40) NULL`, `route code(24) NULL`, `dose text(80)`, `frequency text(80)`, `duration text(80)`, `quantity text(40) NULL`, `timing text(80) NULL`, `instructions text(500) NULL`, `instructions_bn text(500) NULL`
- `substitution_allowed bool DEFAULT 1`
- UNIQUE `(tenant_id, prescription_id, sequence)`
- CHECK `(is_free_text = 1 AND free_text_name IS NOT NULL) OR (is_free_text = 0 AND medication_id IS NOT NULL)`
- **Items are editable only while the parent is `DRAFT`/`REVIEWED`.** The repository locks the parent row and rejects mutations otherwise (`PRESCRIPTION_NOT_EDITABLE`); a test proves it.

### 3.10 Documents and labs (0010)

**`documents`** (std):
- `patient_id FK→patients(tenant_id,id)`, `encounter_id id36 NULL` FK→encounters(tenant_id,id)
- `category code(32)` CHECK `LAB_REPORT|PRESCRIPTION_PDF|IMAGE|REFERRAL|OTHER|AI_RAW`
- `status code(16)` CHECK `CREATED|UPLOADING|UPLOADED|SCANNING|SCAN_ERROR|AVAILABLE|REJECTED|EXPIRED`
- `current_revision INT UNSIGNED NULL`, `title text(200) NULL`, `access_policy code(24)` CHECK `CLINICAL_TEAM|PATIENT_SHARED|AUDIT_ONLY`
- `redacted_at ts NULL`, `row_version` (std)
- Index `(tenant_id, patient_id, created_at)`

**`document_versions`** (std):
- `document_id FK→documents(tenant_id,id)`, `revision INT UNSIGNED`, `storage_adapter code(8)` CHECK `s3|disk`, `storage_key key(255) UNIQUE`
- `content_type key(100)`, `size_bytes BIGINT UNSIGNED`, `sha256 hash64`
- `scan_status code(16)` CHECK `PENDING|CLEAN|REJECTED|ERROR`, `scan_adapter key(48) NULL`, `scan_reason key(48) NULL`, `scanned_at ts NULL`
- `derived_from_revision INT NULL` (image re-encode), `uploaded_by_user_id id36 NULL`
- UNIQUE `(tenant_id, document_id, revision)`

**`upload_sessions`** (std): `document_id FK→documents(tenant_id,id)`, `target_revision INT`, `storage_adapter code(8)`, `adapter_upload_id key(255) NULL`, `expected_size_bytes BIGINT`, `expected_sha256 hash64`, `part_size_bytes INT`, `status code(16)` CHECK `OPEN|FINALIZING|FINALIZED|ABORTED|EXPIRED`, `expires_at ts`. Index `(status, expires_at)`.

**`upload_session_parts`**: `upload_session_id id36`, `part_number SMALLINT`, PK `(upload_session_id, part_number)`; `tenant_id id36`, `size_bytes INT`, `sha256 hash64`, `etag key(128) NULL`, `received_at ts`. Composite FK `(tenant_id, upload_session_id)` → upload_sessions.

**`lab_reports`** (std): `patient_id FK→patients(tenant_id,id)`, `encounter_id id36 NULL` FK, **`document_id FK→documents(tenant_id,id) NOT NULL`** (must be a finalized document; resolves route drift C-12), `lab_name text(200) NULL`, `report_date date NULL`, `review_status code(16)` CHECK `UNREVIEWED|REVIEWED|ENTERED_IN_ERROR`, `reviewed_by_doctor_profile_id id36 NULL`, `reviewed_at ts NULL`, `raw_metadata json:LabReportMeta NULL`.

**`lab_results`** (std): `lab_report_id FK→lab_reports(tenant_id,id)`, `analyte_code key(64) NULL`, `code_system key(32) NULL`, `analyte_display text(200)`, `value_numeric DECIMAL(18,6) NULL`, `value_text text(200) NULL`, `unit text(40) NULL`, `reference_range text(120) NULL`, `abnormal_flag code(8) NULL` CHECK `LOW|HIGH|CRITICAL|NORMAL`, `result_date date NULL`, `entry_source code(16)` CHECK `MANUAL|EXTRACTED`, `review_status code(16)`.

### 3.11 Timeline and follow-up (0011) (resolves C-05)

**`timeline_events`** (append-only, hash-chained per patient):
- `id id36 PK`, `tenant_id`, `patient_id FK→patients(tenant_id,id)`, `seq INT UNSIGNED` (per patient)
- `event_type code(32)` CHECK list incl. `REDACTED`
- `occurred_at ts`, `source_type key(48)`, `source_id id36`
- `summary text(300)` (non-sensitive template text), `visibility code(16)` CHECK `CLINICAL|PATIENT_SHARED|OPERATIONAL`
- `structured_refs json:TimelineRefs`, `projection_version SMALLINT`
- `source_event_id id36` (outbox event id), `redacts_timeline_event_id id36 NULL` (only for `REDACTED` markers), `redaction_reason_code key(32) NULL`
- `prev_row_hash`, `row_hash`
- UNIQUE `(tenant_id, patient_id, seq)`, UNIQUE `(tenant_id, source_event_id, event_type, projection_version)` (idempotent projection)
- Index `ix_timeline_patient (tenant_id, patient_id, occurred_at, id)`
- **Strictly append-only.** A redaction **inserts** a `REDACTED` marker row referencing the original. Read models exclude originals that have a marker, and the marker shows "entry removed" per visibility policy. No row is ever updated.

**`projection_checkpoints`**: `projection_name key(64)`, `tenant_id id36`, PK `(projection_name, tenant_id)`; `last_outbox_occurred_at ts`, `last_event_id id36`, `projection_version SMALLINT`, `updated_at ts`.

**`follow_up_plans`** (std): `patient_id FK→patients(tenant_id,id)`, `source_encounter_id FK→encounters(tenant_id,id)`, `doctor_profile_id FK→doctor_profiles(tenant_id,id)`, `due_start_date date`, `due_end_date date NULL`, `reason text(300)`, `instructions text(1000) NULL`, `status code(16)` CHECK `PLANNED|BOOKED|COMPLETED|CANCELLED|MISSED`, `appointment_id id36 NULL` FK, `serial_id id36 NULL` FK. CHECK `due_end_date IS NULL OR due_end_date >= due_start_date`.

**`follow_up_tasks`** (std): `follow_up_plan_id FK→follow_up_plans(tenant_id,id)`, `task_type code(24)` CHECK `REMINDER|CALL|BOOKING_ASSIST`, `due_at ts`, `status code(16)` CHECK `OPEN|DONE|CANCELLED`, `assigned_user_id id36 NULL`.

### 3.12 Communication and telemedicine (0012)

**`communications`** (std): `patient_id id36 NULL` FK→patients(tenant_id,id), `actor_user_id id36 NULL`, `channel code(16)` CHECK `in_app|email|sms|whatsapp|push|phone`, `purpose key(48)`, `template_key key(64)`, `template_version SMALLINT`, `locale key(20)`, `consent_id id36 NULL` FK→patient_consents(tenant_id,id), `business_type key(48)`, `business_id id36`, `status code(20)` CHECK `CREATED|CONSENT_CHECKED|QUEUED|SENDING|SENT|DELIVERED|READ|FAILED|RETRY_SCHEDULED|CANCELLED`, `idempotency_key key(191)`, `fallback_of_communication_id id36 NULL`. UNIQUE `(tenant_id, idempotency_key)`.

**`communication_attempts`** (std): `communication_id FK→communications(tenant_id,id)`, `attempt_number SMALLINT`, `provider_adapter key(32)`, `provider_message_id key(191) NULL`, `status code(16)`, `error_class key(64) NULL`, **Stage 3.2 SMS columns:** `credential_scope code(16) NULL` CHECK `PLATFORM|TENANT`, `credential_id id36 NULL` FK→provider_credentials(tenant_id,id), `encoding code(8) NULL` CHECK `text|unicode`, `segments_estimated SMALLINT NULL`, `outcome_class key(32) NULL` (`ACCEPTED`/`REJECTED`/`PROVIDER_UNAVAILABLE`/`UNKNOWN_OUTCOME`), `possible_duplicate bool`, `sent_at ts NULL`, `delivered_at ts NULL`, `read_at ts NULL`, `failed_at ts NULL`, `provider_meta json:RedactedProviderMeta NULL`. UNIQUE `(tenant_id, communication_id, attempt_number)`; index `(provider_adapter, provider_message_id)`.

**`communication_short_links`** (Stage 3.2): `id id36 PK`, `tenant_id id36` FK→tenants(id), `token_hash hash64` UNIQUE (HMAC-SHA-256 of the 22-char random token with `SHORT_LINK_PEPPER`), `target_type code(24)` CHECK `SERIAL|APPOINTMENT|PAYMENT_INTENT|PRESCRIPTION|DOCUMENT_LIST`, `target_id id36`, `created_at ts`, `expires_at ts`, `first_used_at ts NULL`. Index `(expires_at)`. Resolving a link requires login and the normal authorization for the target; the link itself grants nothing.

**`communication_preferences`** (std): `patient_id FK`, `channel code(16)`, `contact_id id36 NULL` FK→patient_contacts(tenant_id,id), `preference code(16)` CHECK `OPT_IN|OPT_OUT`, `consent_version INT`, `effective_from ts`, `effective_to ts NULL`.

**`provider_webhook_events`** (append-only): `id id36 PK`, `provider_adapter key(32)`, `provider_event_id key(191)`, `received_at ts`, `signature_valid bool`, `tenant_id id36 NULL`, `mapped_attempt_id id36 NULL`, `payload_ref key(255) NULL` (object storage, redacted). UNIQUE `(provider_adapter, provider_event_id)`.

**`telemedicine_sessions`** (std): `encounter_id FK→encounters(tenant_id,id)`, `provider_adapter key(32)`, `provider_session_id key(191) NULL`, `status code(16)` CHECK `PENDING|ACTIVE|ENDED|FAILED|EXPIRED`, `issued_at ts`, `expires_at ts`, `ended_at ts NULL`, `ended_reason code(32) NULL`, `recording_policy code(16)` CHECK `DISABLED` (MVP). Generated `active_encounter_key = IF(status IN ('PENDING','ACTIVE'), encounter_id, NULL)`; UNIQUE `uq_telemed_active (tenant_id, active_encounter_key)`. UNIQUE `(provider_adapter, provider_session_id)`.

**`telemedicine_participants`** (std): `session_id FK→telemedicine_sessions(tenant_id,id)`, `participant_type code(16)`, `participant_user_id id36 NULL`, `participant_patient_id id36 NULL`, `role code(16)`, `authorization_state code(16)`, `join_count SMALLINT`, `leave_count SMALLINT`, `reconnect_count SMALLINT`, `last_joined_at ts NULL`.

### 3.13 AI (0013) (ADR-017; `AI-IMPLEMENTATION.md`)

**`tenant_ai_policies`** (std):
- `ai_enabled bool`, `free_tier_ai_allowed bool` (default from `AI_FREE_TIER_ALLOWED_DEFAULT`, `false`), `minimization_required_for_no_training bool DEFAULT 1`
- `raw_output_retention_days SMALLINT DEFAULT 30`, `allowed_provider_codes json:ProviderCodeArray`, `min_ai_consent_policy_version INT DEFAULT 1`
- `policy_version INT UNSIGNED DEFAULT 1` (business version), `policy_text_version key(32)`
- `decided_by_user_id id36 NULL`, `decided_at ts NULL`, `row_version` (std)
- UNIQUE `(tenant_id)`; CHECK `raw_output_retention_days BETWEEN 0 AND 3650`

**`tenant_ai_policy_events`** (append-only, hash-chained per tenant): `id id36 PK`, `tenant_id`, `seq INT`, `policy_version INT`, `before json:TenantAiPolicySnapshot`, `after json:TenantAiPolicySnapshot`, `policy_text_version key(32)`, `reason text(500)`, `actor_user_id id36`, `occurred_at ts`, `prev_row_hash`, `row_hash`. UNIQUE `(tenant_id, seq)`.

**`ai_data_use_acknowledgements`** (std):
- `doctor_profile_id FK→doctor_profiles(tenant_id,id)`, `provider_code key(32)`, `tier code(8)` CHECK `FREE|PAID`
- `terms_text_version key(32)`, `terms_text_sha256 hash64`
- `acknowledged_by_user_id id36`, `acknowledged_at ts`, `revoked_at ts NULL`, `revoke_reason code(24) NULL` CHECK `TEXT_VERSION_SUPERSEDED|DOCTOR_WITHDREW|ADMIN`
- Generated `live_ack_key = IF(revoked_at IS NULL, CONCAT(doctor_profile_id, ':', provider_code, ':', tier, ':', terms_text_version), NULL)`; UNIQUE `uq_ai_ack_live (tenant_id, live_ack_key)`

**`ai_provider_credentials`** (std):
- `doctor_profile_id FK→doctor_profiles(tenant_id,id)`, `provider_code key(32)`, `declared_tier code(8)` CHECK `FREE|PAID`, `tier_self_declared bool DEFAULT 1`
- `billing_mode code(24)` CHECK `DOCTOR_BYOK_FREE|DOCTOR_BYOK_PAID|PLATFORM_MANAGED`
- `encrypted_secret key(2048)` (base64 `iv.ciphertext.tag`), `wrapped_data_key key(512)`, `key_id key(32)`
- `secret_last4 key(4)`, `secret_fingerprint hash64` (HMAC with `AI_CREDENTIAL_FINGERPRINT_PEPPER`; on revoke replaced by tombstone `rev_<id-no-dashes>` so the same key may be re-added)
- `status code(24)` CHECK `PENDING_VALIDATION|ACTIVE|INVALID|QUOTA_EXHAUSTED|DISABLED|REVOKED`
- `validated_at ts NULL`, `last_error_class key(64) NULL`, `last_error_reason key(64) NULL`
- `default_model_id key(128) NULL`, `allowed_model_ids json:ModelIdArray`, `priority SMALLINT DEFAULT 100`, `max_concurrency SMALLINT DEFAULT 1`, `quota_hint json:QuotaHint NULL`
- `data_use_ack_id id36 NULL` FK→ai_data_use_acknowledgements(tenant_id,id)
- `revoked_at ts NULL`, `revoked_by_user_id id36 NULL`, `created_by_user_id id36` (std), `row_version` (std)
- UNIQUE **`uq_ai_credentials (tenant_id, doctor_profile_id, provider_code, secret_fingerprint)`**
- CHECKs:
  - `(billing_mode='DOCTOR_BYOK_FREE' AND declared_tier='FREE') OR (billing_mode='DOCTOR_BYOK_PAID' AND declared_tier='PAID') OR billing_mode='PLATFORM_MANAGED'`
  - `max_concurrency BETWEEN 1 AND 4`
- Index `(tenant_id, doctor_profile_id, status, priority)`

**`ai_credential_fallbacks`** (std): `doctor_profile_id FK→doctor_profiles(tenant_id,id)`, `position SMALLINT`, `credential_id FK→ai_provider_credentials(tenant_id,id)`. UNIQUE `(tenant_id, doctor_profile_id, position)`, UNIQUE `(tenant_id, doctor_profile_id, credential_id)`.

**`ai_model_catalog`** (global): `id id36 PK`, `provider_code key(32)`, `model_id key(128)`, `display_name text(128)`, `capabilities json:ModelCapabilities` (`text`, `jsonSchema`, `audio`, `vision`, `contextTokens`), `tier_availability json:TierArray`, `deprecated_at ts NULL`, `last_verified_at ts`, `source code(16)` CHECK `provider_api|manual_config`, `excluded_reason key(48) NULL` (e.g. `LABS_OR_PREVIEW`). UNIQUE `(provider_code, model_id)`.

**`ai_usage_counters`**: `credential_id id36`, `tenant_id id36`, `window code(8)` CHECK `MINUTE|DAY`, `window_start ts`, PK `(credential_id, window, window_start)`; `request_count INT UNSIGNED`, `input_tokens BIGINT UNSIGNED`, `output_tokens BIGINT UNSIGNED`, `last_429_at ts NULL`, `retry_after_until ts NULL`, `updated_at ts`. Composite FK `(tenant_id, credential_id)`. TTL 35 days.

**`ai_usage_ledger`** (append-only): `id id36 PK`, `tenant_id`, `job_id id36`, `credential_id id36`, `doctor_profile_id id36`, `provider_code key(32)`, `model_id key(128)`, `billing_mode code(24)`, `input_tokens INT UNSIGNED`, `output_tokens INT UNSIGNED`, `provider_request_id_hash hash64 NULL`, `outcome code(16)` CHECK `SUCCESS|ERROR`, `error_class key(64) NULL`, `occurred_at ts`. Composite FKs to `ai_jobs`, `ai_provider_credentials`. Index `(tenant_id, doctor_profile_id, occurred_at)`.

**`ai_jobs`** (std):
- `requested_by_user_id id36`, `doctor_profile_id FK→doctor_profiles(tenant_id,id)`, `patient_id FK→patients(tenant_id,id)`, `encounter_id FK→encounters(tenant_id,id)`
- `purpose code(24)` CHECK `NOTE_DRAFT|HISTORY_SUMMARY|TRANSCRIPTION`
- `status code(24)` CHECK `QUEUED|RUNNING|WAITING_RATE_LIMIT|SUCCEEDED|FAILED|CANCELLED`
- `credential_id FK→ai_provider_credentials(tenant_id,id)`, `fallback_from_credential_id id36 NULL`, `fallback_reason key(48) NULL`
- `provider_code key(32)`, `model_id key(128)`, `declared_tier code(8)`, `billing_mode code(24)`
- `effective_data_use_policy code(32)` CHECK `MAY_TRAIN_OR_REVIEW|NO_TRAINING_CONTRACTUAL`
- `minimization_report json:MinimizationReport NULL` (categories and counts only)
- `prompt_template_version key(32)`, `output_schema_version key(32)`, `source_selection json:AiSourceSelection`, `retrieval_effective json:RetrievalEffective NULL`
- `job_id id36 NULL` (ADR-015 `jobs.id`), `error_class key(64) NULL`, `error_reason key(64) NULL`
- `cancel_requested_at ts NULL`, `started_at ts NULL`, `finished_at ts NULL`, `correlation_id id36`, `idempotency_key key(191)`
- UNIQUE `(tenant_id, idempotency_key)`; index `(tenant_id, encounter_id, created_at)`, `(tenant_id, status, created_at)`

**`ai_transcripts`** (std; unused in MVP): `ai_job_id FK→ai_jobs(tenant_id,id)`, `source_document_id id36 NULL`, `language_hint code(8)` CHECK `bn|en|mixed`, `segments json:TranscriptSegments`, `status code(16)`, `confidence_meta json NULL`.

**`ai_drafts`** (std):
- `ai_job_id FK→ai_jobs(tenant_id,id)` UNIQUE with tenant, `encounter_id FK`, `patient_id FK`, `draft_type code(24)` CHECK `NOTE_DRAFT|HISTORY_SUMMARY`
- `status code(20)` CHECK `READY_FOR_REVIEW|IN_REVIEW|CLOSED|EXPIRED`
- `output_schema_version key(32)`, `validated_output json:AiDraftOutput.<schema_version>`, `raw_output_object_key key(255) NULL`, `dropped_unsourced_count SMALLINT DEFAULT 0`
- `expires_at ts`, `opened_at ts NULL`, `closed_at ts NULL`, `row_version` (std)

**`ai_suggestions`** (std):
- `ai_draft_id FK→ai_drafts(tenant_id,id)`, `suggestion_type code(32)` CHECK `NOTE_SECTION|DIAGNOSIS|HISTORY_ITEM|PRESCRIPTION_ITEM|FOLLOW_UP` (last two not generated in MVP)
- `target_section code(24) NULL`, `source_refs json:SourceRefArray` (non-empty), `candidate json:SuggestionCandidate.<type>`, `edited_candidate json NULL`
- `confidence code(8)` CHECK `LOW|MEDIUM|HIGH|UNKNOWN`
- `status code(16)` CHECK `PENDING|ACCEPTED|EDITED|REJECTED|IGNORED|APPROVED`
- `reviewed_by_doctor_profile_id id36 NULL`, `reviewed_at ts NULL`, `row_version` (std)

**`ai_approvals`** (append-only, hash-chained per tenant):
- `id id36 PK`, `tenant_id`, `seq`
- `ai_suggestion_id FK→ai_suggestions(tenant_id,id)`, `suggestion_row_version INT UNSIGNED`
- `approved_target code(32)` CHECK `ENCOUNTER_NOTE_SECTION|DIAGNOSIS` (MVP)
- `approved_record_type key(48)`, `approved_record_id id36`, `approved_section code(24) NULL`
- `reviewer_doctor_profile_id FK→doctor_profiles(tenant_id,id)`, `attestation_version SMALLINT`, `approved_content_sha256 hash64`, `approved_at ts`
- `prev_row_hash`, `row_hash`
- UNIQUE **`uq_ai_approvals_once (tenant_id, ai_suggestion_id, suggestion_row_version)`**, UNIQUE `(tenant_id, seq)`

### 3.14 Operations and integrity (0014)

**`integrity_chain_checkpoints`**: `chain_key key(96) PK` (e.g. `audit:tenant:<id>`, `queue:chamber_day:<id>`, `timeline:patient:<id>`), `last_seq BIGINT UNSIGNED`, `last_row_hash hash64`, `verified_through_seq BIGINT UNSIGNED`, `verified_at ts NULL`, `updated_at ts`.
- **Chain head allocation:** `lockRow` on the checkpoint row (inserted if missing with `INSERT … ON DUPLICATE KEY UPDATE`) inside the writer transaction, then `seq = last_seq + 1`, `row_hash = sha256(last_row_hash ‖ canonical_json(row))`, and the checkpoint is updated. Per-chain locks are fine-grained (per chamber day, per patient, per tenant audit), so contention stays local.

**`backup_runs`**: `id id36 PK`, `environment code(16)`, `kind code(16)` CHECK `DB_DUMP|FILES`, `started_at ts`, `finished_at ts NULL`, `status code(16)` CHECK `RUNNING|SUCCEEDED|FAILED`, `object_key key(255) NULL`, `size_bytes BIGINT NULL`, `sha256 hash64 NULL`, `encryption_key_id key(32)`, `error_class key(64) NULL`.

**`restore_drills`**: `id id36 PK`, `backup_run_id id36`, `performed_by key(128)`, `target code(24)` CHECK `LOCAL_DOCKER|ISOLATED_STAGING`, `started_at ts`, `finished_at ts NULL`, `result code(16)` CHECK `PASSED|FAILED`, `checks json:RestoreChecks`, `notes text(1000) NULL`. Audited (platform chain).

### 3.15 Platform operators, gate decisions, provider credentials (0015) (Stage 3.2)

**`platform_operators`** (global):
- `id id36 PK`, `user_id FK→users(id)` UNIQUE
- `status code(16)` CHECK `ACTIVE|SUSPENDED|REVOKED`
- `permissions json:PlatformPermissionArray` (subset of the platform catalog, AUTHORIZATION-MATRIX §2)
- `granted_by key(128)` (CLI operator identity for the first grant, otherwise operator user id), `granted_at ts`, `revoked_at ts NULL`, `created_at`, `updated_at`, `row_version`
- Grants and revocations are written by `pnpm ops:platform-operator grant|revoke` (direct DB access) or by an operator holding `platform.operators.manage`, and always append a platform-chain audit event.

**`platform_gate_decisions`** (append-only, hash-chained `gate:platform`):
- `id id36 PK`, `seq BIGINT UNSIGNED` UNIQUE
- `gate_code code(48)` CHECK `GATE-SMS-HTTP|GATE-PAY-PLATFORM-COLLECTION`
- `environment code(16)` CHECK `staging|production`
- `decision code(16)` CHECK `ACCEPTED|REVOKED`
- `owner_name text(120)` (accountable business owner), `evidence_ref text(500)`, `notes text(1000) NULL`
- `decided_by key(128)`, `decided_at ts`, `expires_at ts NULL` (required for `ACCEPTED`: CHECK `decision <> 'ACCEPTED' OR expires_at IS NOT NULL`)
- `prev_row_hash`, `row_hash`
- **Effective state** of a gate for an environment = the latest row by `seq`. The gate is closed only if that row is `ACCEPTED` and `expires_at > now`. `GateDecisionReader` caches the result for ≤ 60 s.

**`provider_credentials`** (std; ADR-018 §6, ADR-019 §2):
- `owner_type code(16)` CHECK `TENANT|CLINIC|DOCTOR`, `clinic_id id36 NULL` FK→clinics(tenant_id,id), `doctor_profile_id id36 NULL` FK→doctor_profiles(tenant_id,id)
- `provider_kind code(16)` CHECK `SMS|PAYMENT`, `provider_code key(32)` (`zamanit`, `aamarpay`, `mock`), `environment code(8)` CHECK `sandbox|live|na`
- `public_identifier text(64) NULL` (SMS sender ID; **not** the payment store ID)
- `encrypted_secret key(4096)` (base64 `iv.ciphertext.tag` of the JSON bundle: SMS `{apiKey}`; payment `{storeId, signatureKey}`), `wrapped_data_key key(512)`, `key_id key(32)`
- `secret_last4 key(4)`, `identifier_last4 key(4) NULL` (store ID last 4), `secret_fingerprint hash64` (HMAC with `PROVIDER_CREDENTIAL_FINGERPRINT_PEPPER` over the bundle; tombstone on revoke as ADR-017)
- `status code(32)` CHECK `PENDING_VALIDATION|ACTIVE|UNVERIFIED_UNTIL_FIRST_PAYMENT|INVALID|SUSPENDED_BALANCE|DISABLED|REVOKED`
- `sender_id_status code(16) NULL` CHECK `UNVERIFIED|VERIFIED|INVALID`, `balance_alert_bdt money NULL`
- `validated_at ts NULL`, `last_error_class key(64) NULL`, `revoked_at ts NULL`, `revoked_by_user_id id36 NULL`, `row_version` (std)
- Generated `live_credential_key = IF(status <> 'REVOKED', CONCAT(provider_kind, ':', provider_code, ':', environment, ':', secret_fingerprint), NULL)`; UNIQUE `uq_provider_credentials_live (tenant_id, live_credential_key)`
- CHECKs: `owner_type <> 'DOCTOR' OR doctor_profile_id IS NOT NULL`; `owner_type <> 'CLINIC' OR clinic_id IS NOT NULL`; `provider_kind <> 'SMS' OR environment = 'na'`; `provider_kind <> 'PAYMENT' OR environment IN ('sandbox','live')`
- AAD = `credentialId|tenantId|providerKind|providerCode`; KEK `PROVIDER_CREDENTIAL_KEK` (`packages/secrets`)
- Index `(tenant_id, provider_kind, status)`

### 3.16 SMS (0016) (Stage 3.2, ADR-018)

**`sms_balance_snapshots`** (append-only): `id id36 PK`, `tenant_id id36 NULL`, `credential_scope code(16)` CHECK `PLATFORM|TENANT`, `credential_id id36 NULL` (composite FK `(tenant_id, credential_id)` → provider_credentials when `TENANT`), `provider_code key(32)`, `balance money NULL`, `currency_text key(8) NULL`, `parse_status code(16)` CHECK `PARSED|UNPARSED|ERROR`, `error_class key(64) NULL`, `checked_at ts`. CHECK `(credential_scope='PLATFORM' AND credential_id IS NULL AND tenant_id IS NULL) OR (credential_scope='TENANT' AND credential_id IS NOT NULL AND tenant_id IS NOT NULL)`. Index `(credential_scope, credential_id, checked_at)`. Retention 400 days (TTL job).

### 3.17 Payments (0017) (Stage 3.2, ADR-019; `PAYMENT-IMPLEMENTATION.md`)

**`tenant_payment_settings`** (std): UNIQUE `(tenant_id)`; `payment_contact_email text(254) NULL`, `platform_collection_opt_in bool DEFAULT 0`, `platform_commission_bps SMALLINT UNSIGNED DEFAULT 0` (set by platform operators only; business decision), `gateway_fee_bearer code(16)` CHECK `DOCTOR|PLATFORM` DEFAULT `DOCTOR`. CHECK `platform_commission_bps <= 10000`.

**`payment_merchant_accounts`** (std):
- `owner_type code(16)` CHECK `PLATFORM|CLINIC|DOCTOR`, `clinic_id id36 NULL` FK→clinics(tenant_id,id), `doctor_profile_id id36 NULL` FK→doctor_profiles(tenant_id,id)
- `mode code(20)` CHECK `PLATFORM_MERCHANT|DOCTOR_MERCHANT`
- `provider_code key(32)` (`aamarpay`, `mock`), `environment code(8)` CHECK `sandbox|live`
- `credential_source code(24)` CHECK `ENV_PLATFORM|PROVIDER_CREDENTIAL`, `credential_id id36 NULL` FK→provider_credentials(tenant_id,id)
- `fee_types_enabled json:FeeTypeArray`
- `status code(32)` CHECK `PENDING_VALIDATION|ACTIVE|UNVERIFIED_UNTIL_FIRST_PAYMENT|INVALID|DISABLED|BLOCKED_BY_GATE`, `last_error_class key(64) NULL`, `row_version` (std)
- CHECKs: `(mode='PLATFORM_MERCHANT' AND owner_type='PLATFORM' AND credential_source='ENV_PLATFORM' AND credential_id IS NULL) OR (mode='DOCTOR_MERCHANT' AND owner_type IN ('CLINIC','DOCTOR') AND credential_source='PROVIDER_CREDENTIAL' AND credential_id IS NOT NULL)`; `owner_type <> 'DOCTOR' OR doctor_profile_id IS NOT NULL`; `owner_type <> 'CLINIC' OR clinic_id IS NOT NULL`
- Generated `live_owner_key = IF(status NOT IN ('DISABLED','INVALID'), CONCAT(owner_type, ':', IFNULL(doctor_profile_id, IFNULL(clinic_id, 'tenant')), ':', provider_code, ':', environment), NULL)`; UNIQUE `uq_merchant_live_owner (tenant_id, live_owner_key)`

**`fee_schedules`** (std):
- `scope code(16)` CHECK `TENANT|DOCTOR|CHAMBER`, `doctor_profile_id id36 NULL` FK, `chamber_id id36 NULL` FK→chambers(tenant_id,id)
- `fee_type code(32)` CHECK `CHAMBER_CONSULTATION|TELEMEDICINE_CONSULTATION|FOLLOW_UP|REPORT_REVIEW`
- `amount money`, `currency key(3)` CHECK `currency = 'BDT'`, `effective_from ts`, `effective_to ts NULL`, `status code(16)` CHECK `ACTIVE|RETIRED`, `row_version` (std)
- CHECKs: `amount >= 0`; `effective_to IS NULL OR effective_to > effective_from`; `scope <> 'DOCTOR' OR doctor_profile_id IS NOT NULL`; `scope <> 'CHAMBER' OR chamber_id IS NOT NULL`
- Generated `open_schedule_key = IF(status='ACTIVE' AND effective_to IS NULL, CONCAT(scope, ':', IFNULL(chamber_id, IFNULL(doctor_profile_id, 'tenant')), ':', fee_type), NULL)`; UNIQUE `uq_fee_open (tenant_id, open_schedule_key)`. Bounded overlaps are rejected by `SetFeeSchedules` under a lock on the currently open row.

**`payment_intents`** (std):
- `payer_type code(16)` CHECK `USER|TENANT`, `payer_user_id id36 NULL` FK→users(id), `payer_patient_id id36 NULL` FK→patients(tenant_id,id), `acting_as code(16) NULL` CHECK `SELF|GUARDIAN|STAFF`
- `purpose code(24)` CHECK `APPOINTMENT_FEE|TELEMEDICINE_FEE|FOLLOW_UP_FEE|REPORT_REVIEW_FEE|SUBSCRIPTION`
- `business_type code(24)` CHECK `APPOINTMENT|SUBSCRIPTION_INVOICE`, `business_id id36`, `appointment_id id36 NULL` FK→appointments(tenant_id,id), `subscription_invoice_id id36 NULL` FK→subscription_invoices(tenant_id,id) (FK added in 0018)
- `fee_type code(32) NULL`, `fee_schedule_id id36 NULL` FK→fee_schedules(tenant_id,id)
- `merchant_mode code(20)` CHECK `PLATFORM_MERCHANT|DOCTOR_MERCHANT`, `merchant_account_id id36 NULL` FK→payment_merchant_accounts(tenant_id,id), `provider_code key(32)`, `environment code(8)` CHECK `sandbox|live`
- `amount money`, `currency key(3)` CHECK `currency = 'BDT'`
- `tran_id key(32)` **UNIQUE** (global; `hm` + 30 Crockford base32), `short_ref key(8)`
- `status code(24)` CHECK `CREATED|REDIRECTED|PENDING_VERIFICATION|PAID|FAILED|CANCELLED|EXPIRED|REFUND_PENDING|REFUNDED`, `failure_reason key(48) NULL`
- `return_channel code(8)` CHECK `WEB|ANDROID|IOS`, `expires_at ts`, `paid_at ts NULL`, `verified_pg_txnid key(64) NULL`
- `late_payment bool`, `manual_review_status code(24) NULL` CHECK `OPEN|RESOLVED_HONORED|RESOLVED_REFUNDED`
- `idempotency_key key(191)`, `created_by_user_id id36 NULL`, `row_version` (std)
- CHECKs:
  - `amount > 0`
  - `purpose <> 'SUBSCRIPTION' OR (merchant_mode='PLATFORM_MERCHANT' AND merchant_account_id IS NULL AND business_type='SUBSCRIPTION_INVOICE' AND subscription_invoice_id IS NOT NULL AND payer_type='TENANT')`
  - `purpose = 'SUBSCRIPTION' OR (merchant_account_id IS NOT NULL AND business_type='APPOINTMENT' AND appointment_id IS NOT NULL)`
  - `status <> 'PAID' OR (paid_at IS NOT NULL AND verified_pg_txnid IS NOT NULL)`
- Generated `open_business_key = IF(status IN ('CREATED','REDIRECTED','PENDING_VERIFICATION'), CONCAT(business_type, ':', business_id), NULL)`; UNIQUE `uq_intent_open_business (tenant_id, open_business_key)`
- Generated `paid_business_key = IF(status IN ('PAID','REFUND_PENDING') AND late_payment = 0, CONCAT(business_type, ':', business_id), NULL)`; UNIQUE `uq_intent_paid_business (tenant_id, paid_business_key)` (a verified duplicate payment is stored as `late_payment=1` with manual review)
- Indexes `ix_intents_reconcile (status, expires_at)`, `(tenant_id, created_at)`, `(tenant_id, payer_user_id, created_at)`

**`payment_attempts`** (std): `intent_id FK→payment_intents(tenant_id,id)`, `attempt_no SMALLINT`, `requested_at ts`, `response_class code(24)` CHECK `CREATED|REJECTED|UNKNOWN_OUTCOME`, `error_class key(48) NULL`, `gateway_message key(128) NULL` (allow-listed safe messages only), `payment_url_sha256 hash64 NULL`, `latency_ms INT UNSIGNED`. UNIQUE `(tenant_id, intent_id, attempt_no)`.

**`payment_gateway_events`** (insert-mostly; only `verification_id`/`verified_at` may be set once):
- `id id36 PK`, `tenant_id id36 NULL` (null when unmatched), `intent_id id36 NULL` (composite FK when matched)
- `source code(16)` CHECK `RETURN_SUCCESS|RETURN_FAIL|RETURN_CANCEL|IPN`, `provider_code key(32)`
- `pg_txnid key(64) NULL`, `mer_txnid key(64) NULL`, `status_code key(8) NULL`, `amount_text key(24) NULL`, `content_type key(96) NULL`
- `payload_redacted json:RedactedGatewayPayload` (allow-listed keys only, AAMARPAY-VERIFICATION §2.2)
- `suspect_forgery bool`, `unmatched bool`, `received_at ts`, `verification_id id36 NULL`, `verified_at ts NULL`
- Generated `dedupe_key = IF(pg_txnid IS NOT NULL, CONCAT(pg_txnid, ':', IFNULL(status_code, '-'), ':', source), NULL)`; UNIQUE `uq_gateway_event_dedupe (dedupe_key)`. A duplicate delivery hits the unique key; the handler still re-runs verification idempotently.
- Index `(tenant_id, intent_id, received_at)`, `(unmatched, received_at)`

**`payment_verifications`** (append-only): `id id36 PK`, `tenant_id`, `intent_id FK→payment_intents(tenant_id,id)`, `trigger code(16)` CHECK `RETURN|IPN|RECONCILE|MANUAL`, `gateway_event_id id36 NULL`, `requested_at ts`, `latency_ms INT UNSIGNED`, `result code(24)` CHECK `MATCHED_SUCCESS|NOT_SUCCESSFUL|NOT_FOUND|MISMATCH|CREDENTIAL_MISMATCH|UNAVAILABLE|UNPARSEABLE`, `gateway_status_code key(8) NULL`, `pg_txnid key(64) NULL`, `amount_text key(24) NULL`, `currency_text key(8) NULL`, `store_id_last4 key(4) NULL`, `mismatch_fields json:StringArray NULL`, `fee_amount money NULL`, `received_amount money NULL`, `normalized json:NormalizedGatewayRecord` (redacted). Index `(tenant_id, intent_id, requested_at)`.

**`ledger_entries`** (append-only, hash-chained `ledger:tenant:<id>`):
- `id id36 PK`, `tenant_id`, `seq BIGINT UNSIGNED`, `posting_id id36`
- `account code(32)` CHECK `GATEWAY_CLEARING|GATEWAY_RECEIVED|GATEWAY_FEE|PLATFORM_COMMISSION|DOCTOR_PAYABLE|MERCHANT_DIRECT_REVENUE|PLATFORM_SUBSCRIPTION_REVENUE|REFUNDS|PAYOUTS_CLEARING`
- `amount smoney` (signed), `currency key(3)` CHECK `currency = 'BDT'`
- `entry_type code(24)` CHECK `PAYMENT|FEE|COMMISSION|REFUND|PAYOUT|ADJUSTMENT`, `merchant_mode code(20)`
- `doctor_profile_id id36 NULL`, `intent_id id36 NULL`, `refund_id id36 NULL`, `payout_id id36 NULL` (composite FKs)
- `fee_unverified bool`, `occurred_at ts`, `prev_row_hash`, `row_hash`
- UNIQUE `(tenant_id, seq)`; indexes `(posting_id)`, `(tenant_id, doctor_profile_id, account, occurred_at)`
- **Invariant:** the entries of every `posting_id` sum to 0.00 (use case assertion + `VerifyAppendOnlyChains` check).

**`refunds`** (std): `intent_id FK→payment_intents(tenant_id,id)`, `amount money`, `reason text(500)`, `status code(16)` CHECK `PENDING|COMPLETED|CANCELLED`, `method code(32)` CHECK `MANUAL_GATEWAY_PANEL|MANUAL_SUPPORT_REQUEST`, `evidence_ref text(300) NULL`, `requested_by_user_id id36`, `completed_by_user_id id36 NULL`, `completed_at ts NULL`, `row_version`. CHECKs `amount > 0`; `status <> 'COMPLETED' OR (evidence_ref IS NOT NULL AND completed_at IS NOT NULL)`. Generated `open_refund_key = IF(status IN ('PENDING','COMPLETED'), intent_id, NULL)`; UNIQUE `(tenant_id, open_refund_key)` (MVP: one full refund per intent; `amount = intent.amount` enforced by the use case).

**`payouts`** (std; created by platform operators; `PLATFORM_MERCHANT` patient fees only): `doctor_profile_id FK→doctor_profiles(tenant_id,id)`, `period_start date`, `period_end date`, `amount money`, `status code(16)` CHECK `DRAFT|PAID|CANCELLED`, `transfer_method code(16)` CHECK `BANK|MFS|OTHER`, `transfer_reference text(120) NULL`, `paid_at ts NULL`, `recorded_by_user_id id36`, `row_version`. CHECKs `period_end >= period_start`; `status <> 'PAID' OR (transfer_reference IS NOT NULL AND paid_at IS NOT NULL)`.

**`payout_items`**: `payout_id` + `tenant_id` (composite FK→payouts), `ledger_entry_id id36` UNIQUE (composite FK→ledger_entries), `amount money`. Each `DOCTOR_PAYABLE` entry is paid at most once.

### 3.18 Subscriptions (0018) (Stage 3.2, ADR-019)

**`subscription_plans`** (global): `id id36 PK`, `code key(32)` UNIQUE, `name text(120)`, `period code(8)` CHECK `MONTH|YEAR`, `amount money`, `currency key(3)` CHECK `currency = 'BDT'`, `active bool`, `created_at`, `updated_at`, `row_version`. Plan names and prices are business decisions; seeds use synthetic `DEMO-` plans.

**`subscriptions`** (std): `plan_id FK→subscription_plans(id)`, `status code(16)` CHECK `TRIALING|ACTIVE|PAST_DUE|CANCELLED`, `current_period_start date`, `current_period_end date`, `cancel_at_period_end bool`, `row_version`. Generated `live_subscription_key = IF(status <> 'CANCELLED', 'live', NULL)`; UNIQUE `(tenant_id, live_subscription_key)`. `PAST_DUE` is informational in MVP (no feature lock; business decision).

**`subscription_invoices`** (std): `subscription_id FK→subscriptions(tenant_id,id)`, `period_start date`, `period_end date`, `amount money`, `currency key(3)` CHECK `currency = 'BDT'`, `status code(16)` CHECK `OPEN|PAID|VOID|OVERDUE`, `due_date date`, `paid_intent_id id36 NULL`, `row_version`. UNIQUE `(tenant_id, subscription_id, period_start)`. Adds FK `payment_intents.subscription_invoice_id` → `subscription_invoices(tenant_id,id)`.

---

## 4. Integrity rules

### 4.1 Generated-column unique keys (complete list)

| Table | Generated column | Non-null when | Unique index |
|---|---|---|---|
| `idempotency_records` | `tenant_scope` | always (`IFNULL(tenant_id,'platform')`) | `(tenant_scope, scope, idem_key)` |
| `clinics` | `active_name_key` | active, not deleted | `(tenant_id, active_name_key)` |
| `otp_challenges` | `pending_key` | `status='PENDING'` | `(pending_key)` |
| `push_devices` | `active_token_key` | not revoked | `(active_token_key)` |
| `patient_contacts` | `active_contact_key` | `status='ACTIVE'` | `(tenant_id, active_contact_key)` |
| `patient_identifiers` | `verified_identifier_key` | verified | `(tenant_id, verified_identifier_key)` |
| `patient_merge_cases` | `open_source_key` | `OPEN`/`IN_REVIEW` | `(tenant_id, open_source_key)` |
| `patient_accounts` | `live_account_key` | `PENDING`/`ACTIVE` | `(tenant_id, live_account_key)` |
| `patient_guardianships` | `live_guardianship_key` | `PENDING`/`ACTIVE` | `(tenant_id, live_guardianship_key)` |
| `care_team_members` | `open_member_key` | `ends_at IS NULL` | `(tenant_id, open_member_key)` |
| `serials` | `active_patient_day_key` | non-terminal status and no override | `(tenant_id, active_patient_day_key)` |
| `check_ins` | `active_serial_key` | not revoked | `(tenant_id, active_serial_key)` |
| `encounters` | `serial_encounter_key` | status ≠ `ENTERED_IN_ERROR` | `(tenant_id, serial_encounter_key)` |
| `encounter_notes` | `open_draft_key` | `DRAFT` | `(tenant_id, open_draft_key)` |
| `prescriptions` | `approved_encounter_key` | `APPROVED` | `(tenant_id, approved_encounter_key)` |
| `prescriptions` | `open_draft_encounter_key` | `DRAFT`/`REVIEWED` | `(tenant_id, open_draft_encounter_key)` |
| `telemedicine_sessions` | `active_encounter_key` | `PENDING`/`ACTIVE` | `(tenant_id, active_encounter_key)` |
| `ai_data_use_acknowledgements` | `live_ack_key` | not revoked | `(tenant_id, live_ack_key)` |
| `provider_credentials` | `live_credential_key` | not revoked | `(tenant_id, live_credential_key)` |
| `payment_merchant_accounts` | `live_owner_key` | not disabled/invalid | `(tenant_id, live_owner_key)` |
| `fee_schedules` | `open_schedule_key` | active and open-ended | `(tenant_id, open_schedule_key)` |
| `payment_intents` | `open_business_key` | `CREATED`/`REDIRECTED`/`PENDING_VERIFICATION` | `(tenant_id, open_business_key)` |
| `payment_intents` | `paid_business_key` | `PAID`/`REFUND_PENDING`, not late | `(tenant_id, paid_business_key)` |
| `payment_gateway_events` | `dedupe_key` | `pg_txnid` present | `(dedupe_key)` |
| `refunds` | `open_refund_key` | `PENDING`/`COMPLETED` | `(tenant_id, open_refund_key)` |
| `subscriptions` | `live_subscription_key` | not cancelled | `(tenant_id, live_subscription_key)` |
| `medication_dataset_imports` | `succeeded_version_key` | `SUCCEEDED` | `(succeeded_version_key)` |
| `medication_dataset_imports` | `active_import_key` | `QUEUED`/`RUNNING` | `(active_import_key)` |

Rules for all generated keys:
- source columns are `VARCHAR`/integer, never `CHAR`;
- expression literals are ASCII;
- the column is `VARCHAR … ascii_bin PERSISTENT`;
- engine-contract tests insert a duplicate for each row of this table and assert error 1062 with the named index.

### 4.2 Composite tenant foreign keys

- **Mandatory minimum** (ADR-014): `serials`, `encounters`, `encounter_notes`, `diagnoses`, `prescriptions`, `prescription_items`, `documents`, `lab_reports`, `timeline_events`, `communications`, `ai_jobs`, `ai_drafts`, `ai_suggestions`, `ai_approvals`, `ai_provider_credentials`, and (Stage 3.2) `provider_credentials`, `payment_merchant_accounts`, `fee_schedules`, `payment_intents`, `payment_attempts`, `payment_verifications`, `ledger_entries`, `refunds`, `payouts`, `payout_items`, `subscriptions`, `subscription_invoices`, `communication_attempts.credential_id`.
- **Contract:** every FK from a tenant-owned table to a tenant-owned table is composite `(tenant_id, x_id) → parent(tenant_id, id)`. This covers every `FK→t(tenant_id,id)` in §3.
- **Test `composite-tenant-fk.spec.ts`:**
  - reads `information_schema.KEY_COLUMN_USAGE`;
  - fails if any FK between two tables that both have `tenant_id` lacks the `tenant_id` column pair;
  - inserts a child referencing a parent id from another tenant and expects error 1452.

### 4.3 Append-only tables and chains

| Table | Hash chain key | Allowed mutation |
|---|---|---|
| `audit_logs` | `audit:tenant:<id>` / `audit:platform` | none |
| `queue_events` | `queue:chamber_day:<id>` | none |
| `timeline_events` | `timeline:patient:<id>` | none (redaction = new marker row) |
| `encounter_note_versions` | `note:encounter:<id>` | none |
| `ai_approvals` | `ai-approval:tenant:<id>` | none |
| `tenant_ai_policy_events` | `ai-policy:tenant:<id>` | none |
| `ai_usage_ledger` | — | none |
| `provider_webhook_events` | — | none |
| `platform_gate_decisions` | `gate:platform` | none |
| `ledger_entries` | `ledger:tenant:<id>` | none |
| `payment_verifications` | — | none |
| `medication_dataset_gate_attestations` | `meddata:platform` | none |
| `sms_balance_snapshots` | — | none (TTL delete only) |
| `payment_gateway_events` | — | insert; `verification_id`/`verified_at` set once (`WHERE verification_id IS NULL`) |

Enforcement (no triggers):
1. `AppendOnlyRepository<T>` exposes `insert` and read methods only.
2. ESLint rule `hmedic/no-append-only-mutation` forbids `update`, `updateMany`, `upsert`, `delete` and `deleteMany` on these Prisma delegates, and raw SQL is already confined.
3. A per-table integration test asserts that the repository has no mutating method.
4. `VerifyAppendOnlyChains` runs daily (maintenance queue) and on demand: it recomputes hashes from `verified_through_seq`, and on mismatch raises `INTEGRITY_CHAIN_BROKEN` (critical alert, security audit event). Detection, not prevention, is recorded as an accepted risk (ADR-014).

### 4.4 Other invariants

- One encounter per serial (generated unique). Serial `COMPLETED` through `CompleteEncounter` requires `encounter_id` (application, tested). Serials completed through the pre-clinical ADR-021 commands (Stage 5, until Stage 6) keep `encounter_id` NULL.
- One approved and one open-draft prescription per encounter (generated uniques). A correction voids the approved revision and approves the new revision **in one transaction** (void first, then approve).
- Only `APPROVED` prescriptions render patient-facing PDFs (CHECK plus use case).
- `diagnoses.source='ai_approved'` ⇒ `ai_approval_id` set (CHECK) and an `ai_approvals` row exists (FK).
- `deleted_at` never substitutes for voiding or clinical correction.
- JSON columns are validated with Zod on write and read; a read failure raises `DATA_INTEGRITY_ERROR` (500 plus alert), never silent coercion.
- **Money (Stage 3.2):** every `ledger_entries` posting sums to zero; a `PAID` intent has exactly one `MATCHED_SUCCESS` verification it was transitioned on; a `PENDING_PAYMENT` appointment has no serial; nothing in `payments` writes clinical tables (dependency rule + DI test).
- **Catalog (Stage 3.2):** medication rows referenced by prescriptions are never deleted; `medication_price_observations` with `is_official_mrp=0` are never labelled MRP (API DTO has no MRP field for them).

---

## 5. TTL and retention jobs

| Table | Rule | Job |
|---|---|---|
| `rate_limit_counters` | delete `expires_at < now` | `MaintenanceTtlCleanup` (every 10 min) |
| `otp_challenges` | delete `expires_at < now − 1 day` (status updated to `EXPIRED` lazily) | same |
| `idempotency_records` | delete `expires_at < now` and `status <> 'IN_PROGRESS'`; `IN_PROGRESS` older than 1 h → delete (crashed request never committed its mutation, so the record is orphaned only if the tx failed; safe) | same |
| `sessions` | delete revoked or expired older than 30 days | same |
| `refresh_tokens` | delete where session deleted, or `expires_at < now − 30 days` | same |
| `password_reset_tokens`, `email_verification_tokens` | delete `expires_at < now − 1 day` | same |
| `jobs` | delete `SUCCEEDED`/`CANCELLED` older than `JOB_RETENTION_SUCCEEDED_DAYS` (14), `FAILED` older than `JOB_RETENTION_FAILED_DAYS` (90); never `DEAD` | same |
| `outbox_events` | delete `PUBLISHED` older than 30 days and ≤ all projection checkpoints | same |
| `upload_sessions` + parts | `OPEN` past `expires_at` → `EXPIRED`, delete temp parts via storage port | `ExpireUploadSessions` (hourly) |
| `ai_usage_counters` | delete `window_start < now − 35 days` | `MaintenanceTtlCleanup` |
| AI raw outputs (object storage) | delete objects older than tenant `raw_output_retention_days` | `PurgeAIRawOutputs` (daily) |
| `ai_drafts` | status → `EXPIRED` per AI-IMPLEMENTATION §7.1 | `ExpireAIDrafts` (hourly) |
| `communication_short_links` | delete `expires_at < now − 7 days` | `MaintenanceTtlCleanup` |
| `sms_balance_snapshots` | delete `checked_at < now − 400 days` | `MaintenanceTtlCleanup` |
| `payment_intents` | `REDIRECTED`/`PENDING_VERIFICATION` re-verified; past `expires_at` without success → `EXPIRED` (never deleted) | `ReconcilePaymentIntents` (every 5 min) |
| `appointments` | `PENDING_PAYMENT` past `payment_hold_expires_at` (+ grace) with no paid intent → `CANCELLED` (`PAYMENT_NOT_COMPLETED`), capacity released | `ReleasePaymentHolds` (every 5 min) |
| `payment_gateway_events` | `unmatched=1` older than 180 days deleted; matched rows follow payment record retention (legal research gate) | `MaintenanceTtlCleanup` |

All deletes run in batches of ≤ 1,000 rows with a time budget, and report counts to metrics. Clinical records have **no** automatic deletion; retention policy remains a legal research gate.

---

## 6. Tests (database layer)

- **Engine contract** (`packages/database/test/engine-contract/`, pinned image and staging HOST-003):
  - SKIP LOCKED with EXPLAIN (no filesort) for `jobs` and `outbox_events`;
  - conditional claim;
  - every generated unique (§4.1);
  - every CHECK list == Zod enum;
  - JSON validity;
  - lock-wait 1205 mapping;
  - deadlock 1213 retry (two transactions locking two rows in opposite order);
  - `GET_LOCK` exclusivity across connections.
- **Bangla round-trip:** insert `patients.legal_name_bn` with NFC Bangla text (and mixed Banglish), read it back byte-equal; a case-insensitive Latin match works; Bangla digits are preserved.
- **Asia/Dhaka boundary with DATETIME UTC:** chamber day `local_date=2026-09-17`, instants `2026-09-16T18:00:00Z` (00:00 local) and `2026-09-17T17:59:59.999Z` (23:59:59.999 local) resolve to that chamber day; `2026-09-17T18:00:00Z` does not. No `DATE(utc)` truncation anywhere (lint: forbid `DATE(` on `ts` columns in raw SQL).
- **Composite tenant FK** (§4.2) and **append-only repository** (§4.3) tests.
- **Migration:** clean database → all migrations → `db:migration:lint` → Prisma client generation → schema snapshot diff.
- **Row version:** concurrent updates with the same `expectedRowVersion` → exactly one succeeds.
- **Two API processes allocating serials** against the same container (QUEUE-CONCURRENCY-DESIGN §7).
- **Stage 3.2:** money columns are `DECIMAL` (migration lint rejects `FLOAT`/`DOUBLE`/`REAL` anywhere); `DECIMAL(12,2)` round-trip of `"0.01"`, `"9999999999.99"`; concurrent return + IPN verifying the same intent → one `PAID` transition, one ledger posting; ledger posting sum-zero check; duplicate gateway event hits `uq_gateway_event_dedupe`; importer idempotency (same version twice → no changes) and resume from checkpoint; deactivation never deletes a referenced medication; generated uniques for all Stage 3.2 rows of §4.1.
