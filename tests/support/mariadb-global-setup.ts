import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { MariaDbContainer, type StartedMariaDbContainer } from '@testcontainers/mariadb';
import type { TestProject } from 'vitest/node';

/**
 * Integration/security test database (TEST-IMPLEMENTATION.md §1). Starts the pinned MariaDB image
 * (MARIADB_IMAGE, default mariadb:10.6; CI runs 10.6 and 11.4), applies every migration with
 * `prisma migrate deploy` exactly like production, and provides the connection URL to tests.
 * Set TEST_DATABASE_URL to reuse an existing database (e.g. the docker compose one) instead.
 */
declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    rootDatabaseUrl: string;
    mariadbImage: string;
  }
}

const repoRoot = path.resolve(__dirname, '../..');
const databasePkg = path.join(repoRoot, 'packages/database');

export function applyMigrations(url: string): void {
  const require = createRequire(path.join(databasePkg, 'package.json'));
  const cli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: databasePkg,
    env: {
      ...process.env,
      DATABASE_URL: url.replace(/^mariadb:/, 'mysql:'),
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    },
    stdio: 'pipe',
  });
}

let container: StartedMariaDbContainer | undefined;

export default async function setup(project: TestProject) {
  const image = process.env.MARIADB_IMAGE ?? 'mariadb:10.6';
  let url = process.env.TEST_DATABASE_URL;
  let rootUrl = process.env.TEST_DATABASE_ROOT_URL ?? url;
  if (!url) {
    container = await new MariaDbContainer(image)
      .withDatabase('hmedic_test')
      .withUsername('hmedic_app')
      .withUserPassword('test-only-password')
      .withRootPassword('test-only-root')
      .withCommand([
        '--character-set-server=utf8mb4',
        '--collation-server=utf8mb4_unicode_520_ci',
        '--default-time-zone=+00:00',
        '--innodb-lock-wait-timeout=5',
        '--max-connections=200',
      ])
      .start();
    const host = container.getHost();
    const port = container.getPort();
    url = `mariadb://hmedic_app:test-only-password@${host}:${port}/hmedic_test`;
    rootUrl = `mariadb://root:test-only-root@${host}:${port}/hmedic_test`;
  }
  applyMigrations(url);
  project.provide('databaseUrl', url);
  project.provide('rootDatabaseUrl', rootUrl ?? url);
  project.provide('mariadbImage', image);
  return async () => {
    await container?.stop();
  };
}
