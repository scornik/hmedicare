-- Constraints for `check_ins` (DATABASE-IMPLEMENTATION.md §3.6). Appended by db:migration:normalize.
ALTER TABLE `check_ins` ADD CONSTRAINT `chk_check_ins_method` CHECK (method IN ('STAFF_DESK', 'PATIENT_APP', 'REMOTE_READY', 'KIOSK'));
ALTER TABLE `check_ins` ADD CONSTRAINT `fk_check_ins_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `check_ins` ADD CONSTRAINT `fk_check_ins_serial` FOREIGN KEY (`tenant_id`, `serial_id`) REFERENCES `serials` (`tenant_id`, `id`);
ALTER TABLE `check_ins` ADD COLUMN `active_serial_key` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin AS (IF(revoked_at IS NULL, serial_id, NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_check_ins_active` ON `check_ins` (`tenant_id`, `active_serial_key`);
