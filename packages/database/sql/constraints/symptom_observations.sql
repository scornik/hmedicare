-- Constraints for `symptom_observations` (DATABASE-IMPLEMENTATION.md §3.8). Appended by db:migration:normalize.
ALTER TABLE `symptom_observations` ADD CONSTRAINT `chk_symptom_observations_severity` CHECK (severity IS NULL OR severity IN ('MILD', 'MODERATE', 'SEVERE', 'UNKNOWN'));
ALTER TABLE `symptom_observations` ADD CONSTRAINT `chk_symptom_observations_source` CHECK (source IN ('PATIENT_REPORTED', 'CLINICIAN_OBSERVED', 'AI_APPROVED'));
ALTER TABLE `symptom_observations` ADD CONSTRAINT `chk_symptom_observations_certainty` CHECK (certainty IN ('CONFIRMED', 'PROVISIONAL', 'DIFFERENTIAL'));
ALTER TABLE `symptom_observations` ADD CONSTRAINT `chk_symptom_observations_status` CHECK (status IN ('ACTIVE', 'ENTERED_IN_ERROR'));
-- A code without the system that issued it says nothing, and a system without a code is an empty label.
ALTER TABLE `symptom_observations` ADD CONSTRAINT `chk_symptom_observations_coding` CHECK ((normalized_code IS NULL) = (code_system IS NULL));
ALTER TABLE `symptom_observations` ADD CONSTRAINT `fk_symptom_observations_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `symptom_observations` ADD CONSTRAINT `fk_symptom_observations_encounter` FOREIGN KEY (`tenant_id`, `encounter_id`) REFERENCES `encounters` (`tenant_id`, `id`);
ALTER TABLE `symptom_observations` ADD CONSTRAINT `fk_symptom_observations_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
