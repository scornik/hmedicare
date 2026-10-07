-- Timeline rows are immutable; removals append a marker in the same patient stream.
ALTER TABLE `timeline_events` ADD CONSTRAINT `chk_timeline_event_type` CHECK (event_type IN ('appointment', 'serial', 'queue_change', 'encounter_started', 'encounter_completed', 'symptom', 'diagnosis', 'prescription_finalized', 'lab_report', 'document', 'follow_up', 'communication', 'call', 'ai_approved_note', 'doctor_note', 'REDACTED'));
ALTER TABLE `timeline_events` ADD CONSTRAINT `chk_timeline_visibility` CHECK (visibility IN ('CLINICAL', 'PATIENT_SHARED', 'OPERATIONAL'));
ALTER TABLE `timeline_events` ADD CONSTRAINT `chk_timeline_seq` CHECK (seq > 0);
ALTER TABLE `timeline_events` ADD CONSTRAINT `chk_timeline_projection_version` CHECK (projection_version > 0);
ALTER TABLE `timeline_events` ADD CONSTRAINT `chk_timeline_redaction` CHECK ((event_type = 'REDACTED' AND redacts_timeline_event_id IS NOT NULL AND redaction_reason_code IS NOT NULL) OR (event_type <> 'REDACTED' AND redacts_timeline_event_id IS NULL AND redaction_reason_code IS NULL));
ALTER TABLE `timeline_events` ADD CONSTRAINT `fk_timeline_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `timeline_events` ADD CONSTRAINT `fk_timeline_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
-- The triple FK prevents a marker from hiding a different patient's entry in the same tenant.
ALTER TABLE `timeline_events` ADD CONSTRAINT `fk_timeline_redacts` FOREIGN KEY (`tenant_id`, `patient_id`, `redacts_timeline_event_id`) REFERENCES `timeline_events` (`tenant_id`, `patient_id`, `id`);
