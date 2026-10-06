#!/usr/bin/env node
// License scan (TECHNOLOGY-STACK.md §5, Stage 4 rule: every new dependency needs a passing license scan).
// Production dependencies must use a permissive license; LGPL is allowed only for named packages used as
// unmodified libraries. Development-only tooling may additionally use weak-copyleft licenses because it is
// never shipped. Unknown or strong-copyleft licenses fail.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

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
  'Python-2.0',
  // zlib/libpng: permissive, no attribution-in-binary requirement beyond keeping the notice. Reached
  // this list through `pako`, which `pdfmake` uses for the deflate stream inside a PDF.
  'Zlib',
  'MIT and ISC',
]);
/** LGPL packages allowed in production (dynamic use of an unmodified library). */
const LGPL_EXCEPTIONS = new Set(['mariadb']);
/** OFL-1.1 is allowed only for named font packages (fonts embedded in the web bundle, unmodified). */
const FONT_OFL_EXCEPTIONS = new Set(['@fontsource/noto-sans-bengali']);
const fontOk = (license, name) => license === 'OFL-1.1' && FONT_OFL_EXCEPTIONS.has(name);
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

/**
 * SPDX expressions.
 *
 * `A OR B` passes when either alternative is allowed, because the recipient may choose. `A AND B`
 * requires *both*, since you have to comply with both at once — so every term must be allowed, which is
 * stricter than the OR case rather than looser. Conjunctions are checked first so that an expression
 * mixing them, `(A OR B) AND C`, is read as the conjunction it is.
 */
function allowed(license, set) {
  const bare = license.replace(/[()]/g, '').trim();
  const conjuncts = bare.split(/\s+AND\s+/i);
  if (conjuncts.length > 1) return conjuncts.every((l) => allowed(l, set));
  return bare.split(/\s+OR\s+/i).some((l) => set.has(l.trim()));
}

/**
 * Vendored font binaries, under any package's `assets/fonts` directory.
 *
 * `pnpm licenses list` sees dependencies, so a font committed into the tree passes this scan by being
 * invisible — which is the opposite of what a licence scan is for. Each directory holding a font must
 * carry `OFL.txt` and a `PROVENANCE.md` that records every file's SHA-256, and those hashes must still
 * match the bytes on disk. A font whose provenance drifted from its contents is a font nobody can say
 * they are licensed to ship.
 */
function vendoredFontProblems() {
  const out = [];
  const packagesDir = 'packages';
  if (!existsSync(packagesDir)) return out;
  for (const pkg of readdirSync(packagesDir)) {
    const dir = path.join(packagesDir, pkg, 'assets', 'fonts');
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    const fonts = readdirSync(dir).filter((f) => /\.(ttf|otf)$/i.test(f));
    if (fonts.length === 0) continue;
    const provenancePath = path.join(dir, 'PROVENANCE.md');
    if (!existsSync(path.join(dir, 'OFL.txt'))) out.push(`${dir}: fonts without OFL.txt`);
    if (!existsSync(provenancePath)) {
      out.push(`${dir}: fonts without PROVENANCE.md`);
      continue;
    }
    const provenance = readFileSync(provenancePath, 'utf8');
    for (const font of fonts) {
      const actual = createHash('sha256')
        .update(readFileSync(path.join(dir, font)))
        .digest('hex');
      if (!provenance.includes(font)) out.push(`${dir}/${font}: not listed in PROVENANCE.md`);
      else if (!provenance.includes(actual)) {
        out.push(`${dir}/${font}: SHA-256 ${actual} is not the one PROVENANCE.md records`);
      }
    }
  }
  return out;
}

const problems = vendoredFontProblems();
const prod = list(true);
for (const [license, pkgs] of Object.entries(prod)) {
  for (const p of pkgs) {
    if (allowed(license, PERMISSIVE) || fontOk(license, p.name)) continue;
    if (license.startsWith('LGPL') && LGPL_EXCEPTIONS.has(p.name)) continue;
    problems.push(`prod ${p.name}@${p.versions.join(',')}: ${license}`);
  }
}
const all = list(false);
for (const [license, pkgs] of Object.entries(all)) {
  for (const p of pkgs) {
    if (allowed(license, PERMISSIVE) || allowed(license, DEV_ONLY) || fontOk(license, p.name)) continue;
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
