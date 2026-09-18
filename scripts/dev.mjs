#!/usr/bin/env node
// `pnpm dev` — brings up the full local stack (LOCAL-DEVELOPMENT.md):
//   1. .env (generated with fresh secrets on first run),
//   2. Docker: MariaDB 10.6 + mock-providers (`pnpm infra:up`),
//   3. guarded migrations + idempotent synthetic seed,
//   4. TypeScript build watch, api (3000, embedded job runner off), worker (3001, runner on) and the web
//      app (5173) when present.
// Ctrl+C stops everything (containers keep running; `pnpm infra:down` stops them).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const children = [];
// Only the Windows .cmd shims need a shell; node itself is spawned directly (its path may contain spaces).
const useShell = (cmd) => process.platform === 'win32' && cmd.endsWith('.cmd');

function step(name, cmd, args, extraEnv = {}) {
  console.log(`\n▶ ${name}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: useShell(cmd),
  });
  if (r.status !== 0) {
    console.error(`✗ ${name} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

function start(name, cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShell(cmd),
  });
  const prefix = (line) => `[${name}] ${line}`;
  for (const s of [child.stdout, child.stderr]) {
    s.setEncoding('utf8');
    s.on('data', (d) => process.stdout.write(d.split('\n').filter(Boolean).map(prefix).join('\n') + '\n'));
  }
  children.push(child);
  return child;
}

if (!existsSync(path.join(root, '.env')))
  step('generate .env', process.execPath, ['scripts/generate-local-secrets.mjs']);
process.loadEnvFile(path.join(root, '.env'));

step('infrastructure (MariaDB + mock-providers)', pnpm, ['infra:up']);
step('build', pnpm, [
  'exec',
  'turbo',
  'run',
  'build',
  '--filter=@hmedic/api...',
  '--filter=@hmedic/worker...',
  '--filter=@hmedic/seed...',
]);
step('migrations', pnpm, ['db:migrate']);
step('seed (idempotent; demo logins are printed only when created)', pnpm, ['db:seed']);

start('tsc', pnpm, ['exec', 'tsc', '-b', '-w', '--preserveWatchOutput', 'apps/api', 'apps/worker']);
start('api', process.execPath, ['--watch', 'apps/api/dist/main.js'], {
  PORT: '3000',
  JOB_RUNNER_MODE: 'off',
});
start('worker', process.execPath, ['--watch', 'apps/worker/dist/main.js'], {
  PORT: '3001',
  JOB_RUNNER_MODE: 'worker',
});
if (existsSync(path.join(root, 'apps/web/package.json')))
  start('web', pnpm, ['--filter', '@hmedic/web', 'dev']);

console.log(
  '\nHMedic dev stack: api http://localhost:3000  worker http://localhost:3001  web http://localhost:5173',
);
console.log('Mock OTP inbox: GET http://localhost:3000/internal/test/otp/<challengeId>\n');

const stop = () => {
  // On Windows, shell-spawned children (pnpm.cmd → vite) need the whole tree killed.
  for (const c of children) {
    if (process.platform === 'win32' && c.pid)
      spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill();
  }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
