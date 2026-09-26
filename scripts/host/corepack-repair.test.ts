import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs host script, deliberately not part of a tsconfig project.
import { corepackRoots, plannedRepairs, repairCache, stubSource } from './corepack-repair.mjs';

/**
 * The deploy that this repairs failed in production, so the conditions are pinned here rather than
 * described in a comment.
 *
 * The shape of the bug: corepack 0.34.0 records `./bin/pnpm.cjs` for every pnpm version, pnpm 12 ships
 * `bin/pnpm.mjs` instead, and the build dies with MODULE_NOT_FOUND on a path that was never in the
 * tarball. The repair has to fire for exactly that and for nothing else — a repair that guessed more
 * broadly would start writing files into a healthy cache, which is worse than the failure it fixes.
 */
const DIR = path.join('/cache', 'v1', 'pnpm', '12.4.2');
const j = (...p: string[]) => path.join(...p);

/** The real `.corepack` bin map from the failed production deploy. */
const COREPACK_034_BIN = { pnpm: './bin/pnpm.cjs', pnpx: './bin/pnpx.cjs' };

describe('plannedRepairs', () => {
  it('repairs a recorded .cjs that is missing when the .mjs is there', () => {
    // pnpm 12.4.2 as it actually unpacks: ESM entry points, no .cjs.
    const present = new Set([j(DIR, 'bin', 'pnpm.mjs'), j(DIR, 'bin', 'pnpx.mjs')]);
    const repairs = plannedRepairs(COREPACK_034_BIN, DIR, (f: string) => present.has(f));
    expect(repairs).toEqual([
      { write: j(DIR, 'bin', 'pnpm.cjs'), from: 'pnpm.mjs' },
      { write: j(DIR, 'bin', 'pnpx.cjs'), from: 'pnpx.mjs' },
    ]);
  });

  it('does nothing when corepack got it right', () => {
    // A current corepack, or pnpm 11: the recorded path exists, so there is nothing to fix.
    const present = new Set([j(DIR, 'bin', 'pnpm.cjs'), j(DIR, 'bin', 'pnpx.cjs')]);
    expect(plannedRepairs(COREPACK_034_BIN, DIR, (f: string) => present.has(f))).toEqual([]);
  });

  it('does not invent a stub when no .mjs is there either', () => {
    // A genuinely incomplete download. Writing a stub that imports a missing file would turn a clear
    // MODULE_NOT_FOUND into a confusing one.
    expect(plannedRepairs(COREPACK_034_BIN, DIR, () => false)).toEqual([]);
  });

  it('leaves a recorded path alone unless it ends in .cjs', () => {
    const bin = { pnpm: './bin/pnpm.mjs', yarn: './bin/yarn.js' };
    expect(plannedRepairs(bin, DIR, () => false)).toEqual([]);
  });

  it('tolerates a missing or malformed bin map', () => {
    expect(plannedRepairs(undefined, DIR, () => true)).toEqual([]);
    expect(plannedRepairs({}, DIR, () => true)).toEqual([]);
    expect(plannedRepairs({ pnpm: 42 } as never, DIR, () => true)).toEqual([]);
  });
});

describe('stubSource', () => {
  it('dynamically imports the sibling ESM entry point', () => {
    // `require` cannot load ESM; dynamic import can, and works inside CommonJS.
    const src = stubSource('pnpm.mjs');
    expect(src).toContain("import('./pnpm.mjs')");
    expect(src).not.toContain('require(');
  });
});

describe('repairCache', () => {
  it('writes one stub per broken entry and reports what it wrote', () => {
    const present = new Set([
      '/cache',
      j(DIR, '.corepack'),
      j(DIR, 'bin', 'pnpm.mjs'),
      j(DIR, 'bin', 'pnpx.mjs'),
    ]);
    const writes: Array<{ file: string; body: string }> = [];
    const written = repairCache('/cache', {
      exists: (f: string) => present.has(f),
      read: () => JSON.stringify({ bin: COREPACK_034_BIN }),
      write: (file: string, body: string) => writes.push({ file, body }),
      listVersions: () => [DIR],
    });

    expect(written).toEqual([j(DIR, 'bin', 'pnpm.cjs'), j(DIR, 'bin', 'pnpx.cjs')]);
    expect(writes[0]?.body).toContain("import('./pnpm.mjs')");
  });

  it('does nothing when the cache root is absent', () => {
    let listed = false;
    const written = repairCache('/nope', {
      exists: () => false,
      listVersions: () => {
        listed = true;
        return [];
      },
    });
    expect(written).toEqual([]);
    expect(listed).toBe(false);
  });

  it('skips an entry whose .corepack cannot be parsed', () => {
    const written = repairCache('/cache', {
      exists: () => true,
      read: () => 'not json',
      write: () => {
        throw new Error('must not write');
      },
      listVersions: () => [DIR],
    });
    expect(written).toEqual([]);
  });
});

describe('corepackRoots', () => {
  it('prefers COREPACK_HOME, then XDG, then the platform defaults', () => {
    const roots = corepackRoots({ COREPACK_HOME: '/explicit', XDG_CACHE_HOME: '/xdg' }, '/home/u');
    expect(roots[0]).toBe('/explicit');
    expect(roots[1]).toBe(path.join('/xdg', 'node', 'corepack'));
    // The production path, and the one Node 24 uses on Linux.
    expect(roots).toContain(path.join('/home/u', '.cache', 'node', 'corepack'));
    // Older corepack kept its cache here, and the build image's version is the whole reason this exists.
    expect(roots).toContain(path.join('/home/u', '.corepack'));
  });
});
