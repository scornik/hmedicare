-- Constraints for `jobs` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `jobs` ADD CONSTRAINT `chk_jobs_status` CHECK (status IN ('QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD'));
ALTER TABLE `jobs` ADD CONSTRAINT `chk_jobs_attempts` CHECK (attempts >= 0 AND max_attempts > 0);
