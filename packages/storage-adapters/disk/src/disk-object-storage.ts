import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, lstat, mkdir, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  type ObjectReadOptions,
  ObjectStorageError,
  type ObjectStoragePort,
  type StoredObject,
  assertStorageKey,
} from '@hmedic/laboratory-documents';

/**
 * Private disk object storage (ADR-016 §4, FILE-STORAGE-IMPLEMENTATION.md §4).
 *
 * The adapter this hosting can actually run: one directory tree, outside every web root, reachable only
 * through the API. Three rules carry the weight.
 *
 * **The key is validated, then resolved, then checked again.** `assertStorageKey` accepts only the
 * generated shape, `path.resolve` turns it into an absolute path, and that path must still start with
 * the root. The second check is not redundant: it is what holds if the pattern is ever loosened, and a
 * traversal that survives a regex is exactly the kind of mistake nobody notices.
 *
 * **Symlinks are refused at every segment.** A link planted inside the root is a path that passes the
 * prefix check and lands anywhere on the filesystem. `lstat` on each segment is the only way to see it,
 * because `stat` follows the link and reports the target as if it were the link.
 *
 * **A write never overwrites.** Bytes go to a temporary file, are checksummed while streaming, then
 * atomically renamed into place — and the rename refuses an existing target. A key carries the document
 * id and revision, so a second write to the same key means something is re-rendering over bytes a
 * patient may already hold.
 */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Path fragments a storage root must never contain (`STORAGE_DISK_FORBIDDEN_ROOTS`). */
export const DEFAULT_FORBIDDEN_ROOTS = ['public_html', 'hbuilds'];

export interface DiskObjectStorageConfig {
  /** `STORAGE_DISK_ROOT`: absolute, outside every public root and the deploy directory. */
  root: string;
  /** Defaults to `public_html,hbuilds`. */
  forbiddenRoots?: readonly string[];
}

/**
 * Checks the root before anything is written to it (startup, ADR-016 §4).
 *
 * A relative root resolves against whatever the process working directory happens to be, which for a
 * Passenger app is not the directory anyone expects. A root under `public_html` is a public download of
 * every clinical file in the system, and that failure is silent: uploads keep working.
 */
export function assertStorageRoot(config: DiskObjectStorageConfig): string {
  const root = config.root;
  if (!root || !path.isAbsolute(root)) {
    throw new ObjectStorageError('STORAGE_ROOT_INVALID', 'STORAGE_DISK_ROOT must be an absolute path');
  }
  const resolved = path.resolve(root);
  const segments = resolved.split(/[\\/]+/).filter(Boolean);
  const forbidden = config.forbiddenRoots ?? DEFAULT_FORBIDDEN_ROOTS;
  const offending = forbidden.find((f) => segments.includes(f));
  if (offending) {
    throw new ObjectStorageError(
      'STORAGE_ROOT_INVALID',
      `STORAGE_DISK_ROOT is inside "${offending}", which is served over HTTP`,
    );
  }
  return resolved;
}

export class DiskObjectStorage implements ObjectStoragePort {
  readonly adapter = 'disk' as const;
  private readonly root: string;

  constructor(config: DiskObjectStorageConfig) {
    this.root = assertStorageRoot(config);
  }

  /**
   * Resolves a key to an absolute path, refusing anything that escapes the root or passes through a
   * symlink. Every method goes through here; none builds a path of its own.
   */
  private async resolveKey(key: string): Promise<string> {
    assertStorageKey(key);
    const objects = path.join(this.root, 'objects');
    const full = path.resolve(objects, key);
    // The prefix check after resolution, not instead of it. `path.resolve` has already collapsed any
    // `..`, so this sees where the path actually lands rather than what it claimed.
    if (full !== objects && !full.startsWith(objects + path.sep)) {
      throw new ObjectStorageError('STORAGE_KEY_INVALID', 'that key resolves outside the storage root');
    }
    await this.assertNoSymlinks(full);
    return full;
  }

  /**
   * Walks every segment from the root down and refuses a symlink at any of them.
   *
   * `stat` would follow the link and report the target, so a link to `/etc` looks like a directory
   * inside the root. `lstat` is the only call that sees the link itself. Missing segments are fine: a
   * write creates them, and a read of a missing path fails as not-found further on.
   */
  private async assertNoSymlinks(full: string): Promise<void> {
    const relative = path.relative(this.root, full);
    let current = this.root;
    const rootInfo = await lstat(current).catch(() => null);
    if (rootInfo?.isSymbolicLink()) {
      throw new ObjectStorageError('STORAGE_ROOT_INVALID', 'the storage root is a symlink');
    }
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const info = await lstat(current).catch(() => null);
      if (!info) return; // not created yet; nothing below it can exist either
      if (info.isSymbolicLink()) {
        throw new ObjectStorageError(
          'STORAGE_KEY_INVALID',
          'that path passes through a symlink, which this adapter refuses',
        );
      }
    }
  }

  async put(key: string, body: Buffer | Readable, _contentType: string): Promise<StoredObject> {
    const full = await this.resolveKey(key);
    const existing = await lstat(full).catch(() => null);
    if (existing) {
      throw new ObjectStorageError(
        'OBJECT_ALREADY_EXISTS',
        'that key already holds an object; a correction is a new revision',
      );
    }
    await mkdir(path.dirname(full), { recursive: true, mode: DIR_MODE });

    const tmpDir = path.join(this.root, '.tmp');
    await mkdir(tmpDir, { recursive: true, mode: DIR_MODE });
    // Named from the key's own shape, so a crashed write leaves something traceable rather than an
    // anonymous temp file nobody dares delete.
    const tmp = path.join(tmpDir, `${key.replace(/[\\/]/g, '_')}.${process.pid}.part`);

    const hash = createHash('sha256');
    let sizeBytes = 0;
    const source = Buffer.isBuffer(body) ? Readable.from(body) : body;

    try {
      // Checksummed while writing rather than read back afterwards: a read-back measures what the page
      // cache remembers, and the point of the checksum is to catch a write that did not land.
      await pipeline(
        source,
        async function* (chunks) {
          for await (const chunk of chunks) {
            const buffer = chunk as Buffer;
            hash.update(buffer);
            sizeBytes += buffer.length;
            yield buffer;
          }
        },
        createWriteStream(tmp, { mode: FILE_MODE, flush: true }),
      );
      // `link` rather than `rename`, because rename replaces an existing target silently. This fails
      // with EEXIST if the key was taken between the check above and now, which closes that race
      // instead of letting the later writer win.
      await link(tmp, full);
    } catch (e) {
      await rm(tmp, { force: true });
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        throw new ObjectStorageError(
          'OBJECT_ALREADY_EXISTS',
          'that key already holds an object; a correction is a new revision',
        );
      }
      throw new ObjectStorageError('STORAGE_IO_FAILED', `could not write the object: ${String(e)}`);
    }
    await rm(tmp, { force: true });

    return { key, sizeBytes, sha256: hash.digest('hex') };
  }

  async get(key: string, options?: ObjectReadOptions): Promise<{ stream: Readable; sizeBytes: number }> {
    const full = await this.resolveKey(key);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) {
      throw new ObjectStorageError('OBJECT_NOT_FOUND', 'no object at that key');
    }
    const range = options?.range;
    const stream = createReadStream(full, range ? { start: range.start, end: range.end } : undefined);
    const sizeBytes = range ? Math.min(info.size, (range.end ?? info.size - 1) + 1) - range.start : info.size;
    return { stream, sizeBytes };
  }

  async head(key: string): Promise<StoredObject> {
    const full = await this.resolveKey(key);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) {
      throw new ObjectStorageError('OBJECT_NOT_FOUND', 'no object at that key');
    }
    const hash = createHash('sha256');
    await pipeline(createReadStream(full), async function* (source) {
      for await (const chunk of source) hash.update(chunk as Buffer);
      yield Buffer.alloc(0);
    });
    return { key, sizeBytes: info.size, sha256: hash.digest('hex') };
  }

  async delete(key: string): Promise<void> {
    const full = await this.resolveKey(key);
    // Already gone is success, so cleanup after a failed render is idempotent.
    await unlink(full).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') {
        throw new ObjectStorageError('STORAGE_IO_FAILED', `could not delete the object: ${String(e)}`);
      }
    });
  }
}
