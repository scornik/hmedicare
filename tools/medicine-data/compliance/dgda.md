# Compliance: dgda

- Source: DGDA Allopathic Medicine Information (official registry)
- Origin: http://180.211.137.202:9310
- Gate run: 2026-09-17T10:15:09.258Z
- **Verdict: UNCLEAR** · `LEGAL_REVIEW_REQUIRED`
- Manual review verdict: UNCLEAR
- Basis: Official DGDA public "Allopathic Medicine Information" registry, linked from https://dgda.gov.bd ("এ্যালোপ্যাথিক ড্রাগ ডাটাবেজ"). No terms of use found; robots.txt returns 404 (no restrictions). The page shows a "Content is protected" alert on right-click/DevTools, which is a UI deterrent, not a legal term; flagged for LEGAL_REVIEW_REQUIRED.
- Gate: Manual review: UNCLEAR.

## robots.txt

- URL: http://180.211.137.202:9310/robots.txt
- HTTP status: 404 (no robots.txt → no restrictions)
- Fetched: 2026-09-17T10:15:09.320Z
- SHA-256: n/a
- Crawl-delay: not specified (tool default 3–6 s)
- Sitemaps: none
- Disallow (group applying to HakeemifyMedicineIndexBot): none
- Needed paths: `/Allopathic/` allowed

## Terms of use

### https://dgda.gov.bd/

- Fetched: not fetched
- HTTP status: n/a
- SHA-256: n/a
- Fetch error: robots.txt unreachable for dgda.gov.bd: fetch failed: UNABLE_TO_VERIFY_LEAF_SIGNATURE unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca

## Public endpoints used

- `http://180.211.137.202:9310/Allopathic/Medicine_Information_Ajax.php?action=export` — Unauthenticated CSV export used by the page's own 'Export All to Excel (CSV)' button; one request retrieves the full registry (41,270 entries shown on 2026-09-17).
- `http://180.211.137.202:9310/Allopathic/Medicine_Information_Ajax.php?action=list` — Unauthenticated server-side DataTables endpoint used by the page; fallback only if export fails.

## Notes

- dgda.gov.bd and info.dgda.gov.bd fail TLS verification in Node (incomplete chain / expired certificate). info.dgda.gov.bd/allopathic-medicines was not used.
- The registry is served over plain HTTP from a government IP; content hash is recorded for provenance.
- Per-product DGDA price pages (?Medicine_Price_Detail/...) are not fetched (41k requests); prices are out of scope for this run.

## Permission contact

DGDA, Mohakhali, Dhaka (verify official contact on dgda.gov.bd)
