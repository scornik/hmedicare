#!/usr/bin/env node
// `pnpm db:migration:lint`: fails when any migration breaks the MariaDB rules (DATABASE-IMPLEMENTATION.md §1.3).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintMigrations } from './lib/lint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'prisma/migrations');
const migrations = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .map((name) => ({ name, sql: readFileSync(path.join(dir, name, 'migration.sql'), 'utf8') }));
const problems = lintMigrations(migrations);
if (problems.length) {
  console.error(`db:migration:lint: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`db:migration:lint: ${migrations.length} migration(s) clean`);
