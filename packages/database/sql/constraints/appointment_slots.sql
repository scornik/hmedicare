-- Constraints for `appointment_slots` (DATABASE-IMPLEMENTATION.md §3.5). Appended by db:migration:normalize.
ALTER TABLE `appointment_slots` ADD CONSTRAINT `chk_appointment_slots_status` CHECK (status IN ('OPEN', 'FULL', 'CLOSED'));
ALTER TABLE `appointment_slots` ADD CONSTRAINT `chk_appointment_slots_times` CHECK (ends_at > starts_at);
ALTER TABLE `appointment_slots` ADD CONSTRAINT `chk_appointment_slots_booked` CHECK (booked_count <= capacity);
ALTER TABLE `appointment_slots` ADD CONSTRAINT `fk_appointment_slots_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `appointment_slots` ADD CONSTRAINT `fk_appointment_slots_day` FOREIGN KEY (`tenant_id`, `chamber_day_id`) REFERENCES `chamber_days` (`tenant_id`, `id`);
