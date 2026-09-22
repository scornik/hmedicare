-- Constraints for `encounter_note_versions` (DATABASE-IMPLEMENTATION.md §3.7). Append-only, hash-chained
-- per encounter. No code path updates or deletes a row here; the repository refuses it and tests prove it.
-- A revision after the first is a correction and must carry its reason, so history explains itself.
ALTER TABLE `encounter_note_versions` ADD CONSTRAINT `chk_encounter_note_versions_correction` CHECK (revision = 1 OR correction_reason IS NOT NULL);
ALTER TABLE `encounter_note_versions` ADD CONSTRAINT `fk_encounter_note_versions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `encounter_note_versions` ADD CONSTRAINT `fk_encounter_note_versions_encounter` FOREIGN KEY (`tenant_id`, `encounter_id`) REFERENCES `encounters` (`tenant_id`, `id`);
ALTER TABLE `encounter_note_versions` ADD CONSTRAINT `fk_encounter_note_versions_note` FOREIGN KEY (`tenant_id`, `note_id`) REFERENCES `encounter_notes` (`tenant_id`, `id`);
ALTER TABLE `encounter_note_versions` ADD CONSTRAINT `fk_encounter_note_versions_signer` FOREIGN KEY (`tenant_id`, `signed_by_doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
