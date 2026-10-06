import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ObjectStorageError, buildStorageKey } from '@hmedic/laboratory-documents';
import { runObjectStorageContract } from '../../../test/contract';
import { DiskObjectStorage, assertStorageRoot } from '../../src/index';

/**
 * The disk adapter: the shared contract, plus the things only a filesystem can get wrong
 * (FILE-STORAGE-IMPLEMENTATION.md §6 "disk-only tests", ADR-016 §4).
 */
async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'hmedic-storage-'));
}

/**
 * A directory link this host can create without elevation.
 *
 * A plain Windows process cannot make a symlink (EPERM) but can make a junction, and Node's `lstat`
 * reports a junction as a symbolic link — which is exactly what the adapter checks. So the guard is
 * exercised on every platform rather than skipped on the one most developers run.
 */
const DIR_LINK = process.platform === 'win32' ? 'junction' : 'dir';

const linkDir = (target: string, at: string) => symlink(target, at, DIR_LINK);

runObjectStorageContract({
  name: 'disk',
  create: async () => {
    const root = await tempRoot();
    return {
      storage: new DiskObjectStorage({ root }),
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  },
});

const key = () =>
  buildStorageKey({
    tenantId: randomUUID(),
    category: 'PRESCRIPTION_PDF',
    documentId: randomUUID(),
    revision: 1,
  });

describe('disk adapter — storage root checks', () => {
  it('refuses a relative root', () => {
    // A relative root resolves against the process working directory, which for a Passenger app is not
    // the directory anyone expects.
    const e = (() => {
      try {
        return assertStorageRoot({ root: 'storage' });
      } catch (x) {
        return x;
      }
    })();
    expect((e as ObjectStorageError).code).toBe('STORAGE_ROOT_INVALID');
  });

  it.each(['public_html', 'hbuilds'])('refuses a root inside %s', (segment) => {
    // This failure is silent if unchecked: uploads keep working, and every clinical file becomes a
    // public download.
    const root = path.join(path.sep, 'home', 'u1', 'domains', 'x', segment, 'storage');
    const e = (() => {
      try {
        return assertStorageRoot({ root });
      } catch (x) {
        return x;
      }
    })();
    expect((e as ObjectStorageError).code).toBe('STORAGE_ROOT_INVALID');
    expect((e as Error).message).toContain(segment);
  });

  it('accepts an absolute root outside the forbidden fragments', async () => {
    const root = await tempRoot();
    try {
      expect(assertStorageRoot({ root })).toBe(path.resolve(root));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('disk adapter — path safety', () => {
  it('refuses a path that passes through a planted symlink', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    try {
      await writeFile(path.join(outside, 'secret'), 'not yours', 'utf8');
      const k = key();
      const [, tenantId, category] = k.split('/');
      // A link inside the root passes the prefix check and lands anywhere on the filesystem. `stat`
      // would follow it and report the target as though it were the link.
      await mkdir(path.join(root, 'objects', 't', tenantId!), { recursive: true });
      await linkDir(outside, path.join(root, 'objects', 't', tenantId!, category!));

      const storage = new DiskObjectStorage({ root });
      const e = await storage.put(k, Buffer.from('x'), 'application/pdf').catch((x) => x);
      expect((e as ObjectStorageError).code).toBe('STORAGE_KEY_INVALID');
      expect((e as Error).message).toContain('symlink');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('refuses a root that is itself a symlink', async () => {
    const real = await tempRoot();
    const parent = await tempRoot();
    const linked = path.join(parent, 'root-link');
    try {
      await linkDir(real, linked);
      const storage = new DiskObjectStorage({ root: linked });
      const e = await storage.put(key(), Buffer.from('x'), 'application/pdf').catch((x) => x);
      expect((e as ObjectStorageError).code).toBe('STORAGE_ROOT_INVALID');
    } finally {
      await rm(real, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    }
  });

  it.each([
    'objects/../../escape/1',
    't/../../escape/prescription-pdf/1',
    `t/${'../'.repeat(4)}etc/passwd/1`,
  ])('refuses the traversal %s before touching the filesystem', async (bad) => {
    const root = await tempRoot();
    try {
      const storage = new DiskObjectStorage({ root });
      const e = await storage.put(bad, Buffer.from('x'), 'application/pdf').catch((x) => x);
      expect((e as ObjectStorageError).code).toBe('STORAGE_KEY_INVALID');
      // Nothing was created: the key never became a path.
      expect(await stat(path.join(root, 'objects')).catch(() => null)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses a percent-encoded traversal rather than decoding it', async () => {
    const root = await tempRoot();
    try {
      const storage = new DiskObjectStorage({ root });
      // The adapter never decodes. A key is already decoded by the time it reaches storage, so `%2e%2e`
      // here is a literal segment, and the allow-list refuses it for not being a generated key.
      const e = await storage
        .put('t/%2e%2e/prescription-pdf/%2e%2e/1', Buffer.from('x'), 'application/pdf')
        .catch((x) => x);
      expect((e as ObjectStorageError).code).toBe('STORAGE_KEY_INVALID');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('disk adapter — file permissions', () => {
  it('writes objects and directories private to the owner', async () => {
    const root = await tempRoot();
    try {
      const storage = new DiskObjectStorage({ root });
      const k = key();
      await storage.put(k, Buffer.from('bytes'), 'application/pdf');

      const file = await stat(path.join(root, 'objects', k));
      const dir = await stat(path.dirname(path.join(root, 'objects', k)));
      if (process.platform === 'win32') {
        // Windows does not carry POSIX mode bits; the ACL is the host's own. Asserted on POSIX only,
        // which is what staging and production run.
        expect(file.isFile()).toBe(true);
        return;
      }
      expect(file.mode & 0o777).toBe(0o600);
      expect(dir.mode & 0o777).toBe(0o700);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves no temporary file behind after a write', async () => {
    const root = await tempRoot();
    try {
      const storage = new DiskObjectStorage({ root });
      await storage.put(key(), Buffer.from('bytes'), 'application/pdf');
      const tmp = await stat(path.join(root, '.tmp')).catch(() => null);
      if (tmp) {
        const { readdir } = await import('node:fs/promises');
        expect(await readdir(path.join(root, '.tmp'))).toEqual([]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
