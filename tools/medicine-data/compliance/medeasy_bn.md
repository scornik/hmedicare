# Compliance: medeasy_bn

- Source: MedEasy (Bangla)
- Origin: https://medeasy.health
- Gate run: 2026-09-17T10:17:03.900Z
- **Verdict: PROHIBITED**
- Manual review verdict: PROHIBITED
- Basis: Same site and operator as medeasy_en; Bangla terms page carries matching clauses.
- Gate: Manual review: terms prohibit automated access or data reuse (never relaxed automatically).

## robots.txt

- URL: https://medeasy.health/robots.txt
- HTTP status: 200
- Fetched: 2026-09-17T10:16:59.337Z
- SHA-256: a595028610ff4fb5f81eb592832ceae72adf4acffb775209a594efd5bc5e45ea
- Crawl-delay: not specified (tool default 3–6 s)
- Sitemaps: https://medeasy.health/sitemap.xml
- Disallow (group applying to HakeemifyMedicineIndexBot): `/cgi-bin/`
- Needed paths: `/bn/medicines/` allowed

```text
User-agent: *
Disallow:
Disallow: /cgi-bin/
Sitemap: https://medeasy.health/sitemap.xml
```

## Terms of use

### https://medeasy.health/bn/terms-and-conditions

- Fetched: 2026-09-17T10:17:09.238Z
- HTTP status: 200
- SHA-256: 9501ad4a644d5773f006928c0070ea1c41bd5917a4e6007bf79958cf0421ac53

Auto-scan excerpts for reviewer attention (< 25 words each):

- "Copy, reproduce, store (in any medium or format), distribute, transmit, modify, create derivative works from all or any part of this website/mobile application or …"

## Permission contact

Same as medeasy_en
