// Repairs a corepack cache entry whose recorded entry point does not exist.
//
// Corepack writes a `.corepack` file beside each cached package manager, naming the file to execute.
// Corepack 0.34.0 — the version bundled with Node 24.6.0, and the one on Hostinger's build image —
// records `./bin/pnpm.cjs` for every pnpm version, because that is where pnpm kept its entry point up to
// v11. pnpm 12 moved it: the package now ships `bin/pnpm.mjs` (ESM) and declares top-level `pnpm`, `pn`,
// `pnpx` and `pnx` scripts in its own `bin` field. So corepack downloads pnpm 12 successfully, records a
// path that was never in the tarball, and the next invocation dies:
//
//   Error: Cannot find module '~/.cache/node/corepack/v1/pnpm/12.4.2/bin/pnpm.cjs'
//   code: 'MODULE_NOT_FOUND'
//
// Newer corepack reads the package's own `bin` field and gets this right; CI never sees the failure
// because `actions/setup-node` ships a current corepack. The fix belongs on the build image, and until it
// arrives this writes the one file corepack is looking for: a CommonJS stub that dynamically imports the
// ESM entry point beside it. Dynamic `import()` is available in CJS, so the stub needs nothing else.
//
// It is deliberately narrow. It only ever writes a missing `.cjs` next to an existing `.mjs` of the same
// name, inside corepack's own cache; it never edits a file that exists, never touches the repository, and
// does nothing at all when corepack already works. On a healthy image every call is a no-op.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Where corepack keeps its cache. `COREPACK_HOME` wins, then the platform default.
 *
 * Node's own default moved to `~/.cache/node/corepack` on Linux; older corepack used `~/.corepack`. Both
 * are checked, because which one applies depends on the corepack version rather than on anything we know.
 */
export function corepackRoots(env = process.env, home = os.homedir()) {
  const roots = [];
  if (env.COREPACK_HOME) roots.push(env.COREPACK_HOME);
  if (env.XDG_CACHE_HOME) roots.push(path.join(env.XDG_CACHE_HOME, 'node', 'corepack'));
  roots.push(path.join(home, '.cache', 'node', 'corepack'));
  roots.push(path.join(home, 'AppData', 'Local', 'node', 'corepack'));
  roots.push(path.join(home, '.corepack'));
  return roots;
}

/**
 * The repairs one cache entry needs, as `{ write, from }` pairs. Pure, so the decision is testable
 * without a corepack cache to hand.
 *
 * `bin` is the `bin` map out of the entry's `.corepack` file. A repair is proposed only when the recorded
 * path ends in `.cjs`, is absent, and the same name with `.mjs` is present — the exact shape of the
 * version-skew above. Anything else is left alone, because anything else is a situation nobody has
 * diagnosed.
 */
export function plannedRepairs(bin, dir, exists) {
  const repairs = [];
  for (const recorded of Object.values(bin ?? {})) {
    if (typeof recorded !== 'string' || !recorded.endsWith('.cjs')) continue;
    const target = path.join(dir, recorded);
    if (exists(target)) continue;
    const esm = target.slice(0, -'.cjs'.length) + '.mjs';
    if (!exists(esm)) continue;
    repairs.push({ write: target, from: path.basename(esm) });
  }
  return repairs;
}

/** The stub's contents. Kept in one place so the test asserts what actually gets written. */
export function stubSource(esmBasename) {
  return (
    '// Written by scripts/host/corepack-repair.mjs.\n' +
    '// corepack recorded this path; pnpm 12 ships the ESM entry point beside it instead.\n' +
    `import('./${esmBasename}');\n`
  );
}

/** Repairs every cached entry under `root` that needs it. Returns what it wrote. */
export function repairCache(root, deps = {}) {
  const {
    exists = existsSync,
    read = (f) => readFileSync(f, 'utf8'),
    write = (f, body) => writeFileSync(f, body),
    listVersions,
  } = deps;
  const written = [];
  if (!exists(root)) return written;
  for (const dir of listVersions(root)) {
    const meta = path.join(dir, '.corepack');
    if (!exists(meta)) continue;
    let bin;
    try {
      bin = JSON.parse(read(meta)).bin;
    } catch {
      // A `.corepack` we cannot parse is not ours to interpret.
      continue;
    }
    for (const repair of plannedRepairs(bin, dir, exists)) {
      write(repair.write, stubSource(repair.from));
      written.push(repair.write);
    }
  }
  return written;
}
