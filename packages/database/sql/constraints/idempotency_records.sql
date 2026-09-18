-- Constraints for `idempotency_records` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `idempotency_records` ADD CONSTRAINT `chk_idempotency_records_status` CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED_RETRYABLE'));
ALTER TABLE `idempotency_records` ADD COLUMN `tenant_scope` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin AS (IFNULL(tenant_id, 'platform')) PERSISTENT;
CREATE UNIQUE INDEX `uq_idem` ON `idempotency_records` (`tenant_scope`, `scope`, `idem_key`);
