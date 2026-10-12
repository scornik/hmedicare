-- ai_model_catalog (ADAPT-002). Global table: no tenant foreign key, by design.
ALTER TABLE `ai_model_catalog` ADD CONSTRAINT `chk_ai_model_source` CHECK (source IN ('PROVIDER_API','MANUAL_CONFIG'));
ALTER TABLE `ai_model_catalog` ADD CONSTRAINT `chk_ai_model_id_shape` CHECK (model_id <> '' AND provider_code <> '');
