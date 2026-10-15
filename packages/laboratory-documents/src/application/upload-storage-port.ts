import type { Readable } from 'node:stream';
import { isUuid } from '@hmedic/kernel';
import { assertStorageKey } from '../domain/storage-keys';
import type { StoredObject } from './object-storage-port';

/** Server-owned session data; never accept this descriptor directly from an HTTP client. */
export interface UploadStorageSession {
  sessionId: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  partSizeBytes: number;
  expiresAt: Date;
}

/** Immutable receipt: replacing a part must not change bytes referenced by an earlier receipt. */
export interface UploadPartReceipt {
  partNumber: number;
  sizeBytes: number;
  sha256: string;
}

export class UploadStorageError extends Error {
  constructor(
    readonly code:
      | 'UPLOAD_INVALID'
      | 'UPLOAD_EXPIRED'
      | 'UPLOAD_NOT_FOUND'
      | 'UPLOAD_CONFLICT'
      | 'UPLOAD_PARTS_INVALID'
      | 'UPLOAD_CHECKSUM_MISMATCH'
      | 'UPLOAD_IO_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'UploadStorageError';
  }
}

export const UPLOAD_SHA256 = /^[a-f0-9]{64}$/;

/** Bounds independent of category policy, which the authorized application service must enforce. */
export function assertUploadSession(session: UploadStorageSession): void {
  assertStorageKey(session.key);
  if (
    !isUuid(session.sessionId) ||
    !Number.isSafeInteger(session.sizeBytes) ||
    session.sizeBytes < 1 ||
    session.sizeBytes > 200 * 1024 * 1024 ||
    !Number.isSafeInteger(session.partSizeBytes) ||
    session.partSizeBytes < 1 ||
    session.partSizeBytes > 8 * 1024 * 1024 ||
    Math.ceil(session.sizeBytes / session.partSizeBytes) > 10_000 ||
    !UPLOAD_SHA256.test(session.sha256) ||
    !Number.isFinite(session.expiresAt.getTime()) ||
    !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(session.contentType)
  )
    throw new UploadStorageError('UPLOAD_INVALID', 'Invalid upload session');
}

export function uploadPartSize(session: UploadStorageSession, partNumber: number): number {
  assertUploadSession(session);
  const count = Math.ceil(session.sizeBytes / session.partSizeBytes);
  if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > count)
    throw new UploadStorageError('UPLOAD_PARTS_INVALID', 'Invalid upload part number');
  return Math.min(session.partSizeBytes, session.sizeBytes - (partNumber - 1) * session.partSizeBytes);
}

/** Exact ordered coverage: duplicates, omissions and reordered receipts are refused. */
export function assertUploadParts(session: UploadStorageSession, parts: readonly UploadPartReceipt[]): void {
  assertUploadSession(session);
  if (
    parts.length !== Math.ceil(session.sizeBytes / session.partSizeBytes) ||
    parts.some(
      (part, index) =>
        part.partNumber !== index + 1 ||
        part.sizeBytes !== uploadPartSize(session, index + 1) ||
        !UPLOAD_SHA256.test(part.sha256),
    )
  )
    throw new UploadStorageError('UPLOAD_PARTS_INVALID', 'Upload parts do not cover the complete file');
}

/** Proxied resumable storage; authorization, DB state and scan scheduling belong to the application. */
export interface ProxiedUploadStoragePort {
  createUploadSession(session: UploadStorageSession): Promise<void>;
  uploadPart(
    session: UploadStorageSession,
    partNumber: number,
    body: Buffer | Readable,
    sha256: string,
  ): Promise<UploadPartReceipt>;
  completeUpload(session: UploadStorageSession, parts: readonly UploadPartReceipt[]): Promise<StoredObject>;
  abortUpload(session: UploadStorageSession): Promise<void>;
}
