-- Constraints for `medication_generic_links` (DATABASE-IMPLEMENTATION.md §3.8).
ALTER TABLE `medication_generic_links` ADD CONSTRAINT `fk_medication_generic_links_medication` FOREIGN KEY (`medication_id`) REFERENCES `medications` (`id`);
ALTER TABLE `medication_generic_links` ADD CONSTRAINT `fk_medication_generic_links_generic` FOREIGN KEY (`generic_id`) REFERENCES `medication_generics` (`id`);
