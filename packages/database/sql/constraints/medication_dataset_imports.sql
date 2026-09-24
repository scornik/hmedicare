-- Constraints for `medication_dataset_imports` (DATABASE-IMPLEMENTATION.md §3.8).
ALTER TABLE `medication_dataset_imports` ADD CONSTRAINT `chk_medication_dataset_imports_path` CHECK (execution_path IN ('CLI', 'JOB'));
ALTER TABLE `medication_dataset_imports` ADD CONSTRAINT `chk_medication_dataset_imports_status` CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'REFUSED'));
-- A refusal says why. "REFUSED" with no reason is the shape of a gate that was skipped rather than failed.
ALTER TABLE `medication_dataset_imports` ADD CONSTRAINT `chk_medication_dataset_imports_refusal` CHECK (status <> 'REFUSED' OR refusal_reason IS NOT NULL);
-- One successful import per dataset version, and one active import at a time. Two importers writing the
-- same catalog concurrently would interleave upserts and leave a version nobody can reproduce.
ALTER TABLE `medication_dataset_imports` ADD COLUMN `succeeded_version_key` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin AS (IF(status = 'SUCCEEDED', dataset_version, NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_medication_dataset_imports_succeeded` ON `medication_dataset_imports` (`succeeded_version_key`);
ALTER TABLE `medication_dataset_imports` ADD COLUMN `active_import_key` VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin AS (IF(status IN ('QUEUED', 'RUNNING'), 'active', NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_medication_dataset_imports_active` ON `medication_dataset_imports` (`active_import_key`);
