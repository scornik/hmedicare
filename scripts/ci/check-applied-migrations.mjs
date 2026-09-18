#!/usr/bin/env node
// Fails when a migration that already exists on the base branch was edited or deleted
// (DATABASE-IMPLEMENTATION.md §1.3: never edit an applied migration). BASE_REF defaults to origin/main,
// falling back to main.
import { execFileSync } from 'node:child_process';

const DIR = 'packages/database/prisma/migrations';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function resolveBase() {
  for (const ref of [process.env.BASE_REF, 'origin/main', 'main'].filter(Boolean)) {
    try {
      git('rev-parse', '--verify', ref);
      return ref;
    } catch {
      /* try next */
    }
  }
  return null;
}

const base = resolveBase();
if (!base) {
  console.log('check-applied-migrations: no base ref found; skipping');
  process.exit(0);
}
const mergeBase = git('merge-base', 'HEAD', base);
const changed = git('diff', '--name-status', mergeBase, '--', DIR)
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split('\t'))
  .filter(([status, file]) => status !== 'A' && file.endsWith('migration.sql'));
if (changed.length) {
  console.error('check-applied-migrations: existing migrations were modified or deleted:');
  for (const [status, file] of changed) console.error(`  ${status} ${file}`);
  console.error('Create a new forward migration instead.');
  process.exit(1);
}
console.log(`check-applied-migrations: no existing migration changed since ${base}`);
