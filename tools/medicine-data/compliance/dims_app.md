# Compliance: dims_app

- Source: Play Store app listing (com.twgbd.drugindex; DIMS is com.twgbd.dims)
- Origin: https://play.google.com
- Gate run: 2026-09-17T10:15:52.335Z
- **Verdict: PROHIBITED**
- Manual review verdict: PROHIBITED
- Basis: App data may not be extracted (no APK download/decompile, bundled DB extraction, traffic interception or private APIs). Listing read for ownership only. Contributes no records unless a licensed feed is provided.
- Gate: Manual review: terms prohibit automated access or data reuse (never relaxed automatically).

## robots.txt

Not fetched: this source is a mobile app. Only the public Play Store listing was read (in a browser) for ownership metadata. No APK download, decompilation, database extraction, traffic interception or private API use.

## Terms of use

Not applicable (see listing below).

## Play Store listing (public, read for ownership only)

- package: com.twgbd.drugindex
- read_at: 2026-09-17
- app_name: Drug Index - BD Medicine Info
- publisher: Advocate Mosiur Rahman
- updated_on: Aug 17, 2026
- summary: Free offline medicine reference app for Bangladesh (21,000+ brands, 1,500 generics); states its data is based on the CC BY 4.0 dataset by Rahman & Khan, University of Dhaka.
- note: The package id in the Stage M brief is NOT the DIMS app. Its stated upstream dataset is ingested directly as source mendeley_bd_meds.

- package: com.twgbd.dims
- read_at: 2026-09-17
- app_name: DIMS
- publisher: IT Medicus Solutions (developed by ITmedicus)
- updated_on: Jul 5, 2026
- contact: dims@itmedicus.com (published by the developer in Play Store review replies)
- summary: Drug Information Management System; offline drug index claiming 28,000+ brands and 2,228+ generics.

## Permission contact

dims@itmedicus.com
