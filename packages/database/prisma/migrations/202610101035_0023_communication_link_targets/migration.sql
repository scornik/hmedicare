-- hmedic:normalized v1
-- Extend short-link targets for follow-up communication intents. Existing target types are retained.
-- Never edit after it has been applied anywhere.
ALTER TABLE `communication_short_links`
    DROP CONSTRAINT `chk_communication_short_links_target_type`,
    ADD CONSTRAINT `chk_communication_short_links_target_type`
        CHECK (target_type IN ('SERIAL','APPOINTMENT','PAYMENT_INTENT','PRESCRIPTION','DOCUMENT_LIST','COMMUNICATION'));
