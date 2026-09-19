-- Constraints for `doctor_schedule_rules` (DATABASE-IMPLEMENTATION.md §3.5). Appended by db:migration:normalize.
ALTER TABLE `doctor_schedule_rules` ADD CONSTRAINT `chk_doctor_schedule_rules_type` CHECK (rule_type IN ('WEEKLY', 'EXCEPTION_OPEN', 'EXCEPTION_CLOSED'));
ALTER TABLE `doctor_schedule_rules` ADD CONSTRAINT `chk_doctor_schedule_rules_times` CHECK (local_end_time > local_start_time);
ALTER TABLE `doctor_schedule_rules` ADD CONSTRAINT `chk_doctor_schedule_rules_weekly` CHECK (rule_type <> 'WEEKLY' OR weekday IS NOT NULL);
ALTER TABLE `doctor_schedule_rules` ADD CONSTRAINT `chk_doctor_schedule_rules_exception` CHECK (rule_type = 'WEEKLY' OR exception_date IS NOT NULL);
ALTER TABLE `doctor_schedule_rules` ADD CONSTRAINT `chk_doctor_schedule_rules_weekday` CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7);
ALTER TABLE `doctor_schedule_rules` ADD CONSTRAINT `fk_doctor_schedule_rules_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `doctor_schedule_rules` ADD CONSTRAINT `fk_doctor_schedule_rules_chamber` FOREIGN KEY (`tenant_id`, `chamber_id`) REFERENCES `chambers` (`tenant_id`, `id`);
ALTER TABLE `doctor_schedule_rules` ADD CONSTRAINT `fk_doctor_schedule_rules_doctor` FOREIGN KEY (`tenant_id`, `doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
