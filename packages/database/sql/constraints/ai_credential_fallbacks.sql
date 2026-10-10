ALTER TABLE `ai_credential_fallbacks` ADD CONSTRAINT `fk_ai_fallback_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `ai_credential_fallbacks` ADD CONSTRAINT `fk_ai_fallback_doctor` FOREIGN KEY (`tenant_id`,`doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`,`id`);
ALTER TABLE `ai_credential_fallbacks` ADD CONSTRAINT `fk_ai_fallback_credential_scope` FOREIGN KEY (`tenant_id`,`doctor_profile_id`,`credential_id`) REFERENCES `ai_provider_credentials` (`tenant_id`,`doctor_profile_id`,`id`);
ALTER TABLE `ai_credential_fallbacks` ADD CONSTRAINT `chk_ai_fallback_position` CHECK (position > 0 AND row_version > 0);
