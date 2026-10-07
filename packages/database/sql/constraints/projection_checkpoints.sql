ALTER TABLE `projection_checkpoints` ADD CONSTRAINT `chk_projection_version` CHECK (projection_version > 0);
ALTER TABLE `projection_checkpoints` ADD CONSTRAINT `fk_projection_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
