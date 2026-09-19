-- Constraints for `patient_guardianships` (DATABASE-IMPLEMENTATION.md §3.4). Appended by db:migration:normalize.
ALTER TABLE `patient_guardianships` ADD CONSTRAINT `chk_patient_guardianships_relationship` CHECK (relationship IN ('PARENT', 'LEGAL_GUARDIAN', 'SPOUSE', 'CHILD', 'OTHER_CAREGIVER'));
ALTER TABLE `patient_guardianships` ADD CONSTRAINT `chk_patient_guardianships_method` CHECK (verification_method IS NULL OR verification_method IN ('STAFF_VERIFIED_IN_PERSON', 'STAFF_VERIFIED_DOCUMENT'));
ALTER TABLE `patient_guardianships` ADD CONSTRAINT `chk_patient_guardianships_status` CHECK (status IN ('PENDING', 'ACTIVE', 'ENDED', 'REVOKED'));
ALTER TABLE `patient_guardianships` ADD CONSTRAINT `chk_patient_guardianships_window` CHECK (ends_on IS NULL OR ends_on >= starts_on);
ALTER TABLE `patient_guardianships` ADD CONSTRAINT `chk_patient_guardianships_distinct` CHECK (guardian_patient_id IS NULL OR guardian_patient_id <> dependent_patient_id);
ALTER TABLE `patient_guardianships` ADD CONSTRAINT `chk_patient_guardianships_scope_json` CHECK (JSON_VALID(authority_scope));
ALTER TABLE `patient_guardianships` ADD CONSTRAINT `fk_patient_guardianships_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `patient_guardianships` ADD CONSTRAINT `fk_patient_guardianships_user` FOREIGN KEY (`guardian_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `patient_guardianships` ADD CONSTRAINT `fk_patient_guardianships_guardian` FOREIGN KEY (`tenant_id`, `guardian_patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `patient_guardianships` ADD CONSTRAINT `fk_patient_guardianships_dependent` FOREIGN KEY (`tenant_id`, `dependent_patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `patient_guardianships` ADD COLUMN `live_guardianship_key` VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin AS (IF(status IN ('PENDING', 'ACTIVE'), CONCAT(guardian_user_id, ':', dependent_patient_id), NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_guardianships_live` ON `patient_guardianships` (`tenant_id`, `live_guardianship_key`);
