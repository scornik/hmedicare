-- Constraints for `clinics` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `clinics` ADD CONSTRAINT `chk_clinics_status` CHECK (status IN ('ACTIVE', 'INACTIVE'));
ALTER TABLE `clinics` ADD CONSTRAINT `fk_clinics_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `clinics` ADD COLUMN `active_name_key` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin AS (IF(status = 'ACTIVE' AND deleted_at IS NULL, name_normalized_hash, NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_clinics_active_name` ON `clinics` (`tenant_id`, `active_name_key`);
