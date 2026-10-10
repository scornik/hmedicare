ALTER TABLE `tenant_ai_policies` ADD CONSTRAINT `fk_tenant_ai_policy_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `tenant_ai_policies` ADD CONSTRAINT `fk_tenant_ai_policy_decider` FOREIGN KEY (`decided_by_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `tenant_ai_policies` ADD CONSTRAINT `chk_tenant_ai_policy_retention` CHECK (raw_output_retention_days BETWEEN 0 AND 3650);
ALTER TABLE `tenant_ai_policies` ADD CONSTRAINT `chk_tenant_ai_policy_versions` CHECK (row_version > 0 AND policy_version > 0 AND min_ai_consent_policy_version > 0);
ALTER TABLE `tenant_ai_policies` ADD CONSTRAINT `chk_tenant_ai_policy_providers` CHECK (JSON_TYPE(allowed_provider_codes) = 'ARRAY');
ALTER TABLE `tenant_ai_policies` ADD CONSTRAINT `chk_tenant_ai_policy_decision` CHECK ((decided_at IS NULL AND decided_by_user_id IS NULL) OR (decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL));
