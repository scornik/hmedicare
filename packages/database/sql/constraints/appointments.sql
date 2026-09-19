-- Constraints for `appointments` (DATABASE-IMPLEMENTATION.md §3.5). Appended by db:migration:normalize.
ALTER TABLE `appointments` ADD CONSTRAINT `chk_appointments_source` CHECK (source IN ('ADVANCE_BOOKING', 'WALK_IN', 'FOLLOW_UP', 'RESCHEDULE'));
ALTER TABLE `appointments` ADD CONSTRAINT `chk_appointments_care_mode` CHECK (care_mode IN ('PHYSICAL', 'REMOTE', 'HYBRID'));
ALTER TABLE `appointments` ADD CONSTRAINT `chk_appointments_status` CHECK (status IN ('REQUESTED', 'PENDING_PAYMENT', 'BOOKED', 'CANCELLED', 'RESCHEDULED', 'FULFILLED', 'NO_SHOW'));
ALTER TABLE `appointments` ADD CONSTRAINT `chk_appointments_payment_requirement` CHECK (payment_requirement IN ('NONE', 'OPTIONAL', 'PREPAID'));
ALTER TABLE `appointments` ADD CONSTRAINT `chk_appointments_payment_status` CHECK (payment_status IN ('NOT_REQUIRED', 'PENDING', 'PAID', 'WAIVED', 'REFUNDED'));
ALTER TABLE `appointments` ADD CONSTRAINT `chk_appointments_on_behalf` CHECK (booked_on_behalf IS NULL OR booked_on_behalf IN ('SELF', 'GUARDIAN', 'STAFF'));
ALTER TABLE `appointments` ADD CONSTRAINT `chk_appointments_hold` CHECK (status <> 'PENDING_PAYMENT' OR payment_hold_expires_at IS NOT NULL);
ALTER TABLE `appointments` ADD CONSTRAINT `chk_appointments_waived` CHECK (payment_status <> 'WAIVED' OR payment_waived_reason IS NOT NULL);
ALTER TABLE `appointments` ADD CONSTRAINT `fk_appointments_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `appointments` ADD CONSTRAINT `fk_appointments_patient` FOREIGN KEY (`tenant_id`, `patient_id`) REFERENCES `patients` (`tenant_id`, `id`);
ALTER TABLE `appointments` ADD CONSTRAINT `fk_appointments_doctor` FOREIGN KEY (`tenant_id`, `doctor_profile_id`) REFERENCES `doctor_profiles` (`tenant_id`, `id`);
ALTER TABLE `appointments` ADD CONSTRAINT `fk_appointments_chamber` FOREIGN KEY (`tenant_id`, `chamber_id`) REFERENCES `chambers` (`tenant_id`, `id`);
ALTER TABLE `appointments` ADD CONSTRAINT `fk_appointments_day` FOREIGN KEY (`tenant_id`, `chamber_day_id`) REFERENCES `chamber_days` (`tenant_id`, `id`);
ALTER TABLE `appointments` ADD CONSTRAINT `fk_appointments_slot` FOREIGN KEY (`tenant_id`, `slot_id`) REFERENCES `appointment_slots` (`tenant_id`, `id`);
ALTER TABLE `appointments` ADD CONSTRAINT `fk_appointments_rescheduled_from` FOREIGN KEY (`tenant_id`, `rescheduled_from_appointment_id`) REFERENCES `appointments` (`tenant_id`, `id`);
