#!/usr/bin/env node
// Restores the execute bit on native binaries that the deployment host extracts as 0644.
//
// This host loses mode bits when unpacking packages, and it has now cost two deployments:
//
//   Error: spawn .../@turbo/linux-64/bin/turbo EACCES        — the build could not start
//   /health/ready -> {"db":"fail"}, with nothing logged      — Prisma could not dlopen its query engine
//   Error: Schema engine exited. Command failed with EACCES  — the deploy could not migrate, so it 503ed
//
// The second was the quieter failure. `ping()` swallows the error and reports `fail`, so a query engine
// that cannot be loaded looks identical to a database that is down.
//
// The third hid for longer. The schema engine is spawned only when there is a migration to apply, so every
// deploy with nothing pending looked healthy, and the one that finally had work to do took the site down.
//
// Only files that are already missing the bit are touched, and only inside `bin/` directories or matching
// a query-engine name, so this cannot make something executable that was meant to be data. It is a no-op
// on Windows and on any host that extracts modes correctly.
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNativeBinary } from './native-binaries.mjs';

if (process.platform === 'win32') process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pnpmDir = path.join(root, 'node_modules', '.pnpm');
if (!existsSync(pnpmDir)) process.exit(0);

const fixed = [];

function fixDir(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !isNativeBinary(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (statSync(file).mode & 0o111) continue;
    chmodSync(file, 0o755);
    fixed.push(path.relative(root, file));
  }
}

try {
  for (const entry of readdirSync(pnpmDir)) {
    const pkg = path.join(pnpmDir, entry, 'node_modules');
    if (!existsSync(pkg)) continue;
    if (entry.startsWith('@turbo+')) {
      const scope = path.join(pkg, '@turbo');
      if (existsSync(scope)) for (const p of readdirSync(scope)) fixDir(path.join(scope, p, 'bin'));
    }
    if (entry.startsWith('@prisma+client@') || entry.startsWith('prisma@')) {
      // Generated clients land in `.prisma/client`; the CLI keeps its own copies alongside.
      fixDir(path.join(pkg, '.prisma', 'client'));
      fixDir(path.join(pkg, 'prisma'));
    }
    if (entry.startsWith('@prisma+engines@')) {
      // Where `prisma migrate deploy` looks for the schema engine it spawns.
      fixDir(path.join(pkg, '@prisma', 'engines'));
    }
  }
} catch (error) {
  // Never block a build over this. A binary that is genuinely unusable produces a clearer error of its own
  // a moment later, and swallowing that would hide the cause.
  console.warn(`fix-native-exec-bits: skipped (${String(error)})`);
  process.exit(0);
}

if (fixed.length > 0) console.log(`fix-native-exec-bits: made executable -> ${fixed.join(', ')}`);
