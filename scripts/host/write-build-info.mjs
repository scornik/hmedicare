#!/usr/bin/env node
// Writes <appDir>/dist/build-info.json with the built git SHA (read at startup by applyBuildInfo).
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
  version = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
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
