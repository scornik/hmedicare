-- hmedic:normalized v1
-- Migration 202610061900_0009_prescription_render_link. Hand-written (one column and its foreign key).
-- It carries section 0009, the section whose table it alters: an ALTER to an existing table has no
-- section of its own, and `migration-new.mjs` only ever diffs whole sections, so a column added to a
-- model that already shipped cannot come from the generator.
-- Never edit after it has been applied anywhere (scripts/ci/check-applied-migrations.mjs).
--
-- `prescriptions.render_template_version`, `last_render_sha256` and `last_rendered_at` shipped with
-- section 0009, but the link to the stored PDF could not: `documents` did not exist until 0010. The
-- schema comment said so and this is the follow-up it promised (RX-005).
--
-- Nullable, and it stays null for every prescription nobody asked to render. No cascade: deleting a
-- document must not quietly delete the prescription that points at it, and a prescription whose PDF was
-- removed is a prescription with no PDF, not a prescription that never existed.
ALTER TABLE `prescriptions` ADD COLUMN `rendered_document_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE `prescriptions` ADD CONSTRAINT `fk_prescriptions_rendered_document` FOREIGN KEY (`tenant_id`, `rendered_document_id`) REFERENCES `documents` (`tenant_id`, `id`);
-- An AVAILABLE render has to name the document it produced. Without this, `render_status = 'AVAILABLE'`
-- with a null link is a prescription that claims a PDF nobody can fetch.
ALTER TABLE `prescriptions` ADD CONSTRAINT `chk_prescriptions_render_available` CHECK (render_status <> 'AVAILABLE' OR rendered_document_id IS NOT NULL);
