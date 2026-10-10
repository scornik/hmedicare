ALTER TABLE `communication_preferences` ADD CONSTRAINT `fk_communication_preferences_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `communication_preferences` ADD CONSTRAINT `fk_communication_preferences_patient` FOREIGN KEY (`tenant_id`,`patient_id`) REFERENCES `patients` (`tenant_id`,`id`);
ALTER TABLE `communication_preferences` ADD CONSTRAINT `fk_communication_preferences_contact` FOREIGN KEY (`tenant_id`,`contact_id`) REFERENCES `patient_contacts` (`tenant_id`,`id`);
ALTER TABLE `communication_preferences` ADD CONSTRAINT `chk_communication_preferences_channel` CHECK (channel IN ('in_app','email','sms','whatsapp','push','phone'));
ALTER TABLE `communication_preferences` ADD CONSTRAINT `chk_communication_preferences_preference` CHECK (preference IN ('OPT_IN','OPT_OUT'));
ALTER TABLE `communication_preferences` ADD CONSTRAINT `chk_communication_preferences_version` CHECK (row_version > 0);
ALTER TABLE `communication_preferences` ADD CONSTRAINT `chk_communication_preferences_dates` CHECK (effective_to IS NULL OR effective_to >= effective_from);
