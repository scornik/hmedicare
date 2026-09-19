-- Constraints for `chambers` (DATABASE-IMPLEMENTATION.md §3.5). Appended by db:migration:normalize.
ALTER TABLE `chambers` ADD CONSTRAINT `chk_chambers_status` CHECK (status IN ('ACTIVE', 'INACTIVE'));
ALTER TABLE `chambers` ADD CONSTRAINT `chk_chambers_payment_mode` CHECK (chamber_payment_mode IN ('PAY_AT_CHAMBER', 'PREPAID_REQUIRED', 'OPTIONAL_ONLINE'));
ALTER TABLE `chambers` ADD CONSTRAINT `chk_chambers_telemedicine_payment_mode` CHECK (telemedicine_payment_mode IN ('PREPAID_REQUIRED', 'OPTIONAL_ONLINE'));
ALTER TABLE `chambers` ADD CONSTRAINT `chk_chambers_modes` CHECK (supports_physical + supports_remote + supports_hybrid >= 1);
ALTER TABLE `chambers` ADD CONSTRAINT `fk_chambers_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `chambers` ADD CONSTRAINT `fk_chambers_clinic` FOREIGN KEY (`tenant_id`, `clinic_id`) REFERENCES `clinics` (`tenant_id`, `id`);
ALTER TABLE `chambers` ADD CONSTRAINT `fk_chambers_doctor` FOREIGN KEY (`tenant_id`, `doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
