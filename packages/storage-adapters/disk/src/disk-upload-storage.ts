import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  ObjectStorageError,
  UploadStorageError,
  UPLOAD_SHA256,
  assertUploadParts,
  assertUploadSession,
  uploadPartSize,
  type ProxiedUploadStoragePort,
  type StoredObject,
  type UploadPartReceipt,
  type UploadStorageSession,
} from '@hmedic/laboratory-documents';
import { DiskObjectStorage, type DiskObjectStorageConfig } from './disk-object-storage';

/**
 * Private resumable parts. Receipts address immutable bytes, so competing replacements cannot
 * silently change a receipt the database has already accepted. The application owns session
 * authorization and serializes finalization/abort through its durable state transitions.
 */
export class DiskUploadStorage extends DiskObjectStorage implements ProxiedUploadStoragePort {
  constructor(
    config: DiskObjectStorageConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    super(config);
  }

  private async directory(session: UploadStorageSession): Promise<string> {
    assertUploadSession(session);
    const uploads = path.join(this.root, '.uploads');
    const directory = path.resolve(uploads, session.sessionId);
    if (!directory.startsWith(uploads + path.sep))
      throw new UploadStorageError('UPLOAD_INVALID', 'Invalid upload directory');
    await this.assertNoSymlinks(directory);
    return directory;
  }

  private manifest(session: UploadStorageSession): string {
    return JSON.stringify({
      sessionId: session.sessionId,
      key: session.key,
      contentType: session.contentType,
      sizeBytes: session.sizeBytes,
      sha256: session.sha256,
      partSizeBytes: session.partSizeBytes,
      expiresAt: session.expiresAt.toISOString(),
    });
  }

  private assertOpen(session: UploadStorageSession): void {
    if (session.expiresAt.getTime() <= this.now().getTime())
      throw new UploadStorageError('UPLOAD_EXPIRED', 'Upload session has expired');
  }

  private failure(error: unknown): Error {
    if (error instanceof UploadStorageError || error instanceof ObjectStorageError) return error;
    return new UploadStorageError('UPLOAD_IO_FAILED', 'Private upload storage operation failed');
  }

  private async existing(session: UploadStorageSession, checkExpiry = true): Promise<string> {
    const directory = await this.directory(session);
    if (checkExpiry) this.assertOpen(session);
    let saved: string;
    try {
      const file = path.join(directory, 'session.json');
      await this.assertNoSymlinks(file);
      saved = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new UploadStorageError('UPLOAD_NOT_FOUND', 'Upload session does not exist');
      throw this.failure(error);
    }
    if (saved !== this.manifest(session))
      throw new UploadStorageError('UPLOAD_CONFLICT', 'Upload session definition does not match');
    return directory;
  }

  async createUploadSession(session: UploadStorageSession): Promise<void> {
    const directory = await this.directory(session);
    this.assertOpen(session);
    let temporary: string | undefined;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await this.assertNoSymlinks(directory);
      temporary = path.join(directory, `${randomUUID()}.tmp`);
      await writeFile(temporary, this.manifest(session), { flag: 'wx', mode: 0o600, flush: true });
      try {
        await link(temporary, path.join(directory, 'session.json'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      await this.existing(session);
    } catch (error) {
      throw this.failure(error);
    } finally {
      if (temporary) await rm(temporary, { force: true });
    }
  }

  async uploadPart(
    session: UploadStorageSession,
    partNumber: number,
    body: Buffer | Readable,
    sha256: string,
  ): Promise<UploadPartReceipt> {
    const expected = uploadPartSize(session, partNumber);
    if (!UPLOAD_SHA256.test(sha256))
      throw new UploadStorageError('UPLOAD_PARTS_INVALID', 'Invalid part checksum');
    const directory = await this.existing(session);
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    const receipt: UploadPartReceipt = { partNumber, sizeBytes: expected, sha256 };
    const destination = path.join(directory, `${partNumber}-${sha256}.part`);
    await this.assertNoSymlinks(destination);
    const hash = createHash('sha256');
    let size = 0;
    try {
      await pipeline(
        Buffer.isBuffer(body) ? Readable.from([body]) : body,
        async function* (source) {
          for await (const chunk of source) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
            size += bytes.length;
            if (size > expected)
              throw new UploadStorageError('UPLOAD_PARTS_INVALID', 'Upload part exceeds its size');
            hash.update(bytes);
            yield bytes;
          }
        },
        createWriteStream(temporary, { flags: 'wx', mode: 0o600, flush: true }),
      );
      if (size !== expected)
        throw new UploadStorageError('UPLOAD_PARTS_INVALID', 'Upload part is incomplete');
      if (hash.digest('hex') !== sha256)
        throw new UploadStorageError('UPLOAD_CHECKSUM_MISMATCH', 'Upload part checksum does not match');
      await this.existing(session);
      try {
        await link(temporary, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // A retry may encounter a durable receipt, but must not trust corrupted on-disk bytes.
        await this.verifyPart(destination, receipt);
      }
      return receipt;
    } catch (error) {
      throw this.failure(error);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async verifyPart(file: string, receipt: UploadPartReceipt): Promise<void> {
    await this.assertNoSymlinks(file);
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of createReadStream(file)) {
      size += (chunk as Buffer).length;
      if (size > receipt.sizeBytes)
        throw new UploadStorageError('UPLOAD_CHECKSUM_MISMATCH', 'Stored part size changed');
      hash.update(chunk as Buffer);
    }
    if (size !== receipt.sizeBytes || hash.digest('hex') !== receipt.sha256)
      throw new UploadStorageError('UPLOAD_CHECKSUM_MISMATCH', 'Stored part integrity check failed');
  }

  async completeUpload(
    session: UploadStorageSession,
    parts: readonly UploadPartReceipt[],
  ): Promise<StoredObject> {
    assertUploadParts(session, parts);
    const directory = await this.existing(session);
    let integrityError: UploadStorageError | undefined;
    async function* verifiedBytes(this: DiskUploadStorage) {
      const fullHash = createHash('sha256');
      let total = 0;
      try {
        for (const part of parts) {
          const file = path.join(directory, `${part.partNumber}-${part.sha256}.part`);
          await this.assertNoSymlinks(file);
          const partHash = createHash('sha256');
          let partSize = 0;
          for await (const chunk of createReadStream(file)) {
            const bytes = chunk as Buffer;
            partSize += bytes.length;
            total += bytes.length;
            if (partSize > part.sizeBytes || total > session.sizeBytes)
              throw new UploadStorageError('UPLOAD_CHECKSUM_MISMATCH', 'Stored upload size changed');
            partHash.update(bytes);
            fullHash.update(bytes);
            yield bytes;
          }
          if (partSize !== part.sizeBytes || partHash.digest('hex') !== part.sha256)
            throw new UploadStorageError('UPLOAD_CHECKSUM_MISMATCH', 'Stored part integrity check failed');
        }
        if (total !== session.sizeBytes || fullHash.digest('hex') !== session.sha256)
          throw new UploadStorageError('UPLOAD_CHECKSUM_MISMATCH', 'Full upload checksum does not match');
        await this.existing(session);
      } catch (error) {
        if (error instanceof UploadStorageError) integrityError = error;
        throw error;
      }
    }
    try {
      return await this.put(session.key, Readable.from(verifiedBytes.call(this)), session.contentType);
    } catch (error) {
      if (integrityError) throw integrityError;
      if (error instanceof ObjectStorageError && error.code === 'OBJECT_ALREADY_EXISTS') {
        // Lost finalize responses recover by reading; never overwrite the published revision.
        const stored = await this.head(session.key);
        if (stored.sizeBytes === session.sizeBytes && stored.sha256 === session.sha256) return stored;
        throw new UploadStorageError(
          'UPLOAD_CONFLICT',
          'The target revision already contains different bytes',
        );
      }
      throw this.failure(error);
    }
  }

  async abortUpload(session: UploadStorageSession): Promise<void> {
    let directory: string;
    try {
      directory = await this.existing(session, false);
    } catch (error) {
      if (error instanceof UploadStorageError && error.code === 'UPLOAD_NOT_FOUND') return;
      throw error;
    }
    // directory() checks the absolute target is within this root's .uploads and refuses symlinks.
    // The application must hold its session transition lease while finalizing or aborting.
    await rm(directory, { recursive: true, force: true }).catch((error: unknown) => {
      throw this.failure(error);
    });
  }
}
