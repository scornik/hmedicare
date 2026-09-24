-- Constraints for `patient_medications` (DATABASE-IMPLEMENTATION.md §3.8).
ALTER TABLE `patient_medications` ADD CONSTRAINT `chk_patient_medications_status` CHECK (status IN ('ACTIVE', 'STOPPED', 'ENTERED_IN_ERROR'));
-- A catalog entry or a name the patient gave, and at least one of them. A patient arrives with a strip of
-- tablets whose brand is in no dataset; refusing to record that would lose the most clinically important
-- thing in the room.
ALTER TABLE `patient_medications` ADD CONSTRAINT `chk_patient_medications_identity` CHECK (medication_id IS NOT NULL OR free_text_name IS NOT NULL);
ALTER TABLE `patient_medications` ADD CONSTRAINT `fk_patient_medications_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `patient_medications` ADD CONSTRAINT `fk_patient_medications_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `patient_medications` ADD CONSTRAINT `fk_patient_medications_medication` FOREIGN KEY (`medication_id`) REFERENCES `medications` (`id`);
ALTER TABLE `patient_medications` ADD CONSTRAINT `fk_patient_medications_encounter` FOREIGN KEY (`tenant_id`, `source_encounter_id`) REFERENCES `encounters` (`tenant_id`, `id`);
