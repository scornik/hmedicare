-- Constraints for `otp_challenges` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `otp_challenges` ADD CONSTRAINT `chk_otp_challenges_purpose` CHECK (purpose IN ('LOGIN', 'PHONE_VERIFY', 'RECOVERY'));
ALTER TABLE `otp_challenges` ADD CONSTRAINT `chk_otp_challenges_channel` CHECK (channel IN ('SMS', 'WHATSAPP', 'MOCK'));
ALTER TABLE `otp_challenges` ADD CONSTRAINT `chk_otp_challenges_status` CHECK (status IN ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED', 'SUPERSEDED'));
ALTER TABLE `otp_challenges` ADD CONSTRAINT `chk_otp_challenges_attempts` CHECK (attempts >= 0 AND max_attempts > 0);
ALTER TABLE `otp_challenges` ADD COLUMN `pending_key` VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin AS (IF(status = 'PENDING', CONCAT(purpose, ':', destination_hash), NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_otp_pending` ON `otp_challenges` (`pending_key`);
