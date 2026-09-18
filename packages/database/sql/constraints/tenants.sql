-- Constraints for `tenants` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `tenants` ADD CONSTRAINT `chk_tenants_status` CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED'));
ALTER TABLE `tenants` ADD CONSTRAINT `chk_tenants_practice_type` CHECK (practice_type IN ('SOLO', 'GROUP'));
ALTER TABLE `tenants` ADD CONSTRAINT `chk_tenants_solo_owner` CHECK (practice_type <> 'SOLO' OR owner_doctor_profile_id IS NOT NULL);
