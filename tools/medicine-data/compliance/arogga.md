# Compliance: arogga

- Source: Arogga
- Origin: https://www.arogga.com
- Gate run: 2026-09-17T10:15:22.591Z
- **Verdict: PROHIBITED**
- Manual review verdict: PROHIBITED
- Basis: Terms grant only a personal, non-commercial licence and forbid reproducing or creating derivative works from platform content without prior written consent (data reuse). Terms page renders only with JavaScript; reviewed in a browser.
- Gate: Manual review: terms prohibit automated access or data reuse (never relaxed automatically).

## robots.txt

- URL: https://www.arogga.com/robots.txt
- HTTP status: 200
- Fetched: 2026-09-17T10:15:22.678Z
- SHA-256: 0940fcccb9c1896754cd552ed1d4b641fd6d16aed8a6188b7b671f95362c156a
- Crawl-delay: not specified (tool default 3–6 s)
- Sitemaps: https://www.arogga.com/sitemap.xml
- Disallow (group applying to HakeemifyMedicineIndexBot): `/account$`, `/account/$`, `/account/transaction-history`, `/account/orders`, `/account/lab-test/orders`, `/account/notified-products`, `/account/wishlist`, `/account/prescriptions`, `/account/lab-test/reports`, `/account/suggest-products`, `/account/address`, `/account/lab-test/manage-patients`, `/account/product-reviews`, `/account/rider-reviews`, `/account/inbox`
- Needed paths: `/product/` allowed

```text
User-Agent: *
Allow: /
Disallow: /account$
Disallow: /account/$
Disallow: /account/transaction-history
Disallow: /account/orders
Disallow: /account/lab-test/orders
Disallow: /account/notified-products
Disallow: /account/wishlist
Disallow: /account/prescriptions
Disallow: /account/lab-test/reports
Disallow: /account/suggest-products
Disallow: /account/address
Disallow: /account/lab-test/manage-patients
Disallow: /account/product-reviews
Disallow: /account/rider-reviews
Disallow: /account/inbox

Sitemap: https://www.arogga.com/sitemap.xml
```

## Terms of use

### https://www.arogga.com/page/tos

- Fetched: 2026-09-17T10:15:28.331Z
- HTTP status: 200
- SHA-256: e90b40e00430dded09104ae1db11ffc73cbcaa3db2966e3589e4b0fb17db2a59

Reviewed clauses (verbatim, < 25 words):

- "Users are granted a limited, non-exclusive license to access and use the platform for personal, non-commercial purposes." — present in bot-fetched page
- "You may not reproduce, distribute, modify, or create derivative works from the platform's content without prior written consent from Arogga." — present in bot-fetched page

## Permission contact

info@arogga.com (listed in terms section 2.3.2)
