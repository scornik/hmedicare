-- Constraints for `documents` (DATABASE-IMPLEMENTATION.md §3.10, FILE-STORAGE-IMPLEMENTATION.md, ADR-016).
-- The record that a file exists, who it belongs to and who may read it. The bytes live in object storage.
ALTER TABLE `documents` ADD CONSTRAINT `chk_documents_category` CHECK (category IN ('LAB_REPORT', 'PRESCRIPTION_PDF', 'IMAGE', 'REFERRAL', 'OTHER', 'AI_RAW'));
ALTER TABLE `documents` ADD CONSTRAINT `chk_documents_status` CHECK (status IN ('CREATED', 'UPLOADING', 'UPLOADED', 'SCANNING', 'SCAN_ERROR', 'AVAILABLE', 'REJECTED', 'EXPIRED'));
ALTER TABLE `documents` ADD CONSTRAINT `chk_documents_access_policy` CHECK (access_policy IN ('CLINICAL_TEAM', 'PATIENT_SHARED', 'AUDIT_ONLY'));
-- A document that says it is available must name the revision a download would serve. Without this, an
-- AVAILABLE row with a null `current_revision` is a download that 500s instead of one that 404s.
ALTER TABLE `documents` ADD CONSTRAINT `chk_documents_available_revision` CHECK (status <> 'AVAILABLE' OR current_revision IS NOT NULL);
ALTER TABLE `documents` ADD CONSTRAINT `fk_documents_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `documents` ADD CONSTRAINT `fk_documents_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `documents` ADD CONSTRAINT `fk_documents_encounter` FOREIGN KEY (`tenant_id`, `encounter_id`) REFERENCES `encounters` (`tenant_id`, `id`);
