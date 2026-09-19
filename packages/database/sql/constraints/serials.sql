-- Constraints for `serials` (DATABASE-IMPLEMENTATION.md §3.6). Appended by db:migration:normalize.
ALTER TABLE `serials` ADD CONSTRAINT `chk_serials_source` CHECK (source IN ('ADVANCE_BOOKING', 'WALK_IN', 'FOLLOW_UP', 'RESCHEDULE'));
ALTER TABLE `serials` ADD CONSTRAINT `chk_serials_care_mode` CHECK (care_mode IN ('PHYSICAL', 'REMOTE', 'HYBRID'));
ALTER TABLE `serials` ADD CONSTRAINT `chk_serials_status` CHECK (status IN ('BOOKED', 'CONFIRMED', 'CHECKED_IN', 'WAITING', 'CALLED', 'IN_CONSULTATION', 'SKIPPED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED', 'COMPLETED'));
ALTER TABLE `serials` ADD CONSTRAINT `chk_serials_override_reason` CHECK (duplicate_override = 0 OR duplicate_override_reason IS NOT NULL);
ALTER TABLE `serials` ADD CONSTRAINT `fk_serials_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `serials` ADD CONSTRAINT `fk_serials_day` FOREIGN KEY (`tenant_id`, `chamber_day_id`) REFERENCES `chamber_days` (`tenant_id`, `id`);
ALTER TABLE `serials` ADD CONSTRAINT `fk_serials_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `serials` ADD CONSTRAINT `fk_serials_appointment` FOREIGN KEY (`tenant_id`, `appointment_id`) REFERENCES `appointments` (`tenant_id`, `id`);
ALTER TABLE `serials` ADD CONSTRAINT `fk_serials_rescheduled_from` FOREIGN KEY (`tenant_id`, `rescheduled_from_serial_id`) REFERENCES `serials` (`tenant_id`, `id`);
ALTER TABLE `serials` ADD COLUMN `active_patient_day_key` VARCHAR(73) CHARACTER SET ascii COLLATE ascii_bin AS (IF(status IN ('BOOKED', 'CONFIRMED', 'CHECKED_IN', 'WAITING', 'CALLED', 'SKIPPED', 'IN_CONSULTATION') AND duplicate_override = 0, CONCAT(chamber_day_id, ':', patient_id), NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_serials_active_patient_day` ON `serials` (`tenant_id`, `active_patient_day_key`);
