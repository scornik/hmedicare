#!/usr/bin/env node
// Runs the integration and security suites against every supported MariaDB series. The series come from
// config/mariadb-series.json, which every database gate reads, so a re-pin cannot be applied in one place
// and forgotten in another. Override with MARIADB_IMAGES="mariadb:10.6" to run one image.
import { spawnSync } from 'node:child_process';
import { seriesFromEnvOrConfig } from './mariadb-series.mjs';

const images = seriesFromEnvOrConfig();
const extra = process.argv.slice(2);
let failed = false;
for (const image of images) {
  console.log(`\n=== integration + security on ${image} ===`);
  const r = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'vitest', 'run', '--project', 'integration', '--project', 'security', ...extra],
    { stdio: 'inherit', env: { ...process.env, MARIADB_IMAGE: image }, shell: process.platform === 'win32' },
  );
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
