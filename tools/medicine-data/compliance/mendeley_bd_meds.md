# Compliance: mendeley_bd_meds

- Source: Medicinal Products in Bangladesh (Mendeley Data, CC BY 4.0)
- Origin: https://data.mendeley.com
- Gate run: 2026-09-17T10:43:54.613Z
- **Verdict: UNCLEAR** · `LEGAL_REVIEW_REQUIRED`
- Manual review verdict: ALLOWED
- Basis: Published on Mendeley Data under CC BY 4.0 (DOI 10.17632/zhtvkny53n.1), which permits reuse including commercial use with attribution. Added with explicit approval from the project owner on 2026-09-17. Collection method is undocumented by the authors, so upstream rights are unverified; LEGAL_REVIEW_REQUIRED.
- Gate: Terms content changed since the last gate run; re-review required.

## robots.txt

- URL: https://data.mendeley.com/robots.txt
- HTTP status: 200
- Fetched: 2026-09-17T10:43:55.420Z
- SHA-256: 92d19bf9fd4411ce84f1289f5d7b4ceea1bc486b8b27887e2e4db020cfff0f04
- Crawl-delay: not specified (tool default 3–6 s)
- Sitemaps: https://data.mendeley.com/sitemap, https://data.mendeley.com/sitemap/index
- Disallow (group applying to HakeemifyMedicineIndexBot): `/admin/`, `/api/`, `/institutions/`, `/internal-admin/`, `/my-data/`, `/preview/`, `/*?*page=`, `/*?*repositoryType=`, `/*?*search=`, `/*?*source=`, `/*?*type=`
- Needed paths: `/public-files/datasets/zhtvkny53n/` allowed

```text
User-Agent: *
Disallow: /admin/
Allow /api/docs
Disallow: /api/
Disallow: /institutions/
Disallow: /internal-admin/
Disallow: /my-data/
Disallow: /preview/
Disallow: /*?*page=
Disallow: /*?*repositoryType=
Disallow: /*?*search=
Disallow: /*?*source=
Disallow: /*?*type=

Sitemap: https://data.mendeley.com/sitemap
Sitemap: https://data.mendeley.com/sitemap/index
```

## Terms of use

### https://data.mendeley.com/datasets/zhtvkny53n/1

- Fetched: 2026-09-17T10:44:01.636Z
- HTTP status: 200
- SHA-256: 57b57650a07c8751ed244651845b7a3355ee98d9f3f593cc3c2ab23fa787b40f

Reviewed clauses (verbatim, < 25 words):

- "CC BY 4.0" — present in bot-fetched page

Auto-scan excerpts for reviewer attention (< 25 words each):

- "All rights are reserved, including those for text and data mining, AI training and similar technologies."

## Public endpoints used

- `https://data.mendeley.com/public-files/datasets/zhtvkny53n/files/5a89a3c5-57e9-4ddf-bcde-16f4a9ec5d5d/file_downloaded` — Single CSV file (2,177,882 bytes), published SHA-256 293036d5c24268c6526df4ae9ba59e3d80f40380b79bdf40859c83419b52a8fd.

## Notes

- Gate auto-scan (2026-09-17) found the Mendeley Data website footer: "All rights are reserved, including those for text and data mining, AI training and similar technologies." This reservation covers Elsevier/Mendeley website content. The dataset file is separately licensed CC BY 4.0 by its authors. The tool makes a single request for the licensed file via its public download link and does not crawl or mine website pages. Legal review should confirm this reading.
- robots.txt permits /public-files/ (disallows /api/, /preview/, search/query URLs).
- The dataset landing page is dynamic (its SHA-256 differs on every fetch), so the gate downgrades ALLOWED to UNCLEAR as 'terms changed'. This is conservative and expected; the CC BY 4.0 licence of the versioned V1 file is unaffected.
- The public download link redirects to a signed Amazon S3 URL. On 2026-09-17 the first crawl marked the source BLOCKED because the bucket answered /robots.txt with HTTP 403 (S3 AccessDenied for a missing object, served identically to every client, not a denial of our access). Per RFC 9309 §2.3.1.3 a 4xx robots.txt means 'no rules'; the fetcher now applies that only to adapter-listed object-storage redirect hosts, and a 401/403/429 on the file itself still blocks. The block was lifted with the audited `unblock` command.

## Required attribution

Rahman, Md Mahmudur; Khan, Md M (2024), “Medicinal Products in Bangladesh - A Dataset of Generic and Brand Names, Dosage Strengths, and Manufacturers”, Mendeley Data, V1, doi: 10.17632/zhtvkny53n.1. Licensed CC BY 4.0. Changes: normalized and merged.
