ALTER TABLE `provider_webhook_events` ADD CONSTRAINT `fk_provider_webhook_events_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `provider_webhook_events` ADD CONSTRAINT `fk_provider_webhook_events_attempt` FOREIGN KEY (`tenant_id`,`mapped_attempt_id`) REFERENCES `communication_attempts` (`tenant_id`,`id`);
ALTER TABLE `provider_webhook_events` ADD CONSTRAINT `chk_provider_webhook_events_mapping` CHECK (mapped_attempt_id IS NULL OR (tenant_id IS NOT NULL AND signature_valid = 1));
