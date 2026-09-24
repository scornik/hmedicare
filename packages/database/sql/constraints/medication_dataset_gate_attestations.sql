-- Constraints for `medication_dataset_gate_attestations` (DATABASE-IMPLEMENTATION.md §3.8, ADR-020).
-- Append-only and hash-chained on `meddata:platform`. No code path updates or deletes a row here: an
-- attestation that someone reviewed the data is worth nothing if it can be added or edited afterwards.
ALTER TABLE `medication_dataset_gate_attestations` ADD CONSTRAINT `chk_meddata_gate_attestations_code` CHECK (gate_code IN ('LEGAL_SOURCE_REVIEW', 'CLINICAL_SAMPLE_REVIEW', 'DGDA_CROSS_REFERENCE', 'IMPORT_SAFEGUARDS_VERIFIED'));
ALTER TABLE `medication_dataset_gate_attestations` ADD CONSTRAINT `fk_meddata_gate_attestations_user` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`);
