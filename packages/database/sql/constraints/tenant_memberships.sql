-- Constraints for `tenant_memberships` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `chk_tenant_memberships_role` CHECK (role IN ('tenant_owner', 'clinic_admin', 'doctor', 'nurse', 'receptionist', 'billing_manager'));
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `chk_tenant_memberships_status` CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED'));
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `fk_tenant_memberships_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `fk_tenant_memberships_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
