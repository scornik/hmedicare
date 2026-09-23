-- Constraints for `diagnoses` (DATABASE-IMPLEMENTATION.md §3.8). Appended by db:migration:normalize.
ALTER TABLE `diagnoses` ADD CONSTRAINT `chk_diagnoses_clinical_status` CHECK (clinical_status IN ('ACTIVE', 'RESOLVED', 'RULED_OUT', 'ENTERED_IN_ERROR'));
ALTER TABLE `diagnoses` ADD CONSTRAINT `chk_diagnoses_certainty` CHECK (certainty IN ('CONFIRMED', 'PROVISIONAL', 'DIFFERENTIAL'));
-- `ai_approved` is reachable only from Stage 10, which adds `ai_approval_id` and the CHECK that pairs
-- them (0013). Until then the value exists in the domain and nothing can write it.
ALTER TABLE `diagnoses` ADD CONSTRAINT `chk_diagnoses_source` CHECK (source IN ('doctor', 'ai_approved'));
-- A code without the system that issued it says nothing, and a system without a code is an empty label.
ALTER TABLE `diagnoses` ADD CONSTRAINT `chk_diagnoses_coding` CHECK ((code IS NULL) = (code_system IS NULL));
-- Voiding is the only way a signed diagnosis changes, so a voided row carries who did it, when and why,
-- and a row that is not voided carries none of those.
ALTER TABLE `diagnoses` ADD CONSTRAINT `chk_diagnoses_void` CHECK ((clinical_status = 'ENTERED_IN_ERROR') = (void_reason IS NOT NULL AND voided_at IS NOT NULL AND voided_by_doctor_profile_id IS NOT NULL));
ALTER TABLE `diagnoses` ADD CONSTRAINT `fk_diagnoses_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `diagnoses` ADD CONSTRAINT `fk_diagnoses_encounter` FOREIGN KEY (`tenant_id`, `encounter_id`) REFERENCES `encounters` (`tenant_id`, `id`);
ALTER TABLE `diagnoses` ADD CONSTRAINT `fk_diagnoses_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `diagnoses` ADD CONSTRAINT `fk_diagnoses_author` FOREIGN KEY (`tenant_id`, `author_doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
ALTER TABLE `diagnoses` ADD CONSTRAINT `fk_diagnoses_voided_by` FOREIGN KEY (`tenant_id`, `voided_by_doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
ALTER TABLE `diagnoses` ADD CONSTRAINT `fk_diagnoses_replaces` FOREIGN KEY (`tenant_id`, `replaces_diagnosis_id`) REFERENCES `diagnoses` (`tenant_id`, `id`);
