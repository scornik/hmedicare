-- Constraints for `patient_accounts` (DATABASE-IMPLEMENTATION.md §3.4). Appended by db:migration:normalize.
ALTER TABLE `patient_accounts` ADD CONSTRAINT `chk_patient_accounts_relationship` CHECK (relationship IN ('SELF'));
ALTER TABLE `patient_accounts` ADD CONSTRAINT `chk_patient_accounts_method` CHECK (verification_method IN ('OTP_PHONE_MATCH', 'STAFF_VERIFIED_IN_PERSON', 'STAFF_VERIFIED_DOCUMENT'));
ALTER TABLE `patient_accounts` ADD CONSTRAINT `chk_patient_accounts_status` CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED'));
ALTER TABLE `patient_accounts` ADD CONSTRAINT `fk_patient_accounts_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `patient_accounts` ADD CONSTRAINT `fk_patient_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `patient_accounts` ADD CONSTRAINT `fk_patient_accounts_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `patient_accounts` ADD COLUMN `live_account_key` VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin AS (IF(status IN ('PENDING', 'ACTIVE'), CONCAT(user_id, ':', patient_id), NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_patient_accounts_live` ON `patient_accounts` (`tenant_id`, `live_account_key`);
