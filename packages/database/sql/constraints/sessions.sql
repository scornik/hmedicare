-- Constraints for `sessions` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `sessions` ADD CONSTRAINT `chk_sessions_client_type` CHECK (client_type IN ('WEB', 'ANDROID', 'IOS'));
ALTER TABLE `sessions` ADD CONSTRAINT `chk_sessions_revoke_reason` CHECK (revoke_reason IS NULL OR revoke_reason IN ('LOGOUT', 'LOGOUT_ALL', 'REFRESH_REUSE', 'ADMIN', 'PASSWORD_CHANGED', 'EXPIRED'));
ALTER TABLE `sessions` ADD CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
