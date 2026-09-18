-- Constraints for `email_verification_tokens` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `fk_email_verification_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
