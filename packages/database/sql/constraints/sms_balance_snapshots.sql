-- Constraints for `sms_balance_snapshots` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `sms_balance_snapshots` ADD CONSTRAINT `chk_sms_balance_snapshots_scope` CHECK (credential_scope IN ('PLATFORM', 'TENANT'));
ALTER TABLE `sms_balance_snapshots` ADD CONSTRAINT `chk_sms_balance_snapshots_parse_status` CHECK (parse_status IN ('PARSED', 'UNPARSED', 'ERROR'));
ALTER TABLE `sms_balance_snapshots` ADD CONSTRAINT `chk_sms_balance_snapshots_scope_consistency` CHECK ((credential_scope = 'PLATFORM' AND credential_id IS NULL AND tenant_id IS NULL) OR (credential_scope = 'TENANT' AND credential_id IS NOT NULL AND tenant_id IS NOT NULL));
ALTER TABLE `sms_balance_snapshots` ADD CONSTRAINT `fk_sms_balance_snapshots_credential` FOREIGN KEY (`tenant_id`, `credential_id`) REFERENCES `provider_credentials` (`tenant_id`, `id`);
