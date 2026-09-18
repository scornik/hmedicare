-- Constraints for `push_devices` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `push_devices` ADD CONSTRAINT `chk_push_devices_platform` CHECK (platform IN ('ANDROID', 'IOS', 'WEB'));
ALTER TABLE `push_devices` ADD CONSTRAINT `chk_push_devices_app` CHECK (app IN ('DOCTOR_APP', 'PATIENT_APP', 'WEB'));
ALTER TABLE `push_devices` ADD CONSTRAINT `fk_push_devices_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `push_devices` ADD COLUMN `active_token_key` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin AS (IF(revoked_at IS NULL, token_hash, NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_push_active_token` ON `push_devices` (`active_token_key`);
