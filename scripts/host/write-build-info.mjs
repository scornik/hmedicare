#!/usr/bin/env node
// Writes <appDir>/dist/build-info.json with the built short git SHA (read at startup by applyBuildInfo).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const appDir = process.argv[2];
if (!appDir) {
  console.error('usage: write-build-info.mjs <appDir>');
  process.exit(2);
}
let version;
try {
  // Short, not the full SHA: an operator types this value back as PRE_MIGRATION_DUMP_CONFIRMED (and
  // ALLOW_CONTRACT_MIGRATION) on a deploy with pending migrations, and `--short` is what `git log` shows.
  // `--short=8` is a floor, not a cap: git lengthens it if 8 characters would be ambiguous.
  version = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // No git metadata on the build host: APP_VERSION stays 'dev' and promote-staging reports the mismatch.
  console.warn('build-info: git SHA unavailable; set APP_VERSION in hPanel instead');
  process.exit(0);
}
const dist = path.resolve(appDir, 'dist');
mkdirSync(dist, { recursive: true });
writeFileSync(
  path.join(dist, 'build-info.json'),
  `${JSON.stringify({ version, builtAt: new Date().toISOString() })}\n`,
);
console.log(`build-info: ${path.relative(process.cwd(), dist)}/build-info.json → ${version}`);
