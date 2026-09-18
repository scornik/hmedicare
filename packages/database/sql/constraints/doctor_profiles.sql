-- Constraints for `doctor_profiles` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `doctor_profiles` ADD CONSTRAINT `chk_doctor_profiles_status` CHECK (status IN ('ACTIVE', 'INACTIVE'));
ALTER TABLE `doctor_profiles` ADD CONSTRAINT `fk_doctor_profiles_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `doctor_profiles` ADD CONSTRAINT `fk_doctor_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `tenants` ADD CONSTRAINT `fk_tenants_owner_doctor` FOREIGN KEY (`id`, `owner_doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
