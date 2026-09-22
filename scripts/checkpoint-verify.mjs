#!/usr/bin/env node
// Checkpoint verification (Stage 5 prompt §0.2). Runs every gate on the current tree and exits non-zero if
// any check fails. With `--tag <name> --message <text>` it creates the annotated tag only after every check
// passed on this exact, clean tree, and refuses a tag name that already exists (tags are never re-pointed).
//
//   node scripts/checkpoint-verify.mjs [--skip-mobile] [--skip-web] [--tag stage5-cp3-patient --message "..."]
//
// Each gate's real exit status is used (no pipes); output goes to a per-gate log under the OS temp dir.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    tag: { type: 'string' },
    message: { type: 'string' },
    'skip-mobile': { type: 'boolean' },
    'skip-web': { type: 'boolean' },
    'skip-integration': { type: 'boolean' },
  },
});
if (values.tag && !values.message) {
  console.error('checkpoint-verify: --tag requires --message');
  process.exit(2);
}
if (values.tag && (values['skip-mobile'] || values['skip-web'] || values['skip-integration'])) {
  console.error('checkpoint-verify: a tag requires the full gate set (no --skip-*)');
  process.exit(2);
}

const win = process.platform === 'win32';
const pnpm = win ? 'pnpm.cmd' : 'pnpm';
const logDir = mkdtempSync(path.join(os.tmpdir(), 'hm-checkpoint-'));

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...(opts.env ?? {}) },
    encoding: 'utf8',
    // `.bat` as well as `.cmd`: the mobile gates spawn `dart.bat`, and since Node's CVE-2024-27980 fix
    // a batch file cannot be spawned without a shell (EINVAL). Without this the three mobile gates
    // never ran and reported an empty-log failure, which no checkpoint could ever get past on Windows.
    shell: win && /\.(cmd|bat)$/.test(cmd),
    maxBuffer: 256 * 1024 * 1024,
  });
}

const results = [];
function gate(name, cmd, args, opts) {
  const started = Date.now();
  const r = run(cmd, args, opts);
  const log = path.join(logDir, `${name.replace(/[^a-z0-9]+/gi, '-')}.log`);
  writeFileSync(log, `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  const ok = r.status === 0;
  const tests = [...`${r.stdout}`.matchAll(/Tests\s+(\d+) passed \((\d+)\)/g)].map((m) => m[1]);
  results.push({ name, ok, seconds: Math.round((Date.now() - started) / 1000), log, tests });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${tests.length ? `  (tests: ${tests.join(', ')})` : ''}`);
  return ok;
}

function check(name, fn) {
  let problems;
  try {
    problems = fn();
  } catch (error) {
    problems = [String(error)];
  }
  const ok = problems.length === 0;
  results.push({ name, ok, seconds: 0, log: null, tests: [] });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  for (const p of problems.slice(0, 20)) console.log(`      - ${p}`);
  return ok;
}

// ---- docs placeholder scan (no template or placeholder text may remain in committed docs)
const PLACEHOLDER = /__[A-Z0-9_]{2,}__|\bTBD\b|\bFIXME\b|<placeholder>|\bthis branch\b|\bXXX\b/;
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}
check('docs: no placeholder text', () => {
  const problems = [];
  for (const file of walk(path.join(root, 'docs/implementation'))) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        // Real names, not placeholders: the `__Host-` cookie prefix and the .htaccess build token.
        const scrubbed = line.replace(/__Host-/g, '').replace(/__API_ORIGIN__/g, '');
        if (PLACEHOLDER.test(scrubbed))
          problems.push(`${path.relative(root, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
  }
  return problems;
});

check('git: working tree clean', () => {
  const r = run('git', ['status', '--porcelain']);
  if (r.status !== 0) return ['git status failed'];
  return r.stdout.trim() ? r.stdout.trim().split('\n') : [];
});

for (const s of [
  'format:check',
  'lint',
  'typecheck',
  'depcruise',
  'secrets:scan',
  'license:scan',
  'openapi:check',
]) {
  gate(s, pnpm, [s]);
}
gate('db:migration:lint', pnpm, ['--filter', '@hmedic/database', 'run', 'db:migration:lint']);
gate('test:unit', pnpm, ['test:unit']);
gate('test:architecture', pnpm, ['test:architecture']);
if (!values['skip-integration']) {
  // 10.6 is the floor the design targets; 11.8 is the series the deployed plan runs (HOST-001).
  for (const image of ['mariadb:10.6', 'mariadb:11.8']) {
    gate(`test:integration ${image}`, process.execPath, ['scripts/test/run-integration.mjs'], {
      env: { MARIADB_IMAGES: image },
    });
  }
}
if (!values['skip-web']) {
  gate('web: unit', pnpm, ['--filter', '@hmedic/web', 'test']);
  gate('web: playwright', pnpm, ['test:e2e']);
}
if (!values['skip-mobile']) {
  const mobile = path.join(root, 'mobile');
  const dart = win ? 'dart.bat' : 'dart';
  gate('mobile: format', dart, ['run', 'melos', 'run', 'format:check'], { cwd: mobile });
  gate('mobile: analyze', dart, ['run', 'melos', 'run', 'analyze'], { cwd: mobile });
  gate('mobile: test', dart, ['run', 'melos', 'run', 'test'], { cwd: mobile });
  gate('mobile: licenses', process.execPath, ['scripts/mobile-license-scan.mjs']);
}

const failed = results.filter((r) => !r.ok);
const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
console.log(`\ncheckpoint-verify: ${results.length - failed.length}/${results.length} passed at ${head}`);
console.log(`logs: ${logDir}`);
if (failed.length) {
  for (const f of failed) console.log(`FAILED: ${f.name}${f.log ? ` (${f.log})` : ''}`);
  process.exit(1);
}

if (values.tag) {
  // The tree must still be the one that was verified.
  if (run('git', ['status', '--porcelain']).stdout.trim()) {
    console.error('checkpoint-verify: tree changed during verification; not tagging');
    process.exit(1);
  }
  if (run('git', ['rev-parse', '-q', '--verify', `refs/tags/${values.tag}`]).status === 0) {
    console.error(`checkpoint-verify: tag ${values.tag} already exists; tags are never re-pointed`);
    process.exit(1);
  }
  const t = run('git', ['tag', '-a', values.tag, '-m', values.message]);
  if (t.status !== 0) {
    console.error(`checkpoint-verify: git tag failed: ${t.stderr}`);
    process.exit(1);
  }
  console.log(`checkpoint-verify: tagged ${values.tag} at ${head}`);
}
