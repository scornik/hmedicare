-- Constraints for `prescriptions` (DATABASE-IMPLEMENTATION.md §3.9, PRESCRIPTION-IMPLEMENTATION.md §1).
-- One row per revision of an encounter's prescription.
ALTER TABLE `prescriptions` ADD CONSTRAINT `chk_prescriptions_clinical_status` CHECK (clinical_status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'VOID'));
ALTER TABLE `prescriptions` ADD CONSTRAINT `chk_prescriptions_render_status` CHECK (render_status IN ('NOT_REQUESTED', 'QUEUED', 'RENDERING', 'AVAILABLE', 'FAILED'));
-- An approved prescription without an approver, a time and a snapshot hash is not approved by anything.
-- The hash is what makes "this is what was approved" checkable rather than asserted.
ALTER TABLE `prescriptions` ADD CONSTRAINT `chk_prescriptions_approved_complete` CHECK (clinical_status <> 'APPROVED' OR (approved_by_doctor_profile_id IS NOT NULL AND approved_at IS NOT NULL AND approved_snapshot_sha256 IS NOT NULL));
-- Withdrawing a prescription is a clinical act, and a clinical act without a reason is unreviewable.
ALTER TABLE `prescriptions` ADD CONSTRAINT `chk_prescriptions_void_reason` CHECK (clinical_status <> 'VOID' OR void_reason IS NOT NULL);
-- Nothing renders before it is final. A draft PDF is a document that can be handed to a patient and then
-- changed, which is the one thing a prescription must never be.
ALTER TABLE `prescriptions` ADD CONSTRAINT `chk_prescriptions_render_requires_final` CHECK (render_status = 'NOT_REQUESTED' OR clinical_status IN ('APPROVED', 'VOID'));
ALTER TABLE `prescriptions` ADD CONSTRAINT `fk_prescriptions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `prescriptions` ADD CONSTRAINT `fk_prescriptions_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `prescriptions` ADD CONSTRAINT `fk_prescriptions_encounter` FOREIGN KEY (`tenant_id`, `encounter_id`) REFERENCES `encounters` (`tenant_id`, `id`);
ALTER TABLE `prescriptions` ADD CONSTRAINT `fk_prescriptions_doctor` FOREIGN KEY (`tenant_id`, `doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
ALTER TABLE `prescriptions` ADD CONSTRAINT `fk_prescriptions_supersedes` FOREIGN KEY (`tenant_id`, `supersedes_prescription_id`) REFERENCES `prescriptions` (`tenant_id`, `id`);
-- Exactly one approved revision per encounter, enforced by the database rather than by the service.
-- The correction flow voids the old revision and approves the new one in one transaction; without this
-- key, two concurrent approvals would both succeed and a patient would hold two valid prescriptions.
ALTER TABLE `prescriptions` ADD COLUMN `approved_encounter_key` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin AS (IF(clinical_status = 'APPROVED', encounter_id, NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_prescriptions_one_approved` ON `prescriptions` (`tenant_id`, `approved_encounter_key`);
-- And one open draft, for the reason the note has one: two tabs must not each grow their own.
ALTER TABLE `prescriptions` ADD COLUMN `open_draft_encounter_key` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin AS (IF(clinical_status IN ('DRAFT', 'REVIEWED'), encounter_id, NULL)) PERSISTENT;
CREATE UNIQUE INDEX `uq_prescriptions_one_open_draft` ON `prescriptions` (`tenant_id`, `open_draft_encounter_key`);
