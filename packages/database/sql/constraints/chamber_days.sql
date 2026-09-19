-- Constraints for `chamber_days` (DATABASE-IMPLEMENTATION.md §3.5). Appended by db:migration:normalize.
ALTER TABLE `chamber_days` ADD CONSTRAINT `chk_chamber_days_status` CHECK (status IN ('SCHEDULED', 'OPEN', 'PAUSED', 'CLOSED', 'CANCELLED'));
ALTER TABLE `chamber_days` ADD CONSTRAINT `chk_chamber_days_times` CHECK (local_end_time > local_start_time);
ALTER TABLE `chamber_days` ADD CONSTRAINT `chk_chamber_days_closed` CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL);
ALTER TABLE `chamber_days` ADD CONSTRAINT `fk_chamber_days_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `chamber_days` ADD CONSTRAINT `fk_chamber_days_chamber` FOREIGN KEY (`tenant_id`, `chamber_id`) REFERENCES `chambers` (`tenant_id`, `id`);
ALTER TABLE `chamber_days` ADD CONSTRAINT `fk_chamber_days_doctor` FOREIGN KEY (`tenant_id`, `doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
