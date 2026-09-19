-- Constraints for `queue_events` (DATABASE-IMPLEMENTATION.md §3.6). Appended by db:migration:normalize.
ALTER TABLE `queue_events` ADD CONSTRAINT `chk_queue_events_type` CHECK (event_type IN ('SERIAL_ISSUED', 'CONFIRMED', 'CHECKED_IN', 'REMOTE_READY', 'WAITING', 'CALLED', 'SKIPPED', 'RECALLED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED', 'CONSULTATION_STARTED', 'COMPLETED', 'QUEUE_REORDERED', 'DELAY_RECORDED', 'DAY_OPENED', 'DAY_PAUSED', 'DAY_CLOSED', 'DAY_CANCELLED', 'POLICY_CHANGED', 'DUPLICATE_OVERRIDE'));
ALTER TABLE `queue_events` ADD CONSTRAINT `chk_queue_events_actor_type` CHECK (actor_type IN ('USER', 'SYSTEM', 'PATIENT_CONTEXT'));
ALTER TABLE `queue_events` ADD CONSTRAINT `fk_queue_events_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `queue_events` ADD CONSTRAINT `fk_queue_events_day` FOREIGN KEY (`tenant_id`, `chamber_day_id`) REFERENCES `chamber_days` (`tenant_id`, `id`);
ALTER TABLE `queue_events` ADD CONSTRAINT `fk_queue_events_serial` FOREIGN KEY (`tenant_id`, `serial_id`) REFERENCES `serials` (`tenant_id`, `id`);
