-- Constraints for `job_concurrency_leases` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `job_concurrency_leases` ADD CONSTRAINT `chk_job_concurrency_leases_slot_no` CHECK (slot_no >= 1);
