-- Constraints for `medication_generics` (DATABASE-IMPLEMENTATION.md §3.8).
CREATE INDEX `ix_medication_generics_name` ON `medication_generics` (`name_search_key`(191));
