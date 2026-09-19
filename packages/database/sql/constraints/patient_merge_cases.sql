-- Constraints for `patient_merge_cases` (DATABASE-IMPLEMENTATION.md §3.4). Appended by db:migration:normalize.
ALTER TABLE `patient_merge_cases` ADD CONSTRAINT `chk_patient_merge_cases_status` CHECK (status IN ('OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'REVERSED'));
ALTER TABLE `patient_merge_cases` ADD CONSTRAINT `chk_patient_merge_cases_distinct` CHECK (source_patient_id <> target_patient_id);
ALTER TABLE `patient_merge_cases` ADD CONSTRAINT `fk_patient_merge_cases_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `patient_merge_cases` ADD CONSTRAINT `fk_patient_merge_cases_source` FOREIGN KEY (`tenant_id`, `source_patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `patient_merge_cases` ADD CONSTRAINT `fk_patient_merge_cases_target` FOREIGN KEY (`tenant_id`, `target_patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `patient_merge_cases` ADD COLUMN `open_source_key` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin AS (IF(status IN ('OPEN', 'IN_REVIEW'), source_patient_id, NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_merge_open_source` ON `patient_merge_cases` (`tenant_id`, `open_source_key`);
