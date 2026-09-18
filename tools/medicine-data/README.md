# Bangladesh medicine data acquisition tool (Stage M)

A standalone tool that builds a versioned, provenance-tracked Bangladesh medicine catalog for the HMedic prescription editor. It runs a compliance gate before any access.

- **It is not part of the product runtime.** Product packages must never import it. Stage 3.2 imports only its output (`dist/latest.json`).
- **Fetched pages, crawl state and datasets are never committed.** `.raw/`, `.state/` and `dist/` are gitignored.
- **Every dataset is `UNVERIFIED`.** Import it into local, dev or staging only. Production requires the gates in `DATASET-CARD.md`.
- **The data is factual catalog attributes only**: names, generics, strength, form, manufacturer, registration numbers and observed prices. It has no monograph prose, images, reviews or personal data, and is **not clinical guidance**.

## Quick start

Requires Node ≥ 22 and pnpm via corepack.

```powershell
cd tools/medicine-data
corepack pnpm install
corepack pnpm test
$env:CONTACT_EMAIL = '<monitored contact address>'   # required for every network command
corepack pnpm md compliance            # robots.txt + terms gate → compliance/
corepack pnpm md discover              # seeds, sitemaps, listing pages
corepack pnpm md crawl --sample 50     # first pass per source, then inspect:
corepack pnpm md parse
corepack pnpm md completeness          # per-source field completeness
corepack pnpm md crawl                 # full crawl within daily caps (resumable)
corepack pnpm md parse
corepack pnpm md build                 # normalize → merge → export → report
```

Other commands: `status`, `parse --reparse` (after a parser fix), `crawl --refresh` (conditional re-fetch), `prune-raw [--days 30]`, and `unblock --source <id> --reason "..."`. `unblock` is an audited manual lift of a BLOCKED status, for use only after you've investigated the block.

## Sources and verdicts (gate run 2026-09-17)

| Source | Verdict | Contributes | Notes |
|---|---|---|---|
| `dgda` | UNCLEAR (legal review) | yes | Official DGDA "Allopathic Medicine Information" registry, linked from dgda.gov.bd. One request to the page's own CSV export. |
| `mendeley_bd_meds` | UNCLEAR (legal review) | yes | CC BY 4.0 dataset (DOI 10.17632/zhtvkny53n.1). Added with owner approval; attribution required. |
| `lazzpharma` | UNCLEAR (legal review) | yes, few | Terms are silent on reuse. Only server-rendered homepage cards and detail `<title>` are parsed. |
| `medex` | PROHIBITED | no | Terms ban bots, crawlers and data extraction. |
| `arogga` | PROHIBITED | no | Personal non-commercial licence; no reproduction or derivative works. |
| `medeasy_en`, `medeasy_bn` | PROHIBITED | no | No copying, storing or derivative works; no commercial use without consent. |
| `osudpotro` | PROHIBITED | no | No reproducing, copying or redistributing. |
| `dims_app` | PROHIBITED | no | App data. Only the Play listing was read. The configured id `com.twgbd.drugindex` is a different app ("Drug Index", data from the Mendeley set); DIMS is `com.twgbd.dims`. |

Draft permission-request emails (English and Bangla) are in `compliance/*-permission-request.md`. Adapters exist only for sources that may be crawled; PROHIBITED sources have none.

## Access policy (enforced in `src/http/fetcher.ts`)

- **User-Agent:** `HakeemifyMedicineIndexBot/1.0 (+contact: $CONTACT_EMAIL)`. Commands refuse to start without a real address, and placeholder domains are rejected.
- **robots.txt:** `Disallow` rules are checked before every request and on every redirect hop. `Crawl-delay` is honoured, and a robots.txt that returns 5xx or can't be reached counts as disallow-all.
- **Pacing:** one request at a time per host, shared across sources. There is a randomized 3–6 s delay (or the Crawl-delay, if larger), persisted in SQLite so it holds across runs.
- **Caps:** 5,000 requests per host per day for ALLOWED/RESTRICTED sources and 1,500 for UNCLEAR ones. Overrides live in `medicine-data.config.json` (gitignored); delays can only go up and UNCLEAR caps can only go down.
- **Stop on block:** a 401/403/429 response or a bot-challenge page stops the source, and every source sharing its host. The event is recorded and nothing is retried. The only exception is narrow: an object-storage host that an adapter lists for a licensed file redirect may answer robots.txt with 4xx, which per RFC 9309 means "no rules". A 4xx on the file itself still blocks.
- **Never:** login, CAPTCHA solving, challenge bypass, proxy or IP rotation, browser user-agent spoofing, or private APIs.
- **Caching and resumption:** ETag/Last-Modified conditional requests, a resumable SQLite frontier (`.state/crawl.sqlite`), and gzip raw snapshots (`.raw/<source>/`, 30-day retention).

## Normalization and entity resolution

| Stage | Where | Summary |
|---|---|---|
| Strength | `src/normalize/units.ts` | Components per ingredient, handling combos and ratios. The canonical key uses mg, mg/ml and % w/w, with liquid % read as w/v. |
| Dosage form | `vocab/dosage_forms.yaml` | Controlled vocabulary via aliases and ordered patterns. Unknown values stay `unmapped` and go to review; nothing is guessed. |
| Generics | `src/normalize/generics.ts` | Salts, hydrates, pharmacopoeia tags and esters move to `salt_form`; the original text is kept. |
| Manufacturers | `src/normalize/manufacturers.ts`, `vocab/manufacturers.yaml` | Keys ignore suffixes, sites/units and spelling variants. Every merge is logged in `manufacturers.jsonl`. |
| Record key | `src/resolve/keys.ts` | `brand \| generic set \| strength \| form \| manufacturer`, plus an explicit parenteral route. |
| Fuzzy matching | `src/resolve/fuzzy.ts` | Two blocked passes, with the algorithm, thresholds and scores documented and recorded. Below the auto threshold → `review_queue.jsonl`. |
| Merge | `src/resolve/merge.ts` | Per-field provenance and precedence (DGDA > MedEx > open dataset > pharmacies, majority among pharmacies). All conflicts are kept; prices are never merged. |
| Bangla | `src/normalize/bangla.ts` | NFC normalization. Generated Banglish aliases are marked `alias_origin: generated` and used for search only. |

## Output

`dist/medicine-dataset-<YYYYMMDD>-<n>/` contains:

- `medications.jsonl`, `generics.jsonl`, `manufacturers.jsonl`, `aliases.jsonl`
- `prices_observed.jsonl`, `provenance.jsonl`, `conflicts.jsonl`, `review_queue.jsonl`
- `schema/`: a JSON Schema for each file
- `reports/`
- `DATASET-CARD.md` and `checksums.sha256`

`dist/latest.json` points to the newest version.

## Layout

```text
src/cli.ts                 commands
src/config.ts              sources, delays, caps, contact gate
src/compliance/            gate (robots/terms/verdicts) and permission emails
src/http/                  polite fetcher, robots, challenge detection, raw store
src/state/db.ts            SQLite frontier, request counts, events, parse results
src/sources/<source>/      discover.ts, parse.ts, fixtures/ (synthetic values)
src/normalize/ src/resolve/ src/export/ src/pipeline/
vocab/  compliance/  tests/  runs/
```
