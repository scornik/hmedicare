#!/usr/bin/env node
// Local-only database reset: drops every table and re-applies all migrations. Refused outside
// development/test (LOCAL-DEVELOPMENT.md §3, `pnpm db:reset`).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mariadb from 'mariadb';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appEnv = process.env.APP_ENV ?? 'development';
if (appEnv !== 'development' && appEnv !== 'test') {
  console.error(`db:reset refused: APP_ENV=${appEnv}`);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('db:reset: DATABASE_URL is not set');
  process.exit(1);
}
const u = new URL(url.replace(/^mysql:/, 'mariadb:'));
const conn = await mariadb.createConnection({
  host: u.hostname,
  port: u.port ? Number(u.port) : 3306,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ''),
});
try {
  const tables = await conn.query(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'",
  );
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const { t } of tables) await conn.query(`DROP TABLE \`${t}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log(`db:reset: dropped ${tables.length} table(s)`);
} finally {
  await conn.end();
}
execFileSync(process.execPath, [path.join(root, 'scripts/migrate-guarded.mjs')], {
  stdio: 'inherit',
  env: process.env,
});
