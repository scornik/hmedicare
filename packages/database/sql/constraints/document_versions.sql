-- Constraints for `document_versions` (DATABASE-IMPLEMENTATION.md §3.10, ADR-016 §2 and §4).
-- One stored object per revision. A correction is a new revision, never a rewrite of an old one.
ALTER TABLE `document_versions` ADD CONSTRAINT `chk_document_versions_adapter` CHECK (storage_adapter IN ('s3', 'disk'));
ALTER TABLE `document_versions` ADD CONSTRAINT `chk_document_versions_scan_status` CHECK (scan_status IN ('PENDING', 'CLEAN', 'REJECTED', 'ERROR'));
-- A verdict without the thing that reached it cannot be reviewed later, and "generated, so not scanned"
-- has to be a recorded decision rather than an empty column that looks like an oversight.
ALTER TABLE `document_versions` ADD CONSTRAINT `chk_document_versions_scan_decided` CHECK (scan_status = 'PENDING' OR (scan_adapter IS NOT NULL AND scanned_at IS NOT NULL));
-- Revisions start at 1. A zero or negative revision would sort ahead of every real one.
ALTER TABLE `document_versions` ADD CONSTRAINT `chk_document_versions_revision` CHECK (revision >= 1);
-- An empty object is not a document. Every adapter writes the bytes before the row, so a zero length
-- here means the write was lost and the row is a promise of something that is not there.
ALTER TABLE `document_versions` ADD CONSTRAINT `chk_document_versions_size` CHECK (size_bytes > 0);
ALTER TABLE `document_versions` ADD CONSTRAINT `fk_document_versions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `document_versions` ADD CONSTRAINT `fk_document_versions_document` FOREIGN KEY (`tenant_id`, `document_id`) REFERENCES `documents` (`tenant_id`, `id`);
