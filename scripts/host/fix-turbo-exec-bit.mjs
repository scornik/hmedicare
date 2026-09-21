#!/usr/bin/env node
// Ensures turbo's native platform binary is executable before `turbo run build` tries to spawn it.
//
// The Hostinger build died with:
//
//   Error: spawn .../@turbo/linux-64/bin/turbo EACCES
//
// because that file was extracted as 0644. `@turbo/linux-64` declares no `bin` field, so pnpm has nothing
// to mark executable — the package relies on the mode bits inside its own tarball, and on that host they
// did not survive extraction. Every other platform package in the tree was fine, so this is specific to
// turbo rather than a broken install.
//
// The check is cheap and silent when nothing is wrong. It runs from the root `build` script because the
// host's build command is a fixed dropdown (`pnpm run build`) and turbo fails before any other step of ours
// could intervene. CI calls `turbo run build --filter=…` directly and never reaches this.
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pnpmDir = path.join(root, 'node_modules', '.pnpm');
if (!existsSync(pnpmDir)) process.exit(0);

try {
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith('@turbo+')) continue;
    // node_modules/.pnpm/@turbo+linux-64@2.10.13/node_modules/@turbo/<platform>/bin/turbo
    const scope = path.join(pnpmDir, entry, 'node_modules', '@turbo');
    if (!existsSync(scope)) continue;
    for (const pkg of readdirSync(scope)) {
      const bin = path.join(scope, pkg, 'bin', 'turbo');
      if (!existsSync(bin)) continue;
      const mode = statSync(bin).mode;
      if (mode & 0o111) continue;
      chmodSync(bin, 0o755);
      console.log(`fix-turbo-exec-bit: made ${path.relative(root, bin)} executable`);
    }
  }
} catch (error) {
  // Never block a build over this. If the binary really is unusable, turbo's own EACCES is the clearer
  // message, and swallowing it here would only hide the cause.
  console.warn(`fix-turbo-exec-bit: skipped (${String(error)})`);
}
