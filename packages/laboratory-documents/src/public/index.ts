// Public surface of the laboratory-documents context (REPOSITORY-STRUCTURE.md §2.2).
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
