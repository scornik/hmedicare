#!/usr/bin/env node
// License scan (TECHNOLOGY-STACK.md §5, Stage 4 rule: every new dependency needs a passing license scan).
// Production dependencies must use a permissive license; LGPL is allowed only for named packages used as
// unmodified libraries. Development-only tooling may additionally use weak-copyleft licenses because it is
// never shipped. Unknown or strong-copyleft licenses fail.
import { execSync } from 'node:child_process';

const PERMISSIVE = new Set([
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'Unlicense',
  'CC0-1.0',
  'MIT and ISC',
]);
/** LGPL packages allowed in production (dynamic use of an unmodified library). */
const LGPL_EXCEPTIONS = new Set(['mariadb']);
/** Weak copyleft allowed for development tooling only (never bundled into deployed artifacts). */
const DEV_ONLY = new Set(['MPL-2.0', 'EPL-2.0']);

function list(prod) {
  // Fixed command string (no user input), so a shell is safe and works for the pnpm shim on Windows.
  const out = execSync(`pnpm licenses list --json${prod ? ' --prod' : ''}`, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

const problems = [];
const prod = list(true);
for (const [license, pkgs] of Object.entries(prod)) {
  for (const p of pkgs) {
    if (PERMISSIVE.has(license)) continue;
    if (license.startsWith('LGPL') && LGPL_EXCEPTIONS.has(p.name)) continue;
    problems.push(`prod ${p.name}@${p.versions.join(',')}: ${license}`);
  }
}
const all = list(false);
for (const [license, pkgs] of Object.entries(all)) {
  for (const p of pkgs) {
    if (PERMISSIVE.has(license) || DEV_ONLY.has(license)) continue;
    if (license.startsWith('LGPL') && LGPL_EXCEPTIONS.has(p.name)) continue;
    const isProd = (prod[license] ?? []).some((q) => q.name === p.name);
    if (!isProd) problems.push(`dev ${p.name}@${p.versions.join(',')}: ${license}`);
  }
}

if (problems.length) {
  console.error(`license-scan: ${problems.length} disallowed license(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
const count = (m) => Object.values(m).reduce((n, v) => n + v.length, 0);
console.log(`license-scan: clean (${count(prod)} production, ${count(all)} total packages)`);
