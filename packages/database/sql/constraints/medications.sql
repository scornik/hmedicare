-- Constraints for `medications` (DATABASE-IMPLEMENTATION.md §3.8). Appended by db:migration:normalize.
ALTER TABLE `medications` ADD CONSTRAINT `chk_medications_dgda_match` CHECK (dgda_match IN ('MATCHED', 'NOT_FOUND', 'AMBIGUOUS', 'NOT_CHECKED'));
ALTER TABLE `medications` ADD CONSTRAINT `chk_medications_review_status` CHECK (review_status IN ('UNVERIFIED', 'SAMPLED_REVIEWED', 'VERIFIED'));
-- A row is deactivated by an import, and the import that did it is part of the record. Without this a
-- deactivated medication could not be traced to the dataset version that withdrew it.
ALTER TABLE `medications` ADD CONSTRAINT `chk_medications_deactivation` CHECK (active = 1 OR deactivated_in_version IS NOT NULL);
ALTER TABLE `medications` ADD CONSTRAINT `fk_medications_manufacturer` FOREIGN KEY (`manufacturer_id`) REFERENCES `medication_manufacturers` (`id`);
-- `canonical_key` is compared as bytes: two brands differing only in case are two brands.
ALTER TABLE `medications` MODIFY `canonical_key` VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
-- Search reads these under `active`, and 191 characters is the utf8mb4 index-prefix limit.
CREATE INDEX `ix_med_brand` ON `medications` (`active`, `brand_search_key`(191));
CREATE INDEX `ix_med_brand_bn` ON `medications` (`active`, `brand_bn_search_key`(191));
CREATE INDEX `ix_med_generic` ON `medications` (`active`, `generic_set_key`(191));
