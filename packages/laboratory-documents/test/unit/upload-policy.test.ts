import { describe, expect, it } from 'vitest';
import {
  UPLOAD_CATEGORY_POLICY,
  UPLOAD_PART_SIZE_BYTES,
  validateUploadRequest,
} from '../../src/application/upload-policy';

const sha256 = 'a'.repeat(64);
const base = { category: 'LAB_REPORT', contentType: 'application/pdf', sizeBytes: 1, sha256 };

describe('upload admission policy', () => {
  it.each(Object.entries(UPLOAD_CATEGORY_POLICY))(
    'admits the declared types within %s limits',
    (category, rule) => {
      for (const contentType of rule.contentTypes) {
        const accepted = validateUploadRequest({ ...base, category, contentType, sizeBytes: rule.maxBytes });
        expect(accepted.category).toBe(category);
        expect(accepted.partCount).toBe(Math.ceil(rule.maxBytes / UPLOAD_PART_SIZE_BYTES));
        expect(accepted.partSizeBytes).toBe(UPLOAD_PART_SIZE_BYTES);
      }
      expect(() => validateUploadRequest({ ...base, category, sizeBytes: rule.maxBytes + 1 })).toThrow();
    },
  );

  it('refuses generated-only categories, wrong formats, invalid sizes and checksums', () => {
    for (const category of ['PRESCRIPTION_PDF', 'AI_RAW', 'IMAGE', '__proto__']) {
      const request = { ...base, category };
      if (category === 'IMAGE') request.contentType = 'application/pdf';
      expect(() => validateUploadRequest(request)).toThrow();
    }
    for (const sizeBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => validateUploadRequest({ ...base, sizeBytes })).toThrow();
    for (const checksum of [sha256.toUpperCase(), 'f'.repeat(63), 'g'.repeat(64)])
      expect(() => validateUploadRequest({ ...base, sha256: checksum })).toThrow();
  });

  it('normalizes a display name and rejects controls and paths', () => {
    expect(validateUploadRequest({ ...base, fileName: '  রিপোর্ট.pdf  ' }).title).toBe('রিপোর্ট.pdf');
    for (const fileName of ['', '../record.pdf', 'C:\\record.pdf', 'bad\u0000name', '.'])
      expect(() => validateUploadRequest({ ...base, fileName })).toThrow();
  });
});
