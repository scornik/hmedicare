// Public surface of the laboratory-documents context (REPOSITORY-STRUCTURE.md §2.2).
export {
  UPLOAD_SCAN_CATEGORIES,
  type UploadScanCategory,
  type ScanReason,
  type ScanVerdict,
  type ScanInput,
  type MalwareScanPort,
} from '../application/malware-scan-port';
export {
  type UploadStorageSession,
  type UploadPartReceipt,
  type ProxiedUploadStoragePort,
  UploadStorageError,
  UPLOAD_SHA256,
  assertUploadSession,
  assertUploadParts,
  uploadPartSize,
} from '../application/upload-storage-port';
export {
  UPLOAD_CATEGORY_POLICY,
  UPLOAD_PART_SIZE_BYTES,
  UPLOAD_SESSION_TTL_MS,
  type UploadRequestDetails,
  type ValidatedUploadRequest,
  validateUploadRequest,
} from '../application/upload-policy';
export {
  type CreateUploadInput,
  type CreatedUploadSession,
  type OwnedUploadIdentity,
  type UploadPatientScope,
  UploadSessionService,
} from '../infrastructure/upload-sessions';
export {
  abortUploadRecord,
  expireUploadSession,
  sweepUploadCleanup,
  claimUploadFinalize,
  recordUploadPart,
  type FinalizeClaim,
} from '../infrastructure/upload-records';
export {
  SCAN_UPLOADED_DOCUMENT,
  registerUploadScanJobType,
  commitUploadFinalize,
  finalizeUpload,
} from '../infrastructure/upload-finalize';
export {
  processUploadScan,
  registerUploadScanJobs,
  type UploadScanIdentity,
} from '../infrastructure/upload-scan';
export {
  CLEANUP_UPLOAD_SESSIONS,
  runUploadCleanup,
  registerUploadCleanupJobs,
} from '../infrastructure/upload-cleanup-jobs';
export {
  DISK_USAGE_CHECK,
  storageRootBytes,
  collectDiskUsage,
  assessDiskUsage,
  registerDiskUsageJobs,
} from '../infrastructure/disk-usage-jobs';
export {
  type ObjectReadOptions,
  ObjectStorageError,
  type ObjectStoragePort,
  type StoredObject,
} from '../application/object-storage-port';
export {
  type DocumentDescriptor,
  type DocumentDownloadDeps,
  DocumentDownloadService,
  safeFileName,
} from '../infrastructure/document-download';
export {
  DOWNLOAD_TOKEN_USED,
  type DownloadTokenClaims,
  type DownloadTokenDeps,
  DownloadTokenService,
} from '../infrastructure/download-tokens';
export {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
  STORAGE_KEY_RE,
  StorageKeyError,
  assertStorageKey,
  buildStorageKey,
  categorySegment,
} from '../domain/storage-keys';
export { DocumentHistoryMetadata } from '../infrastructure/history-metadata';
export {
  LabReportService,
  type CreateLabReportInput,
  type AddLabResultInput,
} from '../infrastructure/lab-reports';
