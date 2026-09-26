-- Constraints for `prescription_items` (DATABASE-IMPLEMENTATION.md §3.9).
-- A line is either a catalog selection or free text. Both would mean the snapshot and the typed name
-- can disagree about what was prescribed; neither would mean the line names nothing at all.
ALTER TABLE `prescription_items` ADD CONSTRAINT `chk_prescription_items_source` CHECK ((is_free_text = 1 AND free_text_name IS NOT NULL AND medication_id IS NULL) OR (is_free_text = 0 AND medication_id IS NOT NULL AND free_text_name IS NULL));
-- A catalog line records which dataset version it was chosen from, so a later import cannot silently
-- change the meaning of an item somebody already signed.
ALTER TABLE `prescription_items` ADD CONSTRAINT `chk_prescription_items_catalog_version` CHECK (medication_id IS NULL OR medication_dataset_version IS NOT NULL);
ALTER TABLE `prescription_items` ADD CONSTRAINT `chk_prescription_items_sequence` CHECK (sequence >= 1);
ALTER TABLE `prescription_items` ADD CONSTRAINT `fk_prescription_items_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`);
ALTER TABLE `prescription_items` ADD CONSTRAINT `fk_prescription_items_prescription` FOREIGN KEY (`tenant_id`, `prescription_id`) REFERENCES `prescriptions` (`tenant_id`, `id`);
-- No ON DELETE CASCADE: the catalog never deletes a medication, it deactivates it (ADR-020 §2). A row
-- referenced here must stay readable and renderable forever, which is exactly what this FK guarantees.
ALTER TABLE `prescription_items` ADD CONSTRAINT `fk_prescription_items_medication` FOREIGN KEY (`medication_id`) REFERENCES `medications` (`id`);
