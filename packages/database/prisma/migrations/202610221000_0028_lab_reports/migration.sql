-- hmedic:normalized v1
-- Migration 202610221000_0028_lab_reports. Raw accepted files remain authoritative.
-- CreateTable
CREATE TABLE `lab_reports` (
    `id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `tenant_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `patient_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `encounter_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `document_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `lab_name` VARCHAR(200) NULL,
    `report_date` DATE NULL,
    `review_status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `reviewed_by_doctor_profile_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `reviewed_at` DATETIME(3) NULL,
    `raw_metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `created_by_user_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `updated_by_user_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `row_version` INTEGER UNSIGNED NOT NULL DEFAULT 1,

    UNIQUE INDEX `uq_lab_reports_tenant_id`(`tenant_id`, `id`),
    UNIQUE INDEX `uq_lab_reports_document`(`tenant_id`, `document_id`),
    INDEX `ix_lab_reports_patient`(`tenant_id`, `patient_id`, `report_date`, `id`),
    INDEX `ix_lab_reports_encounter`(`tenant_id`, `encounter_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci;

-- CreateTable
CREATE TABLE `lab_results` (
    `id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `tenant_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `lab_report_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `analyte_code` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `code_system` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `analyte_display` VARCHAR(200) NOT NULL,
    `value_numeric` DECIMAL(18,6) NULL,
    `value_text` VARCHAR(200) NULL,
    `unit` VARCHAR(40) NULL,
    `reference_range` VARCHAR(120) NULL,
    `abnormal_flag` VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `result_date` DATE NULL,
    `entry_source` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `review_status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `created_by_user_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `updated_by_user_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `row_version` INTEGER UNSIGNED NOT NULL DEFAULT 1,

    UNIQUE INDEX `uq_lab_results_tenant_id`(`tenant_id`, `id`),
    INDEX `ix_lab_results_report`(`tenant_id`, `lab_report_id`, `created_at`, `id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci;

-- Constraints (sql/constraints): tenant-bound references and review invariants.
ALTER TABLE `lab_reports` ADD CONSTRAINT `chk_lab_reports_status` CHECK (review_status IN ('UNREVIEWED', 'REVIEWED', 'ENTERED_IN_ERROR'));
ALTER TABLE `lab_reports` ADD CONSTRAINT `chk_lab_reports_reviewer` CHECK ((review_status = 'REVIEWED' AND reviewed_by_doctor_profile_id IS NOT NULL AND reviewed_at IS NOT NULL) OR (review_status <> 'REVIEWED' AND reviewed_by_doctor_profile_id IS NULL AND reviewed_at IS NULL));
ALTER TABLE `lab_reports` ADD CONSTRAINT `chk_lab_reports_version` CHECK (row_version > 0);
ALTER TABLE `lab_reports` ADD CONSTRAINT `fk_lab_reports_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `lab_reports` ADD CONSTRAINT `fk_lab_reports_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `lab_reports` ADD CONSTRAINT `fk_lab_reports_encounter` FOREIGN KEY (`tenant_id`, `encounter_id`) REFERENCES `encounters` (`tenant_id`, `id`);
ALTER TABLE `lab_reports` ADD CONSTRAINT `fk_lab_reports_document` FOREIGN KEY (`tenant_id`, `document_id`) REFERENCES `documents` (`tenant_id`, `id`);
ALTER TABLE `lab_reports` ADD CONSTRAINT `fk_lab_reports_reviewer` FOREIGN KEY (`tenant_id`, `reviewed_by_doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);

ALTER TABLE `lab_results` ADD CONSTRAINT `chk_lab_results_value` CHECK ((value_numeric IS NULL AND value_text IS NOT NULL) OR (value_numeric IS NOT NULL AND value_text IS NULL));
ALTER TABLE `lab_results` ADD CONSTRAINT `chk_lab_results_flag` CHECK (abnormal_flag IS NULL OR abnormal_flag IN ('LOW', 'HIGH', 'CRITICAL', 'NORMAL'));
ALTER TABLE `lab_results` ADD CONSTRAINT `chk_lab_results_source` CHECK (entry_source IN ('MANUAL', 'EXTRACTED'));
ALTER TABLE `lab_results` ADD CONSTRAINT `chk_lab_results_status` CHECK (review_status IN ('UNREVIEWED', 'REVIEWED', 'ENTERED_IN_ERROR'));
ALTER TABLE `lab_results` ADD CONSTRAINT `chk_lab_results_version` CHECK (row_version > 0);
ALTER TABLE `lab_results` ADD CONSTRAINT `fk_lab_results_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `lab_results` ADD CONSTRAINT `fk_lab_results_report` FOREIGN KEY (`tenant_id`, `lab_report_id`) REFERENCES `lab_reports` (`tenant_id`, `id`);
