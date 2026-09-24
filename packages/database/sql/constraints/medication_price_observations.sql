-- Constraints for `medication_price_observations` (DATABASE-IMPLEMENTATION.md §3.8).
-- An observation with no price is not an observation.
ALTER TABLE `medication_price_observations` ADD CONSTRAINT `chk_medication_price_observations_value` CHECK (unit_price IS NOT NULL OR pack_price IS NOT NULL);
ALTER TABLE `medication_price_observations` ADD CONSTRAINT `fk_medication_price_observations_medication` FOREIGN KEY (`medication_id`) REFERENCES `medications` (`id`);
