-- Constraints for `encounters` (DATABASE-IMPLEMENTATION.md §3.7). Appended by db:migration:normalize.
ALTER TABLE `encounters` ADD CONSTRAINT `chk_encounters_status` CHECK (status IN ('IN_PROGRESS', 'INTERRUPTED', 'COMPLETED', 'ENTERED_IN_ERROR'));
ALTER TABLE `encounters` ADD CONSTRAINT `chk_encounters_care_mode` CHECK (care_mode IN ('PHYSICAL', 'REMOTE', 'HYBRID'));
-- An encounter voided as entered-in-error has to say why; the row stays for the audit trail.
ALTER TABLE `encounters` ADD CONSTRAINT `chk_encounters_error_reason` CHECK (status <> 'ENTERED_IN_ERROR' OR entered_in_error_reason IS NOT NULL);
-- A covering doctor is recorded with the grant that allowed it, never one without the other.
ALTER TABLE `encounters` ADD CONSTRAINT `chk_encounters_covering_pair` CHECK ((covering_doctor_profile_id IS NULL) = (doctor_coverage_id IS NULL));
ALTER TABLE `encounters` ADD CONSTRAINT `fk_encounters_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `encounters` ADD CONSTRAINT `fk_encounters_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `encounters` ADD CONSTRAINT `fk_encounters_doctor` FOREIGN KEY (`tenant_id`, `doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
ALTER TABLE `encounters` ADD CONSTRAINT `fk_encounters_chamber` FOREIGN KEY (`tenant_id`, `chamber_id`) REFERENCES `chambers` (`tenant_id`, `id`);
ALTER TABLE `encounters` ADD CONSTRAINT `fk_encounters_serial` FOREIGN KEY (`tenant_id`, `serial_id`) REFERENCES `serials` (`tenant_id`, `id`);
ALTER TABLE `encounters` ADD CONSTRAINT `fk_encounters_appointment` FOREIGN KEY (`tenant_id`, `appointment_id`) REFERENCES `appointments` (`tenant_id`, `id`);
ALTER TABLE `encounters` ADD CONSTRAINT `fk_encounters_coverage` FOREIGN KEY (`tenant_id`, `doctor_coverage_id`) REFERENCES `doctor_coverages` (`tenant_id`, `id`);
-- One encounter per serial, enforced by the database rather than by the service that writes it. A row
-- voided as entered-in-error drops out of the key so the serial can be started again.
ALTER TABLE `encounters` ADD COLUMN `serial_encounter_key` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin AS (IF(status <> 'ENTERED_IN_ERROR', serial_id, NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_encounters_serial` ON `encounters` (`tenant_id`, `serial_encounter_key`);
-- The serial's back-pointer, added here because `serials` (0006) predates this table.
ALTER TABLE `serials` ADD CONSTRAINT `fk_serials_encounter` FOREIGN KEY (`tenant_id`, `encounter_id`) REFERENCES `encounters` (`tenant_id`, `id`);
