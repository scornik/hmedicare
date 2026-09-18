-- Constraints for `staff_profiles` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `staff_profiles` ADD CONSTRAINT `chk_staff_profiles_status` CHECK (status IN ('ACTIVE', 'INACTIVE'));
ALTER TABLE `staff_profiles` ADD CONSTRAINT `fk_staff_profiles_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `staff_profiles` ADD CONSTRAINT `fk_staff_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
