-- Constraints for `platform_gate_decisions` (DATABASE-IMPLEMENTATION.md). Appended by db:migration:normalize.
ALTER TABLE `platform_gate_decisions` ADD CONSTRAINT `chk_platform_gate_decisions_gate_code` CHECK (gate_code IN ('GATE-SMS-HTTP', 'GATE-PAY-PLATFORM-COLLECTION'));
ALTER TABLE `platform_gate_decisions` ADD CONSTRAINT `chk_platform_gate_decisions_environment` CHECK (environment IN ('staging', 'production'));
ALTER TABLE `platform_gate_decisions` ADD CONSTRAINT `chk_platform_gate_decisions_decision` CHECK (decision IN ('ACCEPTED', 'REVOKED'));
ALTER TABLE `platform_gate_decisions` ADD CONSTRAINT `chk_platform_gate_decisions_expiry` CHECK (decision <> 'ACCEPTED' OR expires_at IS NOT NULL);
