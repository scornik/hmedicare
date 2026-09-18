-- Constraints for `users` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `users` ADD CONSTRAINT `chk_users_status` CHECK (status IN ('ACTIVE', 'LOCKED', 'DISABLED'));
ALTER TABLE `users` ADD CONSTRAINT `chk_users_contact` CHECK (email_normalized IS NOT NULL OR phone_e164 IS NOT NULL);
