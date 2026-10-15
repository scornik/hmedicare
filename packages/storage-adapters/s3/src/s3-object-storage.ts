import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import {
  ObjectStorageError,
  assertStorageKey,
  type ObjectReadOptions,
  type ObjectStoragePort,
  type StoredObject,
} from '@hmedic/laboratory-documents';

export interface S3ObjectStorageConfig {
  /** Explicitly configured client: selecting a production provider belongs to composition. */
  client: S3Client;
  /** Must be private. The adapter never requests a public ACL or constructs public URLs. */
  bucket: string;
  /** Generated server objects only. Client multipart uploads have their own bounded session path. */
  maxPutBytes?: number;
  serverSideEncryption?: 'AES256' | 'aws:kms';
  kmsKeyId?: string;
}

/**
 * Generated-document storage, sharing the disk adapter's immutable object contract.
 * A bounded private temporary file supplies the size and SHA-256 before upload, so an incoming
 * stream is never collected in memory. Conditional PUT atomically refuses an existing revision.
 * Multipart sessions and presigned client targets are separate upload-path work (DOC-005).
 */
export class S3ObjectStorage implements ObjectStoragePort {
  readonly adapter = 's3' as const;
  private readonly maxPutBytes: number;

  constructor(private readonly config: S3ObjectStorageConfig) {
    this.maxPutBytes = config.maxPutBytes ?? 256 * 1024 * 1024;
    if (
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
      !Number.isSafeInteger(this.maxPutBytes) ||
      this.maxPutBytes < 1 ||
      this.maxPutBytes > 5 * 1024 ** 3 ||
      (config.kmsKeyId !== undefined && config.serverSideEncryption !== 'aws:kms')
    ) {
      throw new ObjectStorageError('STORAGE_CONFIG_INVALID', 'Invalid private object storage configuration');
    }
  }

  private failure(error: unknown): ObjectStorageError {
    if (error instanceof ObjectStorageError) return error;
    const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
    if (status === 404) return new ObjectStorageError('OBJECT_NOT_FOUND', 'No object at that key');
    if (status === 412)
      return new ObjectStorageError('OBJECT_ALREADY_EXISTS', 'That revision already holds an object');
    // Vendor errors may contain a signed URL, request headers or credential material.
    return new ObjectStorageError('STORAGE_IO_FAILED', 'Private object storage request failed');
  }

  async put(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject> {
    assertStorageKey(key);
    let directory: string | undefined;
    let upload: Readable | undefined;
    try {
      directory = await mkdtemp(path.join(tmpdir(), 'hmedic-s3-put-'));
      const file = path.join(directory, 'body');
      const hash = createHash('sha256');
      let sizeBytes = 0;
      const limit = this.maxPutBytes;
      await pipeline(
        Buffer.isBuffer(body) ? Readable.from([body]) : body,
        async function* (source) {
          for await (const chunk of source) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
            sizeBytes += bytes.length;
            if (sizeBytes > limit)
              throw new ObjectStorageError('STORAGE_IO_FAILED', 'Object exceeds the configured write limit');
            hash.update(bytes);
            yield bytes;
          }
        },
        createWriteStream(file, { flags: 'wx', mode: 0o600, flush: true }),
      );
      const sha256 = hash.digest('hex');
      upload = createReadStream(file);
      await this.config.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: upload,
          ContentLength: sizeBytes,
          ContentType: contentType,
          IfNoneMatch: '*',
          Metadata: { sha256 },
          ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
          ...(this.config.serverSideEncryption
            ? { ServerSideEncryption: this.config.serverSideEncryption }
            : {}),
          ...(this.config.kmsKeyId ? { SSEKMSKeyId: this.config.kmsKeyId } : {}),
        }),
      );
      return { key, sizeBytes, sha256 };
    } catch (error) {
      throw this.failure(error);
    } finally {
      if (upload) {
        upload.destroy();
        await finished(upload, { cleanup: true }).catch(() => {});
      }
      // This directory is created exclusively by mkdtemp above; no caller path is removed.
      if (directory)
        await rm(directory, { recursive: true, force: true }).catch((error) => {
          throw this.failure(error);
        });
    }
  }

  async get(key: string, options?: ObjectReadOptions): Promise<{ stream: Readable; sizeBytes: number }> {
    assertStorageKey(key);
    const range = options?.range;
    if (
      range &&
      (!Number.isSafeInteger(range.start) ||
        range.start < 0 ||
        (range.end !== undefined && (!Number.isSafeInteger(range.end) || range.end < range.start)))
    ) {
      throw new ObjectStorageError('STORAGE_IO_FAILED', 'Invalid byte range');
    }
    try {
      const result = await this.config.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {}),
        }),
      );
      if (
        !(result.Body instanceof Readable) ||
        result.ContentLength === undefined ||
        !Number.isSafeInteger(result.ContentLength) ||
        result.ContentLength < 0
      ) {
        if (result.Body instanceof Readable) result.Body.destroy();
        else
          await result.Body?.transformToWebStream()
            .cancel()
            .catch(() => {});
        throw new ObjectStorageError('STORAGE_IO_FAILED', 'Object stream is unavailable');
      }
      return { stream: result.Body, sizeBytes: result.ContentLength };
    } catch (error) {
      throw this.failure(error);
    }
  }

  async head(key: string): Promise<StoredObject> {
    assertStorageKey(key);
    try {
      const result = await this.config.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      const sha256 = result.Metadata?.sha256;
      if (
        result.ContentLength === undefined ||
        !Number.isSafeInteger(result.ContentLength) ||
        result.ContentLength < 0 ||
        !sha256 ||
        !/^[a-f0-9]{64}$/.test(sha256)
      ) {
        throw new ObjectStorageError('STORAGE_IO_FAILED', 'Object integrity metadata is unavailable');
      }
      return { key, sizeBytes: result.ContentLength, sha256 };
    } catch (error) {
      throw this.failure(error);
    }
  }

  async delete(key: string): Promise<void> {
    assertStorageKey(key);
    try {
      await this.config.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    } catch (error) {
      const mapped = this.failure(error);
      if (mapped.code !== 'OBJECT_NOT_FOUND') throw mapped;
    }
  }
}
