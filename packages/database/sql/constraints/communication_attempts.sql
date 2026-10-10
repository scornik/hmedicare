ALTER TABLE `communication_attempts` ADD CONSTRAINT `fk_communication_attempts_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `communication_attempts` ADD CONSTRAINT `fk_communication_attempts_communication` FOREIGN KEY (`tenant_id`,`communication_id`) REFERENCES `communications` (`tenant_id`,`id`);
ALTER TABLE `communication_attempts` ADD CONSTRAINT `fk_communication_attempts_credential` FOREIGN KEY (`tenant_id`,`sms_credential_id`) REFERENCES `provider_credentials` (`tenant_id`,`id`);
ALTER TABLE `communication_attempts` ADD CONSTRAINT `chk_communication_attempts_status` CHECK (status IN ('SENDING','SENT','DELIVERED','READ','FAILED','UNKNOWN'));
ALTER TABLE `communication_attempts` ADD CONSTRAINT `chk_communication_attempts_sms_credential_scope` CHECK (sms_credential_scope IS NULL OR sms_credential_scope IN ('PLATFORM','TENANT'));
ALTER TABLE `communication_attempts` ADD CONSTRAINT `chk_communication_attempts_encoding` CHECK (encoding IS NULL OR encoding IN ('text','unicode'));
ALTER TABLE `communication_attempts` ADD CONSTRAINT `chk_communication_attempts_outcome_class` CHECK (outcome_class IS NULL OR outcome_class IN ('ACCEPTED','REJECTED','PROVIDER_UNAVAILABLE','UNKNOWN_OUTCOME','RATE_LIMITED'));
ALTER TABLE `communication_attempts` ADD CONSTRAINT `chk_communication_attempts_version` CHECK (row_version > 0);
ALTER TABLE `communication_attempts` ADD CONSTRAINT `chk_communication_attempts_number` CHECK (attempt_number > 0);
