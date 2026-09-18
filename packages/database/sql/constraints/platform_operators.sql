-- Constraints for `platform_operators` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `platform_operators` ADD CONSTRAINT `chk_platform_operators_status` CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED'));
ALTER TABLE `platform_operators` ADD CONSTRAINT `fk_platform_operators_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
