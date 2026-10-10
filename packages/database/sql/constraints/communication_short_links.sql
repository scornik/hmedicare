ALTER TABLE `communication_short_links` ADD CONSTRAINT `fk_communication_short_links_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `communication_short_links` ADD CONSTRAINT `chk_communication_short_links_target_type` CHECK (target_type IN ('SERIAL','APPOINTMENT','PAYMENT_INTENT','PRESCRIPTION','DOCUMENT_LIST'));
ALTER TABLE `communication_short_links` ADD CONSTRAINT `chk_communication_short_links_expiry` CHECK (expires_at > created_at);
