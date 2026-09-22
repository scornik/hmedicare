-- Constraints for `encounter_notes` (DATABASE-IMPLEMENTATION.md §3.7). The single mutable draft.
ALTER TABLE `encounter_notes` ADD CONSTRAINT `chk_encounter_notes_status` CHECK (status IN ('DRAFT', 'SIGNED_LOCKED'));
ALTER TABLE `encounter_notes` ADD CONSTRAINT `fk_encounter_notes_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `encounter_notes` ADD CONSTRAINT `fk_encounter_notes_encounter` FOREIGN KEY (`tenant_id`, `encounter_id`) REFERENCES `encounters` (`tenant_id`, `id`);
ALTER TABLE `encounter_notes` ADD CONSTRAINT `fk_encounter_notes_author` FOREIGN KEY (`tenant_id`, `author_doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
-- One open draft per encounter, so two tabs cannot each create their own and silently diverge.
ALTER TABLE `encounter_notes` ADD COLUMN `open_draft_key` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin AS (IF(status = 'DRAFT', encounter_id, NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_encounter_notes_open_draft` ON `encounter_notes` (`tenant_id`, `open_draft_key`);
