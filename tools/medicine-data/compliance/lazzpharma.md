# Compliance: lazzpharma

- Source: Lazz Pharma
- Origin: https://lazzpharma.com
- Gate run: 2026-09-17T10:15:48.772Z
- **Verdict: UNCLEAR** · `LEGAL_REVIEW_REQUIRED`
- Manual review verdict: UNCLEAR
- Basis: Terms page (read in a browser) covers order cancellation, disclaimers and delivery only; it contains no clause on content reuse, scraping or automated access. No explicit licence either, so LEGAL_REVIEW_REQUIRED.
- Gate: Manual review: UNCLEAR.

## robots.txt

- URL: https://lazzpharma.com/robots.txt
- HTTP status: 200
- Fetched: 2026-09-17T10:15:49.266Z
- SHA-256: e5ab0d231eeb01b4a982d1c79a6729cac9797ad15a69247e4f28ba6afc149b4c
- Crawl-delay: not specified (tool default 3–6 s)
- Sitemaps: none
- Disallow (group applying to HakeemifyMedicineIndexBot): none
- Needed paths: `/` allowed, `/product/details/` allowed

```text
# https://www.robotstxt.org/robotstxt.html
User-agent: *
Disallow:
```

## Terms of use

### https://lazzpharma.com/termsCondition

- Fetched: 2026-09-17T10:15:52.325Z
- HTTP status: 200
- SHA-256: a65c7fb4b9f2ea661eb7a6e2468509106f7f4da41442cf8a953efade2163c47c

## Notes

- www.lazzpharma.com redirects to lazzpharma.com; origin set to https://lazzpharma.com.
- Product and category pages are client-rendered (Next.js BAILOUT_TO_CLIENT_SIDE_RENDERING). Only the server-rendered homepage cards (#ssr-home) and detail-page <title> are usable without JavaScript.
- Category listings load from POST https://client.lazzpharma.com/ProductArea/CategoryProductPrivot/GetProductsByCategory, which registers a device id. Treated as a private app API: NOT used.
- No sitemap: /sitemap.xml serves the homepage.

## Permission contact

support@lazzpharma.com (listed in terms)
