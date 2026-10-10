ALTER TABLE `ai_data_use_acknowledgements` ADD COLUMN `live_ack_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin AS (IF(revoked_at IS NULL, CONCAT(doctor_profile_id, ':', provider_code, ':', tier, ':', terms_text_version), NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_ai_ack_live` ON `ai_data_use_acknowledgements` (`tenant_id`,`live_ack_key`);
ALTER TABLE `ai_data_use_acknowledgements` ADD CONSTRAINT `fk_ai_ack_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `ai_data_use_acknowledgements` ADD CONSTRAINT `fk_ai_ack_doctor` FOREIGN KEY (`tenant_id`,`doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`,`id`);
ALTER TABLE `ai_data_use_acknowledgements` ADD CONSTRAINT `fk_ai_ack_actor` FOREIGN KEY (`acknowledged_by_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `ai_data_use_acknowledgements` ADD CONSTRAINT `chk_ai_ack_tier` CHECK (tier IN ('FREE','PAID'));
ALTER TABLE `ai_data_use_acknowledgements` ADD CONSTRAINT `chk_ai_ack_revocation` CHECK ((revoked_at IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL AND revoke_reason IN ('TEXT_VERSION_SUPERSEDED','DOCTOR_WITHDREW','ADMIN')));
ALTER TABLE `ai_data_use_acknowledgements` ADD CONSTRAINT `chk_ai_ack_version` CHECK (row_version > 0);
