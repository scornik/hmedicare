-- Constraints for `password_reset_tokens` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `fk_password_reset_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
