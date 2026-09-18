# Stage M session log, 2026-09-17

Status: **STAGE M COMPLETE** for all sources that may currently be crawled. The output is UNVERIFIED and production gates are outstanding.
Generated run log for the final build: `runs/2026-09-17T10-44-29-610Z.md`. Dataset: `dist/medicine-dataset-20260917-4`.

## What happened

1. The earlier scaffold (`runs/20260917-stage-m.md`) never ran; its "BLOCKED" verdicts came from a robots-parser import bug. The tool was rebuilt.
2. Desk review of every source's terms, reading JavaScript-rendered pages in a normal browser:
   - MedEx, Arogga, MedEasy (EN/BN) and Osudpotro are PROHIBITED by their terms.
   - LazzPharma's terms are silent on reuse, so UNCLEAR.
   - DGDA: the official portal links a public Allopathic Medicine Information database (41,270 rows) with a CSV export button.
   - The Play package id in the brief (`com.twgbd.drugindex`) is "Drug Index" by Advocate Mosiur Rahman, whose data comes from a CC BY 4.0 Mendeley dataset. DIMS is `com.twgbd.dims` (IT Medicus).
3. The project owner supplied CONTACT_EMAIL and approved adding the Mendeley CC BY 4.0 dataset as a source.
4. Compliance gate run with the bot user-agent:
   - No source was blocked.
   - Research quotes for MedEx were paraphrased, so they were replaced with verbatim text from the bot-fetched page.
   - The Mendeley site footer reserves text-and-data-mining rights for site content; this is noted for legal review.
5. Sample crawl, 50 pages per source:
   - DGDA export: one request, 41k rows.
   - LazzPharma: 50 detail pages.
   - Mendeley stopped: its S3 bucket answered /robots.txt with 403. Investigation showed a standard AccessDenied-for-missing-object response, not a denial of access. An RFC 9309 rule (4xx robots.txt = no rules) was added, only for adapter-listed object-storage redirect hosts, and the block was lifted with the audited `unblock` command.
6. Parser and normalization fixes after inspecting completeness and match quality:
   - Decimals without a leading zero (".5 mg").
   - Raw-material registrations skipped.
   - Mendeley column mapping: `dosageType` is the form; `packageMark` is a slug, not a pack size.
   - LazzPharma numeric "generics" and "FOREIGN" manufacturer dropped.
   - Canonical strength keys: unit conversion, ingredient ordering, liquid % read as w/v.
   - Manufacturer keys ignore sites, units and spelling variants.
   - Dosage-form families; a second fuzzy pass for generic spelling variants.
   - DGDA multi-plant registrations count as MATCHED.
   - Result: the DGDA match rate for non-DGDA records rose from 28.2% to 47.5%. A random sample of 30 fuzzy auto-merges was checked by hand: all were the same product.
7. The full crawl finished well within caps (147 requests to LazzPharma, 1 to DGDA's export, 2 to Mendeley plus redirect).

## Requests made (approximate)

| Host | Requests | Purpose |
|---|---:|---|
| 180.211.137.202:9310 (DGDA) | 2 | robots.txt, CSV export |
| data.mendeley.com / S3 | ~8 | robots.txt ×2, dataset page ×3 (gate runs), file download + redirect |
| lazzpharma.com | ~150 | robots.txt, terms, homepage, 144 product pages |
| medex, arogga, medeasy, osudpotro | 2–4 each | robots.txt and terms only (gate) |

## Not done / follow-ups

- Permission-request emails are drafts; nothing was sent.
- The DGDA imported-drugs list (dgdagov.info) and DGDA per-product prices were not ingested.
- Review queue (5,738 fuzzy, 26 unmapped form labels) not yet worked.
- Legal review, pharmacist sample review, and the Stage 3.2 import safeguards are outstanding.
