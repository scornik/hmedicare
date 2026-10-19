-- hmedic:normalized v1
-- Cleanup completion is durable so a bounded sweep does not revisit completed sessions.
ALTER TABLE `upload_sessions` ADD COLUMN `cleanup_completed_at` DATETIME(3) NULL;
CREATE INDEX `ix_upload_sessions_cleanup` ON `upload_sessions` (`status`, `cleanup_completed_at`, `expires_at`);
