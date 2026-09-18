-- Constraints for `outbox_events` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `outbox_events` ADD CONSTRAINT `chk_outbox_events_status` CHECK (status IN ('PENDING', 'CLAIMED', 'PUBLISHED', 'FAILED'));
