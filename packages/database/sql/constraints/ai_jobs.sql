-- ai_jobs, usage, drafts, suggestions and approvals (AI-001, DATABASE-IMPLEMENTATION §3.13).
ALTER TABLE `ai_jobs` ADD CONSTRAINT `fk_ai_job_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `ai_jobs` ADD CONSTRAINT `fk_ai_job_doctor` FOREIGN KEY (`tenant_id`,`doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`,`id`);
ALTER TABLE `ai_jobs` ADD CONSTRAINT `fk_ai_job_patient` FOREIGN KEY (`tenant_id`,`patient_id`) REFERENCES `patients` (`tenant_id`,`id`);
ALTER TABLE `ai_jobs` ADD CONSTRAINT `fk_ai_job_encounter` FOREIGN KEY (`tenant_id`,`encounter_id`) REFERENCES `encounters` (`tenant_id`,`id`);
ALTER TABLE `ai_jobs` ADD CONSTRAINT `fk_ai_job_credential` FOREIGN KEY (`tenant_id`,`credential_id`) REFERENCES `ai_provider_credentials` (`tenant_id`,`id`);
ALTER TABLE `ai_jobs` ADD CONSTRAINT `fk_ai_job_requester` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `ai_jobs` ADD CONSTRAINT `chk_ai_job_purpose` CHECK (purpose IN ('NOTE_DRAFT','HISTORY_SUMMARY','TRANSCRIPTION'));
ALTER TABLE `ai_jobs` ADD CONSTRAINT `chk_ai_job_status` CHECK (status IN ('QUEUED','RUNNING','WAITING_RATE_LIMIT','SUCCEEDED','FAILED','CANCELLED'));
ALTER TABLE `ai_jobs` ADD CONSTRAINT `chk_ai_job_tier` CHECK (declared_tier IN ('FREE','PAID'));
ALTER TABLE `ai_jobs` ADD CONSTRAINT `chk_ai_job_billing` CHECK (billing_mode IN ('DOCTOR_BYOK_FREE','DOCTOR_BYOK_PAID','PLATFORM_MANAGED'));
-- UNKNOWN is resolved to MAY_TRAIN_OR_REVIEW before the job is created, so only the two real classes
-- can be stored: a job recording UNKNOWN would be a job nobody could later say was permitted.
ALTER TABLE `ai_jobs` ADD CONSTRAINT `chk_ai_job_policy` CHECK (effective_data_use_policy IN ('MAY_TRAIN_OR_REVIEW','NO_TRAINING_CONTRACTUAL'));
-- A finished job has a finish time, and an unfinished one has none. Without this a job could read as
-- SUCCEEDED with no record of when, which is the one thing a reviewer needs.
ALTER TABLE `ai_jobs` ADD CONSTRAINT `chk_ai_job_finished` CHECK ((status IN ('SUCCEEDED','FAILED','CANCELLED') AND finished_at IS NOT NULL) OR (status NOT IN ('SUCCEEDED','FAILED','CANCELLED') AND finished_at IS NULL));
ALTER TABLE `ai_jobs` ADD CONSTRAINT `chk_ai_job_row_version` CHECK (row_version > 0);

ALTER TABLE `ai_usage_counters` ADD CONSTRAINT `fk_ai_usage_counter_credential` FOREIGN KEY (`tenant_id`,`credential_id`) REFERENCES `ai_provider_credentials` (`tenant_id`,`id`);
ALTER TABLE `ai_usage_counters` ADD CONSTRAINT `chk_ai_usage_window` CHECK (`window` IN ('MINUTE','DAY'));

ALTER TABLE `ai_usage_ledger` ADD CONSTRAINT `fk_ai_usage_ledger_job` FOREIGN KEY (`tenant_id`,`job_id`) REFERENCES `ai_jobs` (`tenant_id`,`id`);
ALTER TABLE `ai_usage_ledger` ADD CONSTRAINT `fk_ai_usage_ledger_credential` FOREIGN KEY (`tenant_id`,`credential_id`) REFERENCES `ai_provider_credentials` (`tenant_id`,`id`);
ALTER TABLE `ai_usage_ledger` ADD CONSTRAINT `fk_ai_usage_ledger_doctor` FOREIGN KEY (`tenant_id`,`doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`,`id`);
ALTER TABLE `ai_usage_ledger` ADD CONSTRAINT `chk_ai_usage_ledger_outcome` CHECK (outcome IN ('SUCCESS','ERROR'));

ALTER TABLE `ai_drafts` ADD CONSTRAINT `fk_ai_draft_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `ai_drafts` ADD CONSTRAINT `fk_ai_draft_job` FOREIGN KEY (`tenant_id`,`ai_job_id`) REFERENCES `ai_jobs` (`tenant_id`,`id`);
ALTER TABLE `ai_drafts` ADD CONSTRAINT `fk_ai_draft_encounter` FOREIGN KEY (`tenant_id`,`encounter_id`) REFERENCES `encounters` (`tenant_id`,`id`);
ALTER TABLE `ai_drafts` ADD CONSTRAINT `fk_ai_draft_patient` FOREIGN KEY (`tenant_id`,`patient_id`) REFERENCES `patients` (`tenant_id`,`id`);
ALTER TABLE `ai_drafts` ADD CONSTRAINT `chk_ai_draft_type` CHECK (draft_type IN ('NOTE_DRAFT','HISTORY_SUMMARY'));
ALTER TABLE `ai_drafts` ADD CONSTRAINT `chk_ai_draft_status` CHECK (status IN ('READY_FOR_REVIEW','IN_REVIEW','CLOSED','EXPIRED'));
ALTER TABLE `ai_drafts` ADD CONSTRAINT `chk_ai_draft_closed` CHECK ((status IN ('CLOSED','EXPIRED') AND closed_at IS NOT NULL) OR (status NOT IN ('CLOSED','EXPIRED') AND closed_at IS NULL));
ALTER TABLE `ai_drafts` ADD CONSTRAINT `chk_ai_draft_output` CHECK (JSON_TYPE(validated_output) = 'OBJECT');
ALTER TABLE `ai_drafts` ADD CONSTRAINT `chk_ai_draft_row_version` CHECK (row_version > 0);

ALTER TABLE `ai_suggestions` ADD CONSTRAINT `fk_ai_suggestion_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `ai_suggestions` ADD CONSTRAINT `fk_ai_suggestion_draft` FOREIGN KEY (`tenant_id`,`ai_draft_id`) REFERENCES `ai_drafts` (`tenant_id`,`id`);
ALTER TABLE `ai_suggestions` ADD CONSTRAINT `fk_ai_suggestion_reviewer` FOREIGN KEY (`tenant_id`,`reviewed_by_doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`,`id`);
ALTER TABLE `ai_suggestions` ADD CONSTRAINT `chk_ai_suggestion_type` CHECK (suggestion_type IN ('NOTE_SECTION','DIAGNOSIS','HISTORY_ITEM','PRESCRIPTION_ITEM','FOLLOW_UP'));
ALTER TABLE `ai_suggestions` ADD CONSTRAINT `chk_ai_suggestion_confidence` CHECK (confidence IN ('LOW','MEDIUM','HIGH','UNKNOWN'));
ALTER TABLE `ai_suggestions` ADD CONSTRAINT `chk_ai_suggestion_status` CHECK (status IN ('PENDING','ACCEPTED','EDITED','REJECTED','IGNORED','APPROVED'));
-- Non-empty citations, enforced here rather than in code: a suggestion that cites nothing is a claim
-- nobody can check against the record, and the validator that drops those is one layer, not two.
ALTER TABLE `ai_suggestions` ADD CONSTRAINT `chk_ai_suggestion_sources` CHECK (JSON_TYPE(source_refs) = 'ARRAY' AND JSON_LENGTH(source_refs) > 0);
-- A review decision carries who made it and when; PENDING carries neither.
ALTER TABLE `ai_suggestions` ADD CONSTRAINT `chk_ai_suggestion_reviewed` CHECK ((status = 'PENDING' AND reviewed_at IS NULL AND reviewed_by_doctor_profile_id IS NULL) OR (status <> 'PENDING' AND reviewed_at IS NOT NULL AND reviewed_by_doctor_profile_id IS NOT NULL));
ALTER TABLE `ai_suggestions` ADD CONSTRAINT `chk_ai_suggestion_row_version` CHECK (row_version > 0);

ALTER TABLE `ai_approvals` ADD CONSTRAINT `fk_ai_approval_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `ai_approvals` ADD CONSTRAINT `fk_ai_approval_suggestion` FOREIGN KEY (`tenant_id`,`ai_suggestion_id`) REFERENCES `ai_suggestions` (`tenant_id`,`id`);
ALTER TABLE `ai_approvals` ADD CONSTRAINT `fk_ai_approval_reviewer` FOREIGN KEY (`tenant_id`,`reviewer_doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`,`id`);
-- MVP targets only. PRESCRIPTION_ITEM and FOLLOW_UP are V1+, and the API refuses them; a CHECK that
-- allowed them would let a future bug write an approval for a target nothing executes.
ALTER TABLE `ai_approvals` ADD CONSTRAINT `chk_ai_approval_target` CHECK (approved_target IN ('ENCOUNTER_NOTE_SECTION','DIAGNOSIS'));
ALTER TABLE `ai_approvals` ADD CONSTRAINT `chk_ai_approval_section` CHECK ((approved_target = 'ENCOUNTER_NOTE_SECTION' AND approved_section IS NOT NULL) OR (approved_target <> 'ENCOUNTER_NOTE_SECTION' AND approved_section IS NULL));

-- The approved diagnosis points back at the approval that created it, which is what makes
-- `source='ai_approved'` verifiable rather than a label anyone could set. The column is added here
-- rather than by the schema diff because `diagnoses` belongs to an earlier section, so the diff
-- between cumulative schemas cannot express it.
ALTER TABLE `diagnoses` ADD COLUMN `ai_approval_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE `diagnoses` ADD CONSTRAINT `fk_diagnosis_ai_approval` FOREIGN KEY (`tenant_id`,`ai_approval_id`) REFERENCES `ai_approvals` (`tenant_id`,`id`);
ALTER TABLE `diagnoses` ADD CONSTRAINT `chk_diagnosis_ai_source` CHECK ((source = 'ai_approved' AND ai_approval_id IS NOT NULL) OR (source <> 'ai_approved' AND ai_approval_id IS NULL));
