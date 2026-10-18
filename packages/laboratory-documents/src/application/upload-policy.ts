import type { UploadScanCategory } from './malware-scan-port';
import { UploadStorageError, UPLOAD_SHA256 } from './upload-storage-port';

export const UPLOAD_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000;

const MiB = 1024 * 1024;
export const UPLOAD_CATEGORY_POLICY: Readonly<
  Record<UploadScanCategory, { maxBytes: number; contentTypes: readonly string[] }>
> = {
  LAB_REPORT: {
    maxBytes: 20 * MiB,
    contentTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  },
  IMAGE: { maxBytes: 10 * MiB, contentTypes: ['image/jpeg', 'image/png', 'image/webp'] },
  REFERRAL: { maxBytes: 20 * MiB, contentTypes: ['application/pdf', 'image/jpeg', 'image/png'] },
  OTHER: { maxBytes: 20 * MiB, contentTypes: ['application/pdf', 'image/jpeg', 'image/png'] },
};

export interface UploadRequestDetails {
  category: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  fileName?: string | undefined;
}

export interface ValidatedUploadRequest extends Omit<UploadRequestDetails, 'category' | 'fileName'> {
  category: UploadScanCategory;
  title: string | null;
  partSizeBytes: number;
  partCount: number;
}

/** Category policy is a ceiling; the scanner still verifies the actual bytes after finalize. */
export function validateUploadRequest(input: UploadRequestDetails): ValidatedUploadRequest {
  if (!Object.prototype.hasOwnProperty.call(UPLOAD_CATEGORY_POLICY, input.category))
    throw new UploadStorageError('UPLOAD_INVALID', 'Upload category is not allowed');
  const category = input.category as UploadScanCategory;
  const policy = UPLOAD_CATEGORY_POLICY[category];
  if (!policy.contentTypes.includes(input.contentType))
    throw new UploadStorageError('UPLOAD_INVALID', 'Upload content type is not allowed');
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > policy.maxBytes)
    throw new UploadStorageError('UPLOAD_INVALID', 'Upload size is not allowed');
  if (!UPLOAD_SHA256.test(input.sha256))
    throw new UploadStorageError('UPLOAD_INVALID', 'Upload checksum is invalid');
  let title: string | null = null;
  if (input.fileName !== undefined) {
    if (typeof input.fileName !== 'string')
      throw new UploadStorageError('UPLOAD_INVALID', 'Upload file name is invalid');
    title = input.fileName.normalize('NFC').trim();
    if (
      title.length < 1 ||
      title.length > 200 ||
      /[\u0000-\u001f\u007f\\/]/u.test(title) ||
      title === '.' ||
      title === '..'
    )
      throw new UploadStorageError('UPLOAD_INVALID', 'Upload file name is invalid');
  }
  return {
    category,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    title,
    partSizeBytes: UPLOAD_PART_SIZE_BYTES,
    partCount: Math.ceil(input.sizeBytes / UPLOAD_PART_SIZE_BYTES),
  };
}
