-- Constraints for `doctor_coverages` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `doctor_coverages` ADD CONSTRAINT `chk_doctor_coverages_status` CHECK (status IN ('ACTIVE', 'REVOKED'));
ALTER TABLE `doctor_coverages` ADD CONSTRAINT `chk_doctor_coverages_window` CHECK (ends_at > starts_at);
ALTER TABLE `doctor_coverages` ADD CONSTRAINT `chk_doctor_coverages_distinct_doctors` CHECK (covered_doctor_profile_id <> covering_doctor_profile_id);
ALTER TABLE `doctor_coverages` ADD CONSTRAINT `fk_doctor_coverages_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `doctor_coverages` ADD CONSTRAINT `fk_doctor_coverages_covered` FOREIGN KEY (`tenant_id`, `covered_doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
ALTER TABLE `doctor_coverages` ADD CONSTRAINT `fk_doctor_coverages_covering` FOREIGN KEY (`tenant_id`, `covering_doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
