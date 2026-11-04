-- hmedic:normalized v1
-- Raw audio requires a separate tenant decision. Existing clinics remain opted out.
ALTER TABLE `tenant_ai_policies`
  ADD COLUMN `raw_media_allowed` BOOLEAN NOT NULL DEFAULT false;
