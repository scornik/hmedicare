import type { Readable } from 'node:stream';

/**
 * `ObjectStoragePort` (ADR-016, FILE-STORAGE-IMPLEMENTATION.md §1).
 *
 * The seam between this system and wherever bytes live. Two adapters are planned: `disk`, which is what
 * the current hosting can run, and `s3`, which waits for a provider decision.
 *
 * **Scope.** This is the generated-document half of the port: put an object the server produced, read
 * it back, delete it. The multipart upload session — `createUploadSession`, part targets, `finalize` —
 * belongs to the client upload path and arrives with the routes that drive it. Declaring those methods
 * now would mean two adapters stubbing them, and a stub that throws is indistinguishable from a feature
 * until someone calls it in production.
 *
 * Every method takes a key built by `buildStorageKey`, and every adapter re-validates it. The port is
 * not a trust boundary on its own; the validation is.
 */
export interface StoredObject {
  key: string;
  sizeBytes: number;
  /** SHA-256 of the bytes as stored, computed while writing rather than read back afterwards. */
  sha256: string;
}

export interface ObjectReadOptions {
  /** Inclusive byte range, as an HTTP range request would give it. */
  range?: { start: number; end?: number };
}

export class ObjectStorageError extends Error {
  constructor(
    readonly code:
      | 'OBJECT_NOT_FOUND'
      | 'OBJECT_ALREADY_EXISTS'
      | 'STORAGE_KEY_INVALID'
      | 'STORAGE_ROOT_INVALID'
      | 'STORAGE_IO_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'ObjectStorageError';
  }
}

export interface ObjectStoragePort {
  /** `disk` or `s3`, recorded on every `document_versions` row so old objects stay readable. */
  readonly adapter: 'disk' | 's3';

  /**
   * Writes an object the server generated, and refuses to overwrite one.
   *
   * Refusing is the point: a key contains the document id and the revision, so a second write to the
   * same key means something is re-rendering over bytes a patient may already hold. A correction is a
   * new revision with a new key.
   */
  put(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject>;

  /** Streams an object. Throws `OBJECT_NOT_FOUND` rather than returning an empty stream. */
  get(key: string, options?: ObjectReadOptions): Promise<{ stream: Readable; sizeBytes: number }>;

  /** Size and checksum without the bytes. */
  head(key: string): Promise<StoredObject>;

  /** Deletes an object. Succeeds when it is already gone, so cleanup is idempotent. */
  delete(key: string): Promise<void>;
}
