import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finished, pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import {
  ObjectStorageError,
  assertStorageKey,
  categorySegment,
  type MalwareScanPort,
  type ObjectStoragePort,
  type ScanInput,
  type ScanReason,
  type ScanVerdict,
  type UploadScanCategory,
} from '@hmedic/laboratory-documents';

export interface ContentScanLimits {
  maxBytes: number;
  maxPdfPages: number;
  maxImagePixels: number;
  allowedTypes: readonly string[];
}
export interface BaselineScannerConfig {
  storage: ObjectStoragePort;
  limits: Record<UploadScanCategory, ContentScanLimits>;
  timeoutMs?: number;
}
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const REASONS = new Set<ScanReason>([
  'TYPE_NOT_ALLOWED',
  'TYPE_MISMATCH',
  'SIZE_LIMIT',
  'CHECKSUM_MISMATCH',
  'INVALID_PDF',
  'ENCRYPTED_PDF',
  'ACTIVE_PDF_CONTENT',
  'PDF_PAGE_LIMIT',
  'INVALID_IMAGE',
  'IMAGE_PIXEL_LIMIT',
  'ANIMATED_IMAGE',
  'SCAN_UNAVAILABLE',
]);
const unavailable = (): ScanVerdict => ({ result: 'ERROR', reasonCode: 'SCAN_UNAVAILABLE' });
const rejected = (reasonCode: ScanReason): ScanVerdict => ({ result: 'REJECTED', reasonCode });
const run = promisify(execFile);

export class BaselineContentPolicyScanner implements MalwareScanPort {
  private readonly limits: Record<UploadScanCategory, ContentScanLimits>;
  private readonly timeoutMs: number;
  constructor(private readonly config: BaselineScannerConfig) {
    this.timeoutMs = config.timeoutMs ?? 20_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 60_000)
      throw new Error('Invalid scanner deadline');
    const policy = (category: UploadScanCategory): ContentScanLimits => {
      const limit = config.limits[category];
      if (
        !limit ||
        !Number.isSafeInteger(limit.maxBytes) ||
        limit.maxBytes < 1 ||
        limit.maxBytes > 200 * 1024 * 1024 ||
        !Number.isSafeInteger(limit.maxPdfPages) ||
        limit.maxPdfPages < 1 ||
        limit.maxPdfPages > 1000 ||
        !Number.isSafeInteger(limit.maxImagePixels) ||
        limit.maxImagePixels < 1 ||
        limit.maxImagePixels > 40_000_000 ||
        !limit.allowedTypes.length ||
        limit.allowedTypes.some((type) => !ALLOWED.includes(type))
      )
        throw new Error('Invalid category scanning policy');
      return { ...limit, allowedTypes: [...limit.allowedTypes] };
    };
    this.limits = {
      LAB_REPORT: policy('LAB_REPORT'),
      IMAGE: policy('IMAGE'),
      REFERRAL: policy('REFERRAL'),
      OTHER: policy('OTHER'),
    };
  }

  describe() {
    return {
      adapter: 'baseline-content-policy',
      detectsKnownMalware: false,
      limits: [
        'Does not detect known malware signatures or exploits in well-formed documents.',
        'Only configured PDF/JPEG/PNG/WebP types; audio and Office files are not supported.',
        'Images are re-encoded without metadata; animated images are rejected.',
        'PDFs remain authoritative and are not rewritten; active content and attachments are rejected.',
        'Parsing has a deadline and a V8 heap limit; the child is not an operating-system security sandbox.',
        'Host image-library support must be verified before enabling uploads.',
      ],
    };
  }

  async scan(input: ScanInput): Promise<ScanVerdict> {
    let directory: string | undefined;
    let verdict = unavailable();
    try {
      assertStorageKey(input.key);
      const limit = this.limits[input.category];
      if (!limit || !limit.allowedTypes.includes(input.declaredContentType))
        return rejected('TYPE_NOT_ALLOWED');
      if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > limit.maxBytes)
        return rejected('SIZE_LIMIT');
      if (!/^[a-f0-9]{64}$/.test(input.sha256)) return rejected('CHECKSUM_MISMATCH');
      const parts = input.key.split('/');
      const revision = Number(parts[4]);
      if (parts[2] !== categorySegment(input.category) || !Number.isSafeInteger(revision) || revision < 1)
        return unavailable();
      if (input.declaredContentType.startsWith('image/')) {
        const expected = [...parts.slice(0, 4), String(revision + 1)].join('/');
        if (!input.sanitizedKey || input.sanitizedKey !== expected || !Number.isSafeInteger(revision + 1))
          return unavailable();
        assertStorageKey(input.sanitizedKey);
      }
      directory = await mkdtemp(path.join(tmpdir(), 'hmedic-scan-'));
      verdict = await this.scanPrivateFile(input, limit, directory);
    } catch {
      verdict = unavailable();
    } finally {
      // Only this call's own private mkdtemp directory is removed, never a supplied storage path.
      if (directory)
        await rm(directory, { recursive: true, force: true }).catch(() => {
          verdict = unavailable();
        });
    }
    return verdict;
  }

  private async scanPrivateFile(
    input: ScanInput,
    limit: ContentScanLimits,
    directory: string,
  ): Promise<ScanVerdict> {
    const source = await this.config.storage.get(input.key);
    if (source.sizeBytes !== input.sizeBytes) {
      source.stream.destroy();
      return rejected('CHECKSUM_MISMATCH');
    }
    const digest = createHash('sha256');
    let bytes = 0;
    let overflow = false;
    try {
      await pipeline(
        source.stream,
        async function* (chunks) {
          for await (const chunk of chunks) {
            const buffer = chunk as Buffer;
            bytes += buffer.length;
            if (bytes > input.sizeBytes || bytes > limit.maxBytes) {
              overflow = true;
              throw new Error('Size limit');
            }
            digest.update(buffer);
            yield buffer;
          }
        },
        createWriteStream(path.join(directory, 'input'), { flags: 'wx', mode: 0o600 }),
      );
    } catch (error) {
      if (overflow) return rejected('SIZE_LIMIT');
      throw error;
    }
    if (bytes !== input.sizeBytes || digest.digest('hex') !== input.sha256)
      return rejected('CHECKSUM_MISMATCH');
    const compiled = path.join(__dirname, 'worker.js');
    const worker = existsSync(compiled) ? compiled : path.join(__dirname, 'worker.ts');
    const result = await run(
      process.execPath,
      [
        '--max-old-space-size=192',
        worker,
        directory,
        input.declaredContentType,
        String(limit.maxImagePixels),
        String(limit.maxPdfPages),
      ],
      {
        cwd: directory,
        timeout: this.timeoutMs,
        maxBuffer: 8192,
        windowsHide: true,
        // The parser receives no provider credentials, database URL, NODE_OPTIONS or application secrets.
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          NODE_NO_WARNINGS: '1',
        },
      },
    );
    const answer: unknown = JSON.parse(result.stdout);
    if (!answer || typeof answer !== 'object') return unavailable();
    const value = answer as { result?: string; reasonCode?: ScanReason; sanitized?: boolean };
    if (value.result === 'REJECTED' && value.reasonCode && REASONS.has(value.reasonCode))
      return rejected(value.reasonCode);
    if (value.result !== 'CLEAN' || typeof value.sanitized !== 'boolean') return unavailable();
    if (input.declaredContentType === 'application/pdf')
      return value.sanitized ? unavailable() : { result: 'CLEAN' };
    if (!value.sanitized || !input.sanitizedKey) return unavailable();
    const output = path.join(directory, 'sanitized');
    const info = await lstat(output);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > limit.maxBytes)
      return rejected('SIZE_LIMIT');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(output)) hash.update(chunk as Buffer);
    const sha256 = hash.digest('hex');
    const outputStream = createReadStream(output);
    try {
      const stored = await this.config.storage.put(
        input.sanitizedKey,
        outputStream,
        input.declaredContentType,
      );
      return { result: 'CLEAN', sanitized: stored };
    } catch (error) {
      if (error instanceof ObjectStorageError && error.code === 'OBJECT_ALREADY_EXISTS') {
        const stored = await this.config.storage.head(input.sanitizedKey);
        if (stored.sizeBytes === info.size && stored.sha256 === sha256)
          return { result: 'CLEAN', sanitized: stored };
      }
      return unavailable();
    } finally {
      outputStream.destroy();
      await finished(outputStream, { cleanup: true }).catch(() => undefined);
    }
  }
}
