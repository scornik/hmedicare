-- Constraints for `encounter_participants` (DATABASE-IMPLEMENTATION.md §3.7).
ALTER TABLE `encounter_participants` ADD CONSTRAINT `chk_encounter_participants_type` CHECK (participant_type IN ('DOCTOR', 'STAFF', 'PATIENT', 'GUARDIAN', 'INTERPRETER', 'EXTERNAL'));
ALTER TABLE `encounter_participants` ADD CONSTRAINT `chk_encounter_participants_authorization` CHECK (authorization_status IN ('INVITED', 'AUTHORIZED', 'REVOKED'));
ALTER TABLE `encounter_participants` ADD CONSTRAINT `fk_encounter_participants_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `encounter_participants` ADD CONSTRAINT `fk_encounter_participants_encounter` FOREIGN KEY (`tenant_id`, `encounter_id`) REFERENCES `encounters` (`tenant_id`, `id`);
