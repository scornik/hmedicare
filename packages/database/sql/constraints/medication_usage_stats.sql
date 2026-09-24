-- Constraints for `medication_usage_stats` (DATABASE-IMPLEMENTATION.md §3.8).
ALTER TABLE `medication_usage_stats` ADD CONSTRAINT `fk_medication_usage_stats_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `medication_usage_stats` ADD CONSTRAINT `fk_medication_usage_stats_medication` FOREIGN KEY (`medication_id`) REFERENCES `medications` (`id`);
