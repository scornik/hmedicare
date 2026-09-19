-- Constraints for `patient_contacts` (DATABASE-IMPLEMENTATION.md §3.4). Appended by db:migration:normalize.
ALTER TABLE `patient_contacts` ADD CONSTRAINT `chk_patient_contacts_type` CHECK (type IN ('PHONE', 'EMAIL', 'WHATSAPP'));
ALTER TABLE `patient_contacts` ADD CONSTRAINT `chk_patient_contacts_verification` CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED'));
ALTER TABLE `patient_contacts` ADD CONSTRAINT `chk_patient_contacts_status` CHECK (status IN ('ACTIVE', 'INACTIVE'));
ALTER TABLE `patient_contacts` ADD CONSTRAINT `chk_patient_contacts_relationship` CHECK (relationship IN ('SELF', 'CAREGIVER', 'EMERGENCY'));
ALTER TABLE `patient_contacts` ADD CONSTRAINT `fk_patient_contacts_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `patient_contacts` ADD CONSTRAINT `fk_patient_contacts_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `patient_contacts` ADD COLUMN `active_contact_key` VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin AS (IF(status = 'ACTIVE', CONCAT(patient_id, ':', type, ':', normalized_value_hash), NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_patient_contacts_active` ON `patient_contacts` (`tenant_id`, `active_contact_key`);
