# ADR-016 — Object storage and malware scanning on Hostinger

**Status:** Accepted (Stage 3.1, 2026-09-17)
**Refines:** ADR-009 (object storage for files). ADR-009's principle stands: binaries live outside the relational store, with metadata, checksum and version in the database, private access only, and authorization before every read. What changes is where binaries live in production and how they are scanned.
**Related:** ADR-013 (Hostinger hosting), ADR-015 (job queue), ADR-017 (AI raw-output storage).

## Context

- Hostinger Cloud Startup provides no S3-compatible object storage service (see `docs/implementation/HOSTING-VERIFICATION.md`, HOST-007).
- Disk is 100 GB NVMe, **shared** by every site and app on the plan.
- There is no ClamAV or custom system packages, so the Stage 3 "worker scans malware" assumption cannot be met on the host.
- Files include lab reports, prescription PDFs, images, and in V1+ audio. They contain PHI and must survive redeploys, be backed up, and never be publicly reachable.

## Decision

### 1. `ObjectStoragePort` with two production-capable adapters

```ts
interface ObjectStoragePort {
  createUploadSession(input: { key: ObjectKey; contentType: string; sizeBytes: number; sha256: string; partSizeBytes: number; expiresAt: Date }): Promise<UploadSession>;
  uploadPart(input: { sessionId: string; partNumber: number; body: ReadableStream | Buffer; contentSha256: string }): Promise<PartReceipt>; // used by API-proxied adapters
  getPartUploadTargets?(input: { sessionId: string; partNumbers: number[] }): Promise<PresignedPart[]>;        // direct-to-bucket adapters only
  completeUpload(input: { sessionId: string; parts: PartReceipt[] }): Promise<StoredObjectMeta>;
  abortUpload(input: { sessionId: string }): Promise<void>;
  head(key: ObjectKey): Promise<StoredObjectMeta | null>;
  openReadStream(key: ObjectKey, range?: ByteRange): Promise<ReadableStream>;
  createSignedDownload?(key: ObjectKey, ttlSeconds: number, disposition: ContentDisposition): Promise<SignedUrl>; // S3 only
  delete(key: ObjectKey): Promise<void>;
  capabilities(): { directClientUpload: boolean; signedDownloadUrls: boolean; serverSideEncryption: boolean };
}
```

- **Object keys** are opaque and follow `t/<tenantId>/<category>/<uuidv7>/<version>`. A key never contains names, phone numbers or file names. The original file name is stored as encrypted metadata in the database only if the category policy needs it.
- **`S3CompatibleAdapter`** is the preferred production target.
  - It uses a private bucket with block-public-access, bucket policy deny-list, and server-side encryption if the provider offers it.
  - Clients upload directly with presigned multipart part URLs; `getPartUploadTargets` returns URLs valid for at most 15 minutes.
  - Downloads use short-lived presigned GET URLs (default 60 s) issued only after API authorization.
  - The storage provider is an **external decision** (research register). Candidates to evaluate, with none selected: Cloudflare R2, Backblaze B2 (S3 API), Wasabi, DigitalOcean Spaces, AWS S3 (e.g. `ap-south-1`/`ap-southeast-1`), and Hostinger VPS running a self-managed S3-compatible server. Criteria:
    - region latency to Bangladesh;
    - data-processing terms;
    - encryption;
    - egress cost;
    - lifecycle rules;
    - presigned multipart support.
- **`PrivateDiskAdapter`** is allowed in staging and production **only if HOST-007 verifies a persistent, non-public directory** that survives redeploys (e.g. `~/hmedic-storage/<env>/`, outside every document root and outside the app's deploy directory). Its rules:
  - `STORAGE_DISK_ROOT` must be an absolute path. At startup the API verifies that it exists, is writable, and is not inside any configured public root; if any check fails, startup is refused.
  - **No direct URLs.** Downloads stream through `GET /documents/{id}/download?token=…`. The token is a short-lived (default 60 s), single-object, single-version HMAC-signed token bound to tenant, actor and document version, issued by `POST /documents/{id}/download-token` after authorization. The streaming endpoint re-checks the token, sets `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`.
  - **Uploads are chunked and resumable through the API.** `PUT /documents/upload-sessions/{id}/parts/{n}` stores each chunk as `<root>/.uploads/<sessionId>/<n>.part` with a per-part SHA-256. Finalize concatenates the parts in order into `<root>/objects/<key>`, verifies total size and full-file SHA-256, `fsync`s, then atomically renames into place.
  - **Path safety.** Keys are validated against `^[a-z0-9/_-]+$`, resolved with `path.resolve`, and rejected unless the resolved path starts with the root. Symlinks inside the root are refused (`lstat`).
  - **Checksums** are verified on finalize and before every scan. A mismatch returns `CHECKSUM_MISMATCH`.
  - **Backups include the storage root** (see `docs/implementation/DEPLOYMENT.md` §Backups).
  - **Disk-usage alert.** A maintenance job measures storage-root bytes and filesystem free space. It alerts at 60% (warning) and 75% (critical) of the configured storage budget (`STORAGE_DISK_BUDGET_GB`, default 40 GB of the 100 GB shared quota). It also alerts when total plan disk usage passes 80%. Crossing critical is a documented migration signal to the S3 adapter (ADR-013).
- **Adapter selection** is set by `STORAGE_ADAPTER=s3|disk`. Every environment picks exactly one, and a migration job (`MigrateObjectsBetweenAdapters`) copies objects and verifies checksums before the flag flips.
- **Local development** uses MinIO in Docker Compose for the S3 adapter and a temp directory for the disk adapter.
  - **Both adapters pass one shared contract test suite:**
    - multipart resume;
    - checksum mismatch;
    - abort;
    - range read;
    - path traversal (disk);
    - expired session;
    - delete;
    - capability flags.
  - MinIO is **local and CI only**, never production.

### 2. Upload state and scanning

```text
CREATED -> UPLOADING -> UPLOADED -> SCANNING -> AVAILABLE
CREATED/UPLOADING -> EXPIRED
UPLOADED/SCANNING -> REJECTED
SCANNING -> SCAN_ERROR -> SCANNING (retry) | REJECTED (after max attempts)
```

- A file is readable by non-uploader roles only in `AVAILABLE`. The uploader can see its own `UPLOADED`/`SCANNING` status but cannot download it.
- **`MalwareScanPort`**:
  ```ts
  interface MalwareScanPort {
    scan(input: { key: ObjectKey; declaredContentType: string; sizeBytes: number; category: DocumentCategory }): Promise<ScanVerdict>;
    describe(): { adapter: string; detectsKnownMalware: boolean; limits: string[] };
  }
  type ScanVerdict = { result: 'CLEAN' | 'REJECTED' | 'ERROR'; reasonCode?: ScanReason; sanitizedKey?: ObjectKey };
  ```
- **Adapters:**
  1. **`MockMalwareScanner`** (local/CI): deterministic results keyed by fixture names.
  2. **`BaselineContentPolicyScanner`** (default for staging/production until an external scanner is selected):
     - **Allowlist per category:** PDF, JPEG, PNG and WebP for documents and lab reports. V1 audio: `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`.
     - **Magic-byte sniffing** (e.g. `file-type`) must match the declared and allowed type.
     - **Per-category size limit** from configuration.
     - **Images are fully decoded and re-encoded** (e.g. `sharp`, a prebuilt binary that must run on the host; HOST-002). Metadata (EXIF/GPS) is stripped, and the re-encoded file replaces the original as a new `document_versions` row, with the original deleted after success.
     - **PDFs** are structurally parsed (e.g. `pdf-lib` load) and rejected if they are encrypted, fail to parse, contain `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile` or `/OpenAction`-to-JavaScript, or exceed the configured page limit. PDFs are **not** rewritten, so the raw report stays authoritative.
     - **Honest limits** (recorded in `describe()` and shown in admin docs):
       - it does **not** detect known malware signatures;
       - it does not detect exploits in otherwise well-formed PDFs;
       - it does not inspect macros in non-allowed Office types, because those types are rejected outright;
       - it does not protect a user who downloads and opens a crafted PDF in a vulnerable reader.
       Downloads are served as attachments with `nosniff` to reduce browser-side risk.
  3. **`ExternalScanServiceAdapter`** (Future): an HTTP scanning service behind the port, with provider selection and data-processing review in the research register.
- **Scanning runs as a job** (`ScanDocumentVersion`, queue `documents`). Documents stay `SCANNING` until the configured scanner returns. `ERROR` retries with backoff; after `max_attempts` the result is `REJECTED` with `SCAN_UNAVAILABLE`, and the uploader sees a retry-upload message.

### 3. Other uses of storage

- **Prescription PDFs:** rendered by a worker, stored via the port, not scanned (generated internally), checksummed.
- **AI raw provider output** (ADR-017): stored under category `ai-raw`, never shown to patients, readable only through audit roles, with per-tenant retention.
- **Backups:** encrypted dumps go to a *separate* off-site destination behind `BackupDestinationPort`, never into the same storage root (see `DEPLOYMENT.md`).

## Alternatives considered

| Alternative | Why not |
|---|---|
| Public web-root folder with obscure names | Violates private-access and authorization-before-read rules. |
| Database BLOBs | Bloats backups and the connection budget; rejected in ADR-009. |
| ClamAV on the host | No system packages or daemon on the plan. Possible on a VPS later, as an `ExternalScanServiceAdapter`-like local adapter. |
| Only S3 from day one | Requires an external storage decision before Foundation. The port plus disk adapter keeps Stage 4 unblocked while the decision is researched. |

## Consequences

- API-proxied disk uploads and downloads consume API memory, CPU and bandwidth. The streaming implementation must never buffer whole files in memory. Chunk size defaults to 5 MiB and is capped at 8 MiB, and memory tests are required.
- The disk adapter keeps PHI on the same plan as the application. Plan backups plus off-site encrypted file backups are mandatory, and disk budget is a migration trigger.
- The baseline scanner reduces but does not eliminate malicious-file risk. That limitation is recorded as an accepted risk until an external scanner is selected.
- Switching adapters is operational (copy, verify, flip flag) and needs no schema or API change.

## Verification gates

- HOST-007: a persistent, non-public, redeploy-surviving directory exists (required for `PrivateDiskAdapter`).
- HOST-010: backup inclusion of that directory and downloadable backups.
- HOST-002: native image library (`sharp` prebuilt binary) loads on the host. Fallback: the image re-encode step is disabled, JPEG/PNG/WebP are accepted after magic-byte and size checks only, and this is recorded as a reduced-assurance mode in `describe()`.
