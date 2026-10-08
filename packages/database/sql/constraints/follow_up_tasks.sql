ALTER TABLE `follow_up_tasks` ADD CONSTRAINT `chk_follow_up_tasks_type` CHECK (task_type IN ('REMINDER','CALL','BOOKING_ASSIST'));
ALTER TABLE `follow_up_tasks` ADD CONSTRAINT `chk_follow_up_tasks_status` CHECK (status IN ('OPEN','DONE','CANCELLED'));
ALTER TABLE `follow_up_tasks` ADD CONSTRAINT `chk_follow_up_tasks_version` CHECK (row_version > 0);
ALTER TABLE `follow_up_tasks` ADD CONSTRAINT `fk_follow_up_tasks_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `follow_up_tasks` ADD CONSTRAINT `fk_follow_up_tasks_plan` FOREIGN KEY (`tenant_id`,`follow_up_plan_id`) REFERENCES `follow_up_plans` (`tenant_id`,`id`);
ALTER TABLE `follow_up_tasks` ADD CONSTRAINT `fk_follow_up_tasks_assignee` FOREIGN KEY (`assigned_user_id`) REFERENCES `users` (`id`);