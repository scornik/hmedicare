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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

try {
  run(`corepack prepare ${packageManager} --activate`);
  console.log(`ensure-pnpm: ${packageManager} active`);
} catch (error) {
  // A build image without corepack is not fatal on its own: the pnpm already on PATH may be the right one,
  // and `pnpm install` will fail loudly a moment later if it is not. Exiting here would hide that message.
  console.warn(`ensure-pnpm: could not activate ${packageManager} via corepack (${String(error)})`);
  console.warn('ensure-pnpm: continuing with the pnpm already on PATH');
}
