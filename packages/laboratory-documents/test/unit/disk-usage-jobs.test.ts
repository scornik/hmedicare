import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assessDiskUsage, storageRootBytes } from '../../src/infrastructure/disk-usage-jobs';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('private disk usage', () => {
  it('includes nested and temporary files and refuses a symlink to an outside file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hmedic-usage-'));
    roots.push(root);
    await mkdir(path.join(root, 'objects'));
    await mkdir(path.join(root, '.uploads'));
    await writeFile(path.join(root, 'objects', 'report'), Buffer.alloc(7));
    await writeFile(path.join(root, '.uploads', 'part'), Buffer.alloc(5));
    expect(await storageRootBytes(root)).toBe(12n);
    await symlink(
      path.join(root, 'objects'),
      path.join(root, 'outside-link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(storageRootBytes(root)).rejects.toThrow('STORAGE_ROOT_CONTAINS_SYMLINK');
  });

  it('alerts at the storage budget and filesystem thresholds', () => {
    const gib = 1024n ** 3n;
    const base = { indexedDocumentBytes: 0n, volumeBytes: 100n * gib, availableBytes: 50n * gib };
    expect(assessDiskUsage({ ...base, rootBytes: 23n * gib }, 40).level).toBe('ok');
    expect(assessDiskUsage({ ...base, rootBytes: 24n * gib }, 40).level).toBe('warning');
    expect(assessDiskUsage({ ...base, rootBytes: 30n * gib }, 40).level).toBe('critical');
    expect(assessDiskUsage({ ...base, rootBytes: 1n, availableBytes: 20n * gib }, 40).level).toBe('critical');
  });
});
