// Private process entry point. Never import this file into the API process.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  type PDFObject,
} from 'pdf-lib';
import sharp from 'sharp';
import type { ScanReason } from '@hmedic/laboratory-documents';

type Verdict =
  | { result: 'CLEAN'; sanitized: boolean }
  | { result: 'REJECTED'; reasonCode: ScanReason }
  | { result: 'ERROR'; reasonCode: 'SCAN_UNAVAILABLE' };
const reject = (reasonCode: ScanReason): Verdict => ({ result: 'REJECTED', reasonCode });

async function inspect(): Promise<Verdict> {
  const [directory, declared, pixels, pages] = process.argv.slice(2);
  if (!directory || !declared || !pixels || !pages) throw new Error('Missing scan configuration');
  const input = path.join(directory, 'input');
  const { fileTypeFromFile } = await import('file-type');
  const type = await fileTypeFromFile(input);
  if (!type || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(type.mime))
    return reject('TYPE_NOT_ALLOWED');
  if (type.mime !== declared) return reject('TYPE_MISMATCH');
  if (type.mime === 'application/pdf') {
    try {
      const pdf = await PDFDocument.load(await readFile(input), {
        updateMetadata: false,
        throwOnInvalidObject: true,
      });
      if (pdf.isEncrypted || pdf.context.trailerInfo.Encrypt) return reject('ENCRYPTED_PDF');
      if (pdf.getPageCount() < 1) return reject('INVALID_PDF');
      if (pdf.getPageCount() > Number(pages)) return reject('PDF_PAGE_LIMIT');
      // Parsed names include escaped names and dictionaries inside compressed object streams.
      // Inspect all indirect objects, not just reachable catalog actions.
      const blocked = new Set([
        'JS',
        'JavaScript',
        'Launch',
        'EmbeddedFile',
        'EmbeddedFiles',
        'Filespec',
        'EF',
        'FileAttachment',
        'RichMedia',
        'XFA',
      ]);
      const stack: PDFObject[] = pdf.context.enumerateIndirectObjects().map(([, object]) => object);
      const seen = new Set<PDFObject>();
      let visited = 0;
      while (stack.length) {
        const object = stack.pop()!;
        if (seen.has(object)) continue;
        seen.add(object);
        if (++visited > 100_000) return reject('INVALID_PDF');
        if (object instanceof PDFName && blocked.has(object.decodeText()))
          return reject('ACTIVE_PDF_CONTENT');
        if (object instanceof PDFDict) for (const [key, value] of object.entries()) stack.push(key, value);
        else if (object instanceof PDFArray) stack.push(...object.asArray());
        else if (object instanceof PDFStream) stack.push(object.dict);
      }
      return { result: 'CLEAN', sanitized: false };
    } catch (error) {
      return reject(
        error instanceof Error && error.message === new EncryptedPDFError().message
          ? 'ENCRYPTED_PDF'
          : 'INVALID_PDF',
      );
    }
  }
  try {
    sharp.cache(false);
    sharp.concurrency(1);
    const image = sharp(input, { failOn: 'warning', limitInputPixels: Number(pixels), sequentialRead: true });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1) return reject('ANIMATED_IMAGE');
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > Number(pixels))
      return reject('IMAGE_PIXEL_LIMIT');
    const formats: Record<string, 'jpeg' | 'png' | 'webp'> = {
      'image/jpeg': 'jpeg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const format = formats[type.mime];
    if (!format) return reject('TYPE_NOT_ALLOWED');
    if (metadata.format !== format) return reject('TYPE_MISMATCH');
    // No keepMetadata/withMetadata: the re-encode strips EXIF/GPS, XMP and ICC metadata.
    await image.rotate().toFormat(format).timeout({ seconds: 10 }).toFile(path.join(directory, 'sanitized'));
    return { result: 'CLEAN', sanitized: true };
  } catch (error) {
    return reject(
      error instanceof Error && /pixel limit/i.test(error.message) ? 'IMAGE_PIXEL_LIMIT' : 'INVALID_IMAGE',
    );
  }
}

// Parser diagnostics can contain file content. Only a small typed verdict leaves the child.
console.warn = () => undefined;
console.error = () => undefined;
void inspect().then(
  (verdict) => process.stdout.write(JSON.stringify(verdict)),
  () => process.stdout.write(JSON.stringify({ result: 'ERROR', reasonCode: 'SCAN_UNAVAILABLE' })),
);
