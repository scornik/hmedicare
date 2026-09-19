-- Constraints for `patient_identifiers` (DATABASE-IMPLEMENTATION.md §3.4). Appended by db:migration:normalize.
ALTER TABLE `patient_identifiers` ADD CONSTRAINT `chk_patient_identifiers_type` CHECK (identifier_type IN ('NID', 'BIRTH_REGISTRATION', 'PASSPORT', 'OTHER'));
ALTER TABLE `patient_identifiers` ADD CONSTRAINT `chk_patient_identifiers_source` CHECK (source IN ('STAFF', 'PATIENT', 'IMPORT'));
ALTER TABLE `patient_identifiers` ADD CONSTRAINT `chk_patient_identifiers_verification` CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED'));
ALTER TABLE `patient_identifiers` ADD CONSTRAINT `fk_patient_identifiers_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `patient_identifiers` ADD CONSTRAINT `fk_patient_identifiers_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `patient_identifiers` ADD COLUMN `verified_identifier_key` VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin AS (IF(verification_status = 'VERIFIED', CONCAT(identifier_type, ':', identifier_value_hash), NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_patient_identifiers_verified` ON `patient_identifiers` (`tenant_id`, `verified_identifier_key`);
