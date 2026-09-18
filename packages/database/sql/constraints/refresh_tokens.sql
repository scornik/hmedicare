-- Constraints for `refresh_tokens` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `fk_refresh_tokens_session` FOREIGN KEY (`session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE;
