-- Constraints for `care_team_members` (DATABASE-IMPLEMENTATION.md §3.4). Appended by db:migration:normalize.
ALTER TABLE `care_team_members` ADD CONSTRAINT `chk_care_team_members_role` CHECK (role IN ('DOCTOR', 'NURSE', 'OTHER'));
ALTER TABLE `care_team_members` ADD CONSTRAINT `chk_care_team_members_window` CHECK (ends_at IS NULL OR ends_at > starts_at);
ALTER TABLE `care_team_members` ADD CONSTRAINT `fk_care_team_members_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `care_team_members` ADD CONSTRAINT `fk_care_team_members_user` FOREIGN KEY (`member_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `care_team_members` ADD CONSTRAINT `fk_care_team_members_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `care_team_members` ADD COLUMN `open_member_key` VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin AS (IF(ends_at IS NULL, CONCAT(patient_id, ':', member_user_id, ':', role), NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_care_team_open` ON `care_team_members` (`tenant_id`, `open_member_key`);
