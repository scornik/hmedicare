// Public surface of the laboratory-documents context (REPOSITORY-STRUCTURE.md §2.2).
export {
  type ObjectReadOptions,
  ObjectStorageError,
  type ObjectStoragePort,
  type StoredObject,
} from '../application/object-storage-port';
export {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
  STORAGE_KEY_RE,
  StorageKeyError,
  assertStorageKey,
  buildStorageKey,
  categorySegment,
} from '../domain/storage-keys';
