ALTER TABLE `timeline_projection_receipts` ADD CONSTRAINT `chk_timeline_receipt_version` CHECK (projection_version > 0);
ALTER TABLE `timeline_projection_receipts` ADD CONSTRAINT `chk_timeline_receipt_outcome` CHECK (outcome IN ('PROJECTED', 'IGNORED'));
ALTER TABLE `timeline_projection_receipts` ADD CONSTRAINT `fk_timeline_receipt_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
