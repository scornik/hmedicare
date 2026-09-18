# Compliance gate

`reviews.yaml` is the manual desk review (verdict, basis, short verbatim quotes, needed paths, public endpoints).
`pnpm md compliance` re-checks it against live robots.txt and terms pages using the bot user-agent, then writes:

- `<source>.md`: robots.txt (fetch date, SHA-256, parsed rules), terms (fetch date, SHA-256, quote verification, auto-scan excerpts), verdict
- `<source>-permission-request.md`: English + Bangla data-licensing request for PROHIBITED sources and the app
- `verdicts.json`: machine-readable verdicts consumed by `discover` / `crawl`
- `SUMMARY.md`: table of verdicts and records contributed (record counts refreshed by `report`)

Rules: PROHIBITED is never relaxed automatically; unreviewed scraping language forces PROHIBITED; robots-disallowed needed
paths → RESTRICTED; 401/403/429/challenge → BLOCKED; changed or unreadable terms downgrade ALLOWED → UNCLEAR.
This is not legal advice. Legal review of UNCLEAR / LEGAL_REVIEW_REQUIRED sources is a production gate.
