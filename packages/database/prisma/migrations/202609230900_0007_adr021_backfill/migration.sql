-- hmedic:normalized v1
-- Migration 202609230900_0007_adr021_backfill. Hand-written data migration (no schema change).
-- It carries section 0007, the section whose tables it fills: a data migration has no section of its own,
-- and claiming the next free number would make `migration-new.mjs 0008` refuse to create the real 0008.
-- Never edit after it has been applied anywhere (scripts/ci/check-applied-migrations.mjs).
--
-- Stage 6 retires ADR-021. Stage 5 moved serials through IN_CONSULTATION and COMPLETED with no encounter
-- behind them, because encounters did not exist yet. Those serials now sit in states that the clinical
-- model says are impossible: `serials.encounter_id` is null while the status claims a consultation
-- happened.
--
-- Rather than leave a shape no invariant covers, each one gets a backfilled encounter marked
-- `legacy_interim = 1`. It carries no note, because no note was ever written — a consultation that was
-- recorded only as a queue transition has no clinical content, and inventing an empty draft would suggest
-- a doctor looked at a record they never opened.
--
-- The encounter's id is the serial's id. Deliberate: it makes the backfill idempotent by construction (a
-- second run inserts nothing), and it makes a legacy row traceable to its serial by inspection. Ids are
-- unique within their own table, so reusing one across tables collides with nothing.
--
-- Times come from the serial's own timestamps where Stage 5 recorded them, falling back to `updated_at`
-- so a row is never given a start in the future or a completion before its start.

INSERT INTO `encounters` (
  `id`, `tenant_id`, `patient_id`, `doctor_profile_id`, `chamber_id`, `serial_id`, `appointment_id`,
  `legacy_interim`, `care_mode`, `status`, `started_at`, `completed_at`, `created_at`, `updated_at`,
  `row_version`
)
SELECT
  s.`id`,
  s.`tenant_id`,
  s.`patient_id`,
  cd.`doctor_profile_id`,
  cd.`chamber_id`,
  s.`id`,
  s.`appointment_id`,
  1,
  s.`care_mode`,
  IF(s.`status` = 'COMPLETED', 'COMPLETED', 'IN_PROGRESS'),
  COALESCE(s.`consultation_started_at`, s.`called_at`, s.`updated_at`),
  IF(s.`status` = 'COMPLETED', COALESCE(s.`completed_at`, s.`updated_at`), NULL),
  COALESCE(s.`consultation_started_at`, s.`called_at`, s.`updated_at`),
  s.`updated_at`,
  1
FROM `serials` s
JOIN `chamber_days` cd ON cd.`tenant_id` = s.`tenant_id` AND cd.`id` = s.`chamber_day_id`
WHERE s.`status` IN ('IN_CONSULTATION', 'COMPLETED')
  AND s.`encounter_id` IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `encounters` e WHERE e.`tenant_id` = s.`tenant_id` AND e.`serial_id` = s.`id`
  );

-- Point each serial at the encounter that now represents its consultation. Restricted to the rows this
-- migration created, so re-running cannot repoint a serial at something else.
UPDATE `serials` s
JOIN `encounters` e
  ON e.`tenant_id` = s.`tenant_id` AND e.`id` = s.`id` AND e.`legacy_interim` = 1
SET s.`encounter_id` = e.`id`
WHERE s.`encounter_id` IS NULL;
