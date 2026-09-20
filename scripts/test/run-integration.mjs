#!/usr/bin/env node
// Runs the integration and security suites against every supported MariaDB series (ADR-014: 10.6 floor,
// also tested on 11.8, the series the deployed plan runs per HOST-001). Override with
// MARIADB_IMAGES="mariadb:10.6" to run one image.
import { spawnSync } from 'node:child_process';

const images = (process.env.MARIADB_IMAGES ?? 'mariadb:10.6,mariadb:11.8').split(',').map((s) => s.trim());
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
