#!/usr/bin/env node
// Activates the pnpm version this repository pins, before any `pnpm` command runs.
//
// Hostinger's Node.js build invokes pnpm through corepack, and the corepack on the build image carries an
// older pnpm (11.8.x at the time of writing). That pnpm reads `packageManager: pnpm@12.4.2` from
// package.json and refuses to continue, because pnpm does not self-switch when corepack launched it:
//
//   ERROR: This project is configured to use 12.4.2 of pnpm. Your current pnpm is v11.8.0
//
// CI does not hit this: every workflow job runs `corepack prepare pnpm@12.4.2 --activate` first
// (.github/workflows/ci.yml). This script is that same step, expressed so a build command can run it.
//
// The version is read from `packageManager` rather than hard-coded, so bumping that field is still the one
// place a pnpm upgrade happens.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { corepackRoots, repairCache } from './corepack-repair.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { packageManager } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

if (typeof packageManager !== 'string' || !packageManager.startsWith('pnpm@')) {
  console.error(`ensure-pnpm: package.json "packageManager" must be pnpm@<version>, found ${packageManager}`);
  process.exit(2);
}

const run = (command) => execSync(command, { stdio: 'inherit' });

// `corepack enable` writes shims into the Node installation directory, which is not writable on every
// machine (a developer box without admin rights, for one). `prepare --activate` is the step that actually
// selects the version, and it works on its own, so a failure here is only worth a note.
try {
  run('corepack enable');
} catch {
  console.warn('ensure-pnpm: corepack enable was refused; trying prepare on its own');
}

/** Every `<root>/v1/<manager>/<version>` directory, so the repair can inspect each one. */
function cachedVersions(root) {
  const out = [];
  for (const managers of [path.join(root, 'v1'), root]) {
    let entries;
    try {
      entries = readdirSync(managers, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const manager of entries) {
      if (!manager.isDirectory()) continue;
      const dir = path.join(managers, manager.name);
      let versions;
      try {
        versions = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const version of versions) {
        if (!version.isDirectory()) continue;
        const full = path.join(dir, version.name);
        try {
          if (statSync(full).isDirectory()) out.push(full);
        } catch {
          // Raced with a cache prune; nothing to repair in a directory that is gone.
        }
      }
    }
  }
  return out;
}

try {
  run(`corepack prepare ${packageManager} --activate`);
  // Downloading is not the same as being able to run it. The corepack on Hostinger's build image (0.34.0,
  // bundled with Node 24.6.0) records pnpm's entry point as `bin/pnpm.cjs`, which pnpm 12 does not ship —
  // so `prepare` reports success and the next `pnpm` call dies with MODULE_NOT_FOUND. This puts the file
  // corepack is looking for in place. On an image with a current corepack it finds nothing to do.
  for (const root of corepackRoots()) {
    const written = repairCache(root, { listVersions: cachedVersions });
    for (const file of written) {
      console.log(`ensure-pnpm: wrote a corepack entry-point stub at ${file}`);
      console.log(
        'ensure-pnpm: the build image ships a corepack too old for this pnpm; see corepack-repair.mjs',
      );
    }
  }
  console.log(`ensure-pnpm: ${packageManager} active`);
} catch (error) {
  // A build image without corepack is not fatal on its own: the pnpm already on PATH may be the right one,
  // and `pnpm install` will fail loudly a moment later if it is not. Exiting here would hide that message.
  console.warn(`ensure-pnpm: could not activate ${packageManager} via corepack (${String(error)})`);
  console.warn('ensure-pnpm: continuing with the pnpm already on PATH');
}
