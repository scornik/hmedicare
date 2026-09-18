-- Constraints for `provider_credentials` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `provider_credentials` ADD CONSTRAINT `chk_provider_credentials_owner_type` CHECK (owner_type IN ('TENANT', 'CLINIC', 'DOCTOR'));
ALTER TABLE `provider_credentials` ADD CONSTRAINT `chk_provider_credentials_provider_kind` CHECK (provider_kind IN ('SMS', 'PAYMENT'));
ALTER TABLE `provider_credentials` ADD CONSTRAINT `chk_provider_credentials_environment` CHECK (environment IN ('sandbox', 'live', 'na'));
ALTER TABLE `provider_credentials` ADD CONSTRAINT `chk_provider_credentials_status` CHECK (status IN ('PENDING_VALIDATION', 'ACTIVE', 'UNVERIFIED_UNTIL_FIRST_PAYMENT', 'INVALID', 'SUSPENDED_BALANCE', 'DISABLED', 'REVOKED'));
ALTER TABLE `provider_credentials` ADD CONSTRAINT `chk_provider_credentials_sender_id_status` CHECK (sender_id_status IS NULL OR sender_id_status IN ('UNVERIFIED', 'VERIFIED', 'INVALID'));
ALTER TABLE `provider_credentials` ADD CONSTRAINT `chk_provider_credentials_doctor_owner` CHECK (owner_type <> 'DOCTOR' OR doctor_profile_id IS NOT NULL);
ALTER TABLE `provider_credentials` ADD CONSTRAINT `chk_provider_credentials_clinic_owner` CHECK (owner_type <> 'CLINIC' OR clinic_id IS NOT NULL);
ALTER TABLE `provider_credentials` ADD CONSTRAINT `chk_provider_credentials_sms_env` CHECK (provider_kind <> 'SMS' OR environment = 'na');
ALTER TABLE `provider_credentials` ADD CONSTRAINT `chk_provider_credentials_payment_env` CHECK (provider_kind <> 'PAYMENT' OR environment IN ('sandbox', 'live'));
ALTER TABLE `provider_credentials` ADD CONSTRAINT `fk_provider_credentials_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `provider_credentials` ADD CONSTRAINT `fk_provider_credentials_clinic` FOREIGN KEY (`tenant_id`, `clinic_id`) REFERENCES `clinics` (`tenant_id`, `id`);
ALTER TABLE `provider_credentials` ADD CONSTRAINT `fk_provider_credentials_doctor` FOREIGN KEY (`tenant_id`, `doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
ALTER TABLE `provider_credentials` ADD COLUMN `live_credential_key` VARCHAR(140) CHARACTER SET ascii COLLATE ascii_bin AS (IF(status <> 'REVOKED', CONCAT(provider_kind, ':', provider_code, ':', environment, ':', secret_fingerprint), NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_provider_credentials_live` ON `provider_credentials` (`tenant_id`, `live_credential_key`);
