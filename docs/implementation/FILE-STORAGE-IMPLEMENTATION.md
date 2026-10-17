# File Storage Implementation Contract

**Stage 3.1 rewrite (2026-09-17).** Authority: ADR-016. Routes: `API-IMPLEMENTATION.md` §3.8 (unified `/documents/upload-sessions`). Tables: `DATABASE-IMPLEMENTATION.md` §3.10.

## 1. Adapters and selection

| `STORAGE_ADAPTER` | Environments | Upload path | Download path |
|---|---|---|---|
| `s3` | local (MinIO), CI (MinIO), staging/production once a provider is selected | client → presigned multipart part URLs (≤ 15 min) → `finalize` | API authorizes → `POST /documents/{id}/download-token` → `GET /documents/{id}/download?token=` returns `302` to a presigned GET (60 s, `response-content-disposition=attachment`) |
| `disk` | local (temp dir), CI, **staging**; **production only if HOST-007 passes** | client → `PUT /documents/upload-sessions/{id}/parts/{n}` streamed through the API | `GET /documents/{id}/download?token=` streams through the API |

Clients always use the same four API calls (`create session`, `upload parts` or `get part targets`, `finalize`, `download-token`→`download`). The session response carries `mode: "direct" | "proxied"`, so web and mobile upload managers support both.

## 2. Upload lifecycle

```text
documents: CREATED -> UPLOADING -> UPLOADED -> SCANNING -> AVAILABLE
           CREATED/UPLOADING -> EXPIRED
           UPLOADED/SCANNING -> REJECTED
           SCANNING -> SCAN_ERROR -> SCANNING (retry) | REJECTED
upload_sessions: OPEN -> FINALIZING -> FINALIZED | ABORTED | EXPIRED
```

1. **`POST /documents/upload-sessions`** with `{category, patientId, encounterId?, contentType, sizeBytes, sha256, fileName?}`.
   - Checks: tenant/patient/encounter access, category permission, content type in `UPLOAD_ALLOWED_TYPES[category]`, `sizeBytes ≤ UPLOAD_MAX_BYTES[category]`, rate limit `upload-session:user`.
   - Inserts `documents` (CREATED) and `upload_sessions` (OPEN, `expires_at = now + UPLOAD_SESSION_TTL_MINUTES` (60), `part_size_bytes = UPLOAD_PART_SIZE_BYTES` (5 MiB, max 8 MiB)).
   - Calls `ObjectStoragePort.createUploadSession`. The response has `sessionId`, `mode`, `partSizeBytes`, `partCount`, `expiresAt`.
2. **Parts.**
   - Proxied: `PUT …/parts/{n}` with header `X-Part-SHA256`. The API streams the body to `<root>/.uploads/<sessionId>/<n>.part` with a byte limit and on-the-fly SHA-256; a mismatch deletes the part and returns `CHECKSUM_MISMATCH`. The first part moves the document to UPLOADING.
   - Direct: `POST …/parts {partNumbers}` returns presigned URLs.
   - Re-uploading a part number replaces it (resume).
3. **`POST …/finalize {parts: [{partNumber, sha256, etag?}]}`.**
   - Lock the session, verify all parts are present, complete the upload through the adapter (disk: ordered concatenation with streaming SHA-256 of the whole file, `fsync`, atomic rename; S3: `CompleteMultipartUpload` then `HeadObject` size check, plus a checksum read-through stream).
   - Compare size and full SHA-256 with the session values.
   - Insert `document_versions` (revision = current + 1, scan `PENDING`); documents → UPLOADED → SCANNING; enqueue `ScanDocumentVersion`.
4. **Scan job.** `MalwareScanPort.scan` (ADR-016 §2):
   - `CLEAN` → document AVAILABLE, `current_revision` set;
   - `REJECTED` → REJECTED, object deleted after the audit record, uploader notified;
   - `ERROR` → SCAN_ERROR and retry.
   
   Image re-encode stores a derived revision (`derived_from_revision`) and deletes the original object.
5. **Download.** `POST /documents/{id}/download-token` re-checks authorization and requires `status=AVAILABLE` (else `DOCUMENT_NOT_AVAILABLE`). It returns a token (HMAC-SHA-256 with `DOWNLOAD_TOKEN_SECRET` over `tenantId|actorId|documentId|revision|exp`, TTL `DOWNLOAD_TOKEN_TTL_SECONDS` 60). Single use is tracked in `rate_limit_counters` scope `download-token:used` for the TTL window. `GET …/download?token=` validates and streams or redirects, with headers `Content-Type` (stored), `Content-Disposition: attachment; filename*=UTF-8''<safe name>`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Security-Policy: sandbox`.

## 3. Policy defaults (configuration, reviewed before production)

| Category | Allowed types | `UPLOAD_MAX_BYTES` default |
|---|---|---|
| `LAB_REPORT` | `application/pdf`, `image/jpeg`, `image/png`, `image/webp` | 20 MiB |
| `IMAGE` | `image/jpeg`, `image/png`, `image/webp` | 10 MiB |
| `REFERRAL`, `OTHER` | `application/pdf`, `image/jpeg`, `image/png` | 20 MiB |
| `PRESCRIPTION_PDF` | generated only (no upload route) | — |
| `AI_RAW` | generated only | — |

Defaults are not clinical policy. Mobile compresses images before upload within `MOBILE_IMAGE_MAX_EDGE_PX` (2048) and a JPEG quality of 0.8, and preserves originals only when policy permits.

## 4. Private disk adapter rules (ADR-016)

- `STORAGE_DISK_ROOT` is absolute, outside every public root and the app deploy directory (`hbuilds/`). Startup refuses to start if it is inside `public_html`, `hbuilds`, the app working directory or `STORAGE_DISK_FORBIDDEN_ROOTS`, or if it is not writable.
- Directory layout: `<root>/objects/t/<tenantId>/<category>/<uuidv7>/<revision>`, `<root>/.uploads/<sessionId>/`, `<root>/.tmp/`. Directory mode `0700`, file mode `0600`.
- **Path safety:** keys are generated only by the server and validated against `^t/[0-9a-f-]{36}/[a-z-]+/[0-9a-f-]{36}/[0-9]+$`. `path.resolve(root, key)` must start with `root + path.sep`. `lstat` rejects symlinks at every path segment.
- **Disk usage job** (`DiskUsageCheck`, hourly): computes storage-root bytes (incremental from `document_versions.size_bytes` plus a periodic full walk) and filesystem free space (`fs.statfs`). It alerts at 60% and 75% of `STORAGE_DISK_BUDGET_GB` (40), and at 80% of plan disk.
- **Backups** include `<root>/objects` (`DEPLOYMENT.md` §6).

## 5. Authorization checks (every action)

Tenant, patient/encounter relationship (assignment, scope or patient context), category permission and actor role are checked on upload-session create, part upload (session owner = creating actor, same session), finalize, download-token and download (token binds actor and revision). Bucket and disk objects are never listable or publicly reachable.

## 6. Tests (shared contract suite for both adapters)

- **Adapter contract suite** (`packages/storage-adapters/test/contract.ts`, run for `s3`+MinIO and `disk`+temp dir):
  - multipart upload and resume (replace a part);
  - checksum mismatch at part and at finalize;
  - abort;
  - expired session;
  - range read;
  - delete;
  - capability flags;
  - large file streaming without heap growth (upload 200 MiB synthetic with the heap limit set to 128 MB).
- **Disk-only tests:**
  - **path traversal** (`../`, encoded `%2e%2e`, absolute paths, symlink planted inside root);
  - root inside a public directory refused at startup;
  - file permissions.
- **API tests:**
  - wrong tenant; wrong patient; guardian without `UPLOAD_DOCUMENTS`;
  - MIME spoofing (PNG bytes declared as PDF) → REJECTED;
  - oversized → `PAYLOAD_TOO_LARGE`;
  - duplicate finalize (idempotent);
  - download before AVAILABLE;
  - expired or reused token;
  - token for another revision;
  - logout/device revocation invalidates token issuance.
- **Direct storage path access:**
  - the disk root is not served by the web server (HOST-007 probe);
  - S3 objects are private (unsigned GET → 403 in MinIO).
- **Scanner tests:**
  - baseline scanner rejects encrypted PDFs, PDFs with `/JavaScript`, and non-allowed types;
  - image re-encode strips EXIF GPS;
  - the mock scanner verdict matrix.

## Implemented foundation (2026-10-15)

The generated-document portion of the storage port now has disk and S3-compatible
adapters. S3 uses bounded temporary-file spooling, SHA-256 metadata/checksums,
conditional immutable writes, private reads/ranges and idempotent deletion. The
shared generated-object contract runs against the pinned local MinIO image,
including concurrent revision writes and unsigned-access denial. Vendor error
messages are sanitized and objects missing integrity metadata fail closed.

This is a foundation for DOC-002, not completion of the upload plan above.
Multipart/resumable sessions, scanning, upload authorization/routes and lab-report
work remain. Production composition still selects the existing disk adapter;
no bucket, provider credentials or deployment settings were changed.

## Resumable private-disk storage (2026-10-15)

The separate proxied-upload port and disk implementation now persist immutable
session definitions and content-addressed part receipts under the private storage
root. Session recreation and identical-part retries are idempotent. A replacement
part preserves earlier receipt bytes, so an accepted database receipt cannot be
changed by a competing retry. Part sizes, checksums, exact ordered coverage, full
file integrity and expiry are checked before the immutable object is published.
A matching existing object recovers a lost finalize response without overwriting.
Aborting removes session parts only; published objects remain intact.

Storage metadata is server-owned and does not authorize a patient or tenant.
The application must serialize finalize/abort using durable session transitions.
HTTP routes, upload tables, scan jobs and retention cleanup are not enabled yet.
S3 multipart/direct targets remain separate work. This is partial DOC-003/005
foundation, not completion of their acceptance criteria.

## Baseline scanner foundation (2026-10-17)

The scan port, deterministic mock and baseline content-policy adapter are now
implemented. Input bytes are streamed into a private temporary file with size
and SHA-256 verification. A separate parser process has a deadline, a V8 heap
limit, bounded output and no inherited application credentials. This is a
resource boundary, not an operating-system security sandbox.

The baseline sniffs the actual type, checks configured category limits, parses
PDF structure (including compressed objects and escaped names), refuses encrypted
PDFs, active content/attachments and excess pages, and preserves accepted PDF
bytes. JPEG/PNG/WebP images are decoded and re-encoded without EXIF/XMP/ICC
metadata into the next revision of the same document. Animated images are
rejected; the original remains until a future durable scan job commits the new
revision. Retry recovery accepts only an identical existing sanitized object.

The adapter reports that it does not detect known malware or exploits in valid
files. No raw audio, Office, reduced-assurance mode, upload endpoint or scan job
is enabled. HOST-002 still needs the image-library probe on the production host.
See IMAGE-SCANNER-DEPENDENCIES.md for pinned versions and retained notices.

## Durable upload records and finalize claims (2026-10-17)

Incremental migration 0026 adds tenant-bound upload sessions and selected part
receipts without changing the applied 0010 document migration. Sessions record
the owner, generated key, expected size/hash, expiry, target revision and a
bounded finalize lease. A short transaction locks the session before selecting
a content-addressed part receipt. Finalize claims lock the same row, check exact
ordered coverage, and bind lease recovery to the receipt-set hash. No database
transaction spans file I/O. MariaDB 10.6 and 11.8 schema/claim checks cover
constraints, tenant links, single-claim behavior and lease recovery.

There is still no upload HTTP route or scan-result commit. The durable claim
functions are internal groundwork; completion, abort, cleanup, authorization,
quota and scan-job transitions remain before uploads can be enabled.
