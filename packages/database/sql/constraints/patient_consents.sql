-- Constraints for `patient_consents` (DATABASE-IMPLEMENTATION.md §3.4). Appended by db:migration:normalize.
ALTER TABLE `patient_consents` ADD CONSTRAINT `chk_patient_consents_purpose` CHECK (purpose IN ('care', 'in_app', 'sms', 'whatsapp', 'email', 'telemedicine', 'ai_assistance', 'research'));
ALTER TABLE `patient_consents` ADD CONSTRAINT `chk_patient_consents_status` CHECK (status IN ('GRANTED', 'WITHDRAWN'));
ALTER TABLE `patient_consents` ADD CONSTRAINT `chk_patient_consents_given_by` CHECK (given_by_relationship IN ('SELF', 'GUARDIAN', 'STAFF_RECORDED'));
ALTER TABLE `patient_consents` ADD CONSTRAINT `chk_patient_consents_withdrawn` CHECK (status <> 'WITHDRAWN' OR withdrawn_at IS NOT NULL);
ALTER TABLE `patient_consents` ADD CONSTRAINT `fk_patient_consents_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `patient_consents` ADD CONSTRAINT `fk_patient_consents_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
