-- One selected immutable receipt per part; old content-addressed bytes remain until session cleanup.
ALTER TABLE `upload_session_parts` ADD CONSTRAINT `chk_upload_session_parts_number` CHECK (part_number BETWEEN 1 AND 10000);
ALTER TABLE `upload_session_parts` ADD CONSTRAINT `chk_upload_session_parts_size` CHECK (size_bytes BETWEEN 1 AND 8388608);
ALTER TABLE `upload_session_parts` ADD CONSTRAINT `fk_upload_session_parts_session` FOREIGN KEY (`tenant_id`, `upload_session_id`) REFERENCES `upload_sessions` (`tenant_id`, `id`);
