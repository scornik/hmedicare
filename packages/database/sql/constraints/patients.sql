-- Constraints for `patients` (DATABASE-IMPLEMENTATION.md §3.4). Appended by db:migration:normalize.
ALTER TABLE `patients` ADD CONSTRAINT `chk_patients_sex` CHECK (sex IS NULL OR sex IN ('FEMALE', 'MALE', 'INTERSEX', 'UNKNOWN'));
ALTER TABLE `patients` ADD CONSTRAINT `chk_patients_status` CHECK (status IN ('ACTIVE', 'MERGED', 'INACTIVE'));
ALTER TABLE `patients` ADD CONSTRAINT `chk_patients_merged_pointer` CHECK (status <> 'MERGED' OR merged_into_patient_id IS NOT NULL);
ALTER TABLE `patients` ADD CONSTRAINT `chk_patients_not_self_merge` CHECK (merged_into_patient_id IS NULL OR merged_into_patient_id <> id);
ALTER TABLE `patients` ADD CONSTRAINT `chk_patients_address_json` CHECK (address IS NULL OR JSON_VALID(address));
ALTER TABLE `patients` ADD CONSTRAINT `fk_patients_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `patients` ADD CONSTRAINT `fk_patients_merged_into` FOREIGN KEY (`tenant_id`, `merged_into_patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
