ALTER TABLE `telemedicine_participants` ADD CONSTRAINT `fk_telemedicine_participants_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `telemedicine_participants` ADD CONSTRAINT `fk_telemedicine_participants_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `telemedicine_sessions` (`tenant_id`,`id`);
ALTER TABLE `telemedicine_participants` ADD CONSTRAINT `fk_telemedicine_participants_user` FOREIGN KEY (`participant_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `telemedicine_participants` ADD CONSTRAINT `fk_telemedicine_participants_patient` FOREIGN KEY (`tenant_id`,`participant_patient_id`) REFERENCES `patients` (`tenant_id`,`id`);
ALTER TABLE `telemedicine_participants` ADD CONSTRAINT `chk_telemedicine_participants_type` CHECK (participant_type IN ('STAFF','PATIENT_CONTEXT'));
ALTER TABLE `telemedicine_participants` ADD CONSTRAINT `chk_telemedicine_participants_role` CHECK (role IN ('DOCTOR','STAFF','PATIENT','GUARDIAN'));
ALTER TABLE `telemedicine_participants` ADD CONSTRAINT `chk_telemedicine_participants_authorization` CHECK (authorization_state IN ('AUTHORIZED','REVOKED'));
ALTER TABLE `telemedicine_participants` ADD CONSTRAINT `chk_telemedicine_participants_identity` CHECK ((participant_type = 'STAFF' AND participant_patient_id IS NULL AND role IN ('DOCTOR','STAFF')) OR (participant_type = 'PATIENT_CONTEXT' AND participant_patient_id IS NOT NULL AND role IN ('PATIENT','GUARDIAN')));
ALTER TABLE `telemedicine_participants` ADD CONSTRAINT `chk_telemedicine_participants_version` CHECK (row_version > 0);
