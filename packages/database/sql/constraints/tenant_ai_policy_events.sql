ALTER TABLE `tenant_ai_policy_events` ADD CONSTRAINT `fk_tenant_ai_event_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `tenant_ai_policy_events` ADD CONSTRAINT `fk_tenant_ai_event_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `tenant_ai_policy_events` ADD CONSTRAINT `chk_tenant_ai_event_versions` CHECK (seq > 0 AND policy_version > 0);
ALTER TABLE `tenant_ai_policy_events` ADD CONSTRAINT `chk_tenant_ai_event_snapshots` CHECK (JSON_TYPE(`before`) = 'OBJECT' AND JSON_TYPE(`after`) = 'OBJECT');
