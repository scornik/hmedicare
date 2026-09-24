-- Constraints for `medication_aliases` (DATABASE-IMPLEMENTATION.md §3.8).
ALTER TABLE `medication_aliases` ADD CONSTRAINT `chk_medication_aliases_target_type` CHECK (target_type IN ('MEDICATION', 'GENERIC'));
ALTER TABLE `medication_aliases` ADD CONSTRAINT `chk_medication_aliases_script` CHECK (script IN ('latin', 'bengali'));
ALTER TABLE `medication_aliases` ADD CONSTRAINT `chk_medication_aliases_kind` CHECK (kind IN ('brand_bn', 'banglish', 'brand_variant', 'generic_variant'));
ALTER TABLE `medication_aliases` ADD CONSTRAINT `chk_medication_aliases_origin` CHECK (alias_origin IN ('source', 'generated'));
-- An alias points at exactly one thing. A row claiming both, or neither, is a bug that would surface as a
-- search result belonging to nothing.
ALTER TABLE `medication_aliases` ADD CONSTRAINT `chk_medication_aliases_target` CHECK ((target_type = 'MEDICATION' AND medication_id IS NOT NULL AND generic_id IS NULL) OR (target_type = 'GENERIC' AND generic_id IS NOT NULL AND medication_id IS NULL));
ALTER TABLE `medication_aliases` ADD CONSTRAINT `fk_medication_aliases_medication` FOREIGN KEY (`medication_id`) REFERENCES `medications` (`id`);
ALTER TABLE `medication_aliases` ADD CONSTRAINT `fk_medication_aliases_generic` FOREIGN KEY (`generic_id`) REFERENCES `medication_generics` (`id`);
CREATE INDEX `ix_medication_aliases_search` ON `medication_aliases` (`active`, `alias_search_key`(191));
