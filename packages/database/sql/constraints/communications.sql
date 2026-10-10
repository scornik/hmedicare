ALTER TABLE `communications` ADD CONSTRAINT `fk_communications_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `communications` ADD CONSTRAINT `fk_communications_patient` FOREIGN KEY (`tenant_id`,`patient_id`) REFERENCES `patients` (`tenant_id`,`id`);
ALTER TABLE `communications` ADD CONSTRAINT `fk_communications_consent` FOREIGN KEY (`tenant_id`,`consent_id`) REFERENCES `patient_consents` (`tenant_id`,`id`);
ALTER TABLE `communications` ADD CONSTRAINT `fk_communications_fallback` FOREIGN KEY (`tenant_id`,`fallback_of_communication_id`) REFERENCES `communications` (`tenant_id`,`id`);
ALTER TABLE `communications` ADD CONSTRAINT `chk_communications_channel` CHECK (channel IN ('in_app','email','sms','whatsapp','push','phone'));
ALTER TABLE `communications` ADD CONSTRAINT `chk_communications_status` CHECK (status IN ('CREATED','CONSENT_CHECKED','QUEUED','SENDING','SENT','DELIVERED','READ','FAILED','RETRY_SCHEDULED','CANCELLED'));
ALTER TABLE `communications` ADD CONSTRAINT `chk_communications_version` CHECK (row_version > 0);
