-- Constraints for `rate_limit_counters` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `rate_limit_counters` ADD CONSTRAINT `chk_rate_limit_counters_window` CHECK (window_seconds > 0);
