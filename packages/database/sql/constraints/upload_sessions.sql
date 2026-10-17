-- Durable, tenant-bound upload claims. Storage I/O runs outside database transactions.
ALTER TABLE `upload_sessions` ADD CONSTRAINT `chk_upload_sessions_adapter` CHECK (storage_adapter IN ('disk', 's3'));
ALTER TABLE `upload_sessions` ADD CONSTRAINT `chk_upload_sessions_status` CHECK (status IN ('OPEN', 'FINALIZING', 'FINALIZED', 'ABORTED', 'EXPIRED'));
ALTER TABLE `upload_sessions` ADD CONSTRAINT `chk_upload_sessions_revision` CHECK (target_revision >= 1);
ALTER TABLE `upload_sessions` ADD CONSTRAINT `chk_upload_sessions_size` CHECK (expected_size_bytes BETWEEN 1 AND 209715200);
ALTER TABLE `upload_sessions` ADD CONSTRAINT `chk_upload_sessions_part_size` CHECK (part_size_bytes BETWEEN 1 AND 8388608);
ALTER TABLE `upload_sessions` ADD CONSTRAINT `chk_upload_sessions_claim` CHECK (status <> 'FINALIZING' OR (finalize_lease_until IS NOT NULL AND finalize_parts_sha256 IS NOT NULL));
ALTER TABLE `upload_sessions` ADD CONSTRAINT `chk_upload_sessions_finalized` CHECK (status <> 'FINALIZED' OR finalized_at IS NOT NULL);
ALTER TABLE `upload_sessions` ADD CONSTRAINT `fk_upload_sessions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `upload_sessions` ADD CONSTRAINT `fk_upload_sessions_document` FOREIGN KEY (`tenant_id`, `document_id`) REFERENCES `documents` (`tenant_id`, `id`);
ALTER TABLE `upload_sessions` ADD CONSTRAINT `fk_upload_sessions_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`);
