-- Constraints for `audit_logs` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `audit_logs` ADD CONSTRAINT `chk_audit_logs_actor_type` CHECK (actor_type IN ('USER', 'SYSTEM', 'PATIENT_CONTEXT', 'OPERATOR'));
ALTER TABLE `audit_logs` ADD CONSTRAINT `chk_audit_logs_acting_as` CHECK (acting_as IS NULL OR acting_as IN ('SELF', 'GUARDIAN'));
ALTER TABLE `audit_logs` ADD CONSTRAINT `chk_audit_logs_outcome` CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED'));
