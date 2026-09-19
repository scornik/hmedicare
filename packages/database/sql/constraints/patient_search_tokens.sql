-- Constraints for `patient_search_tokens` (DATABASE-IMPLEMENTATION.md §3.4). Appended by db:migration:normalize.
ALTER TABLE `patient_search_tokens` ADD CONSTRAINT `chk_patient_search_tokens_kind` CHECK (token_kind IN ('NAME', 'SKELETON'));
ALTER TABLE `patient_search_tokens` ADD CONSTRAINT `fk_patient_search_tokens_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `patient_search_tokens` ADD CONSTRAINT `fk_patient_search_tokens_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
