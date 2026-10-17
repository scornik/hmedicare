import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildStorageKey,
  UPLOAD_SCAN_CATEGORIES,
  type ScanInput,
  type UploadScanCategory,
} from '@hmedic/laboratory-documents';
import { DiskObjectStorage } from '@hmedic/storage-adapters-disk';
import { BaselineContentPolicyScanner, type ContentScanLimits } from '../../src/index';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture(
  bytes: Buffer,
  declaredContentType = 'application/pdf',
  overrides: Partial<ContentScanLimits> = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'hmedic-scan-fixture-'));
  roots.push(root);
  const storage = new DiskObjectStorage({ root });
  const base = { tenantId: randomUUID(), documentId: randomUUID(), category: 'LAB_REPORT' as const };
  const key = buildStorageKey({ ...base, revision: 1 });
  const input: ScanInput = {
    key,
    declaredContentType,
    sizeBytes: bytes.length,
    sha256: hash(bytes),
    category: 'LAB_REPORT',
    sanitizedKey: buildStorageKey({ ...base, revision: 2 }),
  };
  await storage.put(key, bytes, declaredContentType);
  const policy: ContentScanLimits = {
    maxBytes: 2 * 1024 * 1024,
    maxPdfPages: 3,
    maxImagePixels: 100_000,
    allowedTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
    ...overrides,
  };
  const limits = Object.fromEntries(UPLOAD_SCAN_CATEGORIES.map((category) => [category, policy])) as Record<
    UploadScanCategory,
    ContentScanLimits
  >;
  const scanner = new BaselineContentPolicyScanner({ storage, limits });
  return { storage, scanner, input, bytes, policy };
}
async function pdf(pages = 1) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index++) document.addPage([100, 100]);
  return Buffer.from(await document.save());
}
async function read(storage: DiskObjectStorage, key: string) {
  const { stream } = await storage.get(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('baseline document policy in an isolated parser process', () => {
  it('accepts a PDF without rewriting the authoritative bytes', async () => {
    const f = await fixture(await pdf());
    expect(await f.scanner.scan(f.input)).toEqual({ result: 'CLEAN' });
    expect(await read(f.storage, f.input.key)).toEqual(f.bytes);
    expect(f.scanner.describe().detectsKnownMalware).toBe(false);
    expect(f.scanner.describe().limits.join(' ')).toContain('not an operating-system security sandbox');
  });
  it('rejects MIME spoofing, unknown types, corrupt PDFs and excess pages', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    const spoofed = await fixture(png);
    expect(await spoofed.scanner.scan(spoofed.input)).toMatchObject({
      result: 'REJECTED',
      reasonCode: 'TYPE_MISMATCH',
    });
    const unknown = await fixture(Buffer.from('an office document is not a PDF'));
    expect(await unknown.scanner.scan(unknown.input)).toMatchObject({
      result: 'REJECTED',
      reasonCode: 'TYPE_NOT_ALLOWED',
    });
    const broken = await fixture(Buffer.from('%PDF-1.7\nbroken bytes\n%%EOF'));
    expect(await broken.scanner.scan(broken.input)).toMatchObject({
      result: 'REJECTED',
      reasonCode: 'INVALID_PDF',
    });
    const tooMany = await fixture(await pdf(4));
    expect(await tooMany.scanner.scan(tooMany.input)).toMatchObject({
      result: 'REJECTED',
      reasonCode: 'PDF_PAGE_LIMIT',
    });
  }, 20_000);
  it.each(['JavaScript', 'Launch', 'EmbeddedFile'])(
    'rejects %s inside parsed compressed PDF objects',
    async (name) => {
      const document = await PDFDocument.create();
      document.addPage();
      const action = document.context.register(
        document.context.obj({ S: PDFName.of(name), F: PDFString.of('synthetic fixture') }),
      );
      document.catalog.set(PDFName.of('OpenAction'), action);
      const f = await fixture(Buffer.from(await document.save({ useObjectStreams: true })));
      expect(await f.scanner.scan(f.input)).toMatchObject({
        result: 'REJECTED',
        reasonCode: 'ACTIVE_PDF_CONTENT',
      });
    },
  );
  it('recognizes escaped PDF names rather than relying on a raw text search', async () => {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
      '<< /S /Java#53cript /J#53 (synthetic fixture) >>',
    ];
    let text = '%PDF-1.7\n';
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
      offsets.push(Buffer.byteLength(text));
      text += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(text);
    text += `xref\n0 5\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const f = await fixture(Buffer.from(text));
    expect(await f.scanner.scan(f.input)).toMatchObject({
      result: 'REJECTED',
      reasonCode: 'ACTIVE_PDF_CONTENT',
    });
  });
  it('rejects attachments even when the embedded stream omits its optional Type name', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    const stream = document.context.register(
      document.context.flateStream(Buffer.from('synthetic attachment')),
    );
    const file = document.context.register(
      document.context.obj({ F: PDFString.of('synthetic.txt'), EF: document.context.obj({ F: stream }) }),
    );
    document.catalog.set(
      PDFName.of('Names'),
      document.context.obj({
        EmbeddedFiles: document.context.obj({
          Names: document.context.obj([PDFString.of('synthetic.txt'), file]),
        }),
      }),
    );
    const f = await fixture(Buffer.from(await document.save()));
    expect(await f.scanner.scan(f.input)).toMatchObject({
      result: 'REJECTED',
      reasonCode: 'ACTIVE_PDF_CONTENT',
    });
  });
  it('rejects an encrypted PDF declaration and permits harmless strings mentioning JavaScript', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    document.context.trailerInfo.Encrypt = document.context.register(
      document.context.obj({
        Filter: 'Standard',
        V: 1,
        R: 2,
        O: PDFHexString.of('0'.repeat(64)),
        U: PDFHexString.of('0'.repeat(64)),
        P: -4,
      }),
    );
    const encrypted = await fixture(Buffer.from(await document.save({ useObjectStreams: false })));
    expect(await encrypted.scanner.scan(encrypted.input)).toMatchObject({
      result: 'REJECTED',
      reasonCode: 'ENCRYPTED_PDF',
    });
    const benign = await PDFDocument.create();
    benign.addPage();
    benign.setTitle('A textbook mentions /JavaScript and /JS as plain text');
    const f = await fixture(Buffer.from(await benign.save()));
    expect(await f.scanner.scan(f.input)).toEqual({ result: 'CLEAN' });
  }, 15_000);
  it.each(['jpeg', 'png', 'webp'] as const)(
    're-encodes %s without metadata, keeps the original and recovers retries',
    async (format) => {
      const bytes = await sharp({ create: { width: 8, height: 5, channels: 3, background: 'blue' } })
        .withExif({
          IFD0: { Artist: 'Synthetic private metadata' },
          IFD2: { UserComment: 'Synthetic GPS-like data' },
        })
        .toFormat(format)
        .toBuffer();
      const original = await sharp(bytes).metadata();
      expect(original.exif).toBeDefined();
      const f = await fixture(bytes, `image/${format}`);
      const verdict = await f.scanner.scan(f.input);
      expect(verdict.result).toBe('CLEAN');
      if (verdict.result !== 'CLEAN' || !verdict.sanitized) throw new Error('No sanitized revision');
      expect(verdict.sanitized.key).toBe(f.input.sanitizedKey);
      const clean = await read(f.storage, verdict.sanitized.key);
      expect(hash(clean)).toBe(verdict.sanitized.sha256);
      const metadata = await sharp(clean).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect([metadata.width, metadata.height]).toEqual([8, 5]);
      expect(await read(f.storage, f.input.key)).toEqual(bytes);
      expect(await f.scanner.scan(f.input)).toEqual(verdict);
    },
    15_000,
  );
  it('checks size, checksum, category and derived-key binding before accepting content', async () => {
    const f = await fixture(await pdf());
    expect(await f.scanner.scan({ ...f.input, sizeBytes: 3 * 1024 * 1024 })).toMatchObject({
      reasonCode: 'SIZE_LIMIT',
    });
    expect(await f.scanner.scan({ ...f.input, sha256: '0'.repeat(64) })).toMatchObject({
      reasonCode: 'CHECKSUM_MISMATCH',
    });
    expect(await f.scanner.scan({ ...f.input, category: 'IMAGE' })).toMatchObject({ result: 'ERROR' });
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } })
      .png()
      .toBuffer();
    const image = await fixture(bytes, 'image/png');
    expect(await image.scanner.scan({ ...image.input, sanitizedKey: image.input.key })).toMatchObject({
      result: 'ERROR',
    });
    const other = buildStorageKey({
      tenantId: randomUUID(),
      documentId: randomUUID(),
      category: 'LAB_REPORT',
      revision: 2,
    });
    expect(await image.scanner.scan({ ...image.input, sanitizedKey: other })).toMatchObject({
      result: 'ERROR',
    });
  });
  it('enforces the image pixel cap and snapshots category policy', async () => {
    const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'blue' } })
      .png()
      .toBuffer();
    const f = await fixture(bytes, 'image/png', { maxImagePixels: 100 });
    f.policy.maxImagePixels = 1000;
    expect(await f.scanner.scan(f.input)).toMatchObject({
      result: 'REJECTED',
      reasonCode: 'IMAGE_PIXEL_LIMIT',
    });
  });
  it('rejects animated and malformed images rather than silently dropping frames', async () => {
    const bytes = await sharp(Buffer.concat([Buffer.alloc(4 * 4 * 3, 0), Buffer.alloc(4 * 4 * 3, 255)]), {
      raw: { width: 4, height: 8, pageHeight: 4, channels: 3 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(bytes).metadata()).pages).toBe(2);
    const f = await fixture(bytes, 'image/webp');
    expect(await f.scanner.scan(f.input)).toMatchObject({ result: 'REJECTED', reasonCode: 'ANIMATED_IMAGE' });
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    const broken = await fixture(png.subarray(0, 40), 'image/png');
    expect(await broken.scanner.scan(broken.input)).toMatchObject({
      result: 'REJECTED',
      reasonCode: 'INVALID_IMAGE',
    });
  }, 15_000);
});
