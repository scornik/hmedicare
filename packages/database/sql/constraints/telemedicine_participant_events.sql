ALTER TABLE `telemedicine_participant_events` ADD CONSTRAINT `fk_telemedicine_events_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `telemedicine_participant_events` ADD CONSTRAINT `fk_telemedicine_events_session` FOREIGN KEY (`tenant_id`,`session_id`) REFERENCES `telemedicine_sessions` (`tenant_id`,`id`);
ALTER TABLE `telemedicine_participant_events` ADD CONSTRAINT `fk_telemedicine_events_participant` FOREIGN KEY (`tenant_id`,`session_id`,`participant_id`) REFERENCES `telemedicine_participants` (`tenant_id`,`session_id`,`id`);
ALTER TABLE `telemedicine_participant_events` ADD CONSTRAINT `chk_telemedicine_events_kind` CHECK (kind IN ('JOINED','LEFT','RECONNECTED'));
