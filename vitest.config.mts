import { defineConfig } from 'vitest/config';

// Test layers per TEST-IMPLEMENTATION.md §1. Workspace packages are consumed from source through the
// `development` export condition, so no build is needed before tests.
// Decorator metadata is required for NestJS DI and nestjs-zod DTO validation in tests (Oxc legacy decorators).
const shared = {
  resolve: { conditions: ['development'] },
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
} as const;

export default defineConfig({
  test: {
    reporters: ['default'],
    projects: [
      {
        ...shared,
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/**/src/**/*.test.ts',
            'packages/**/test/unit/**/*.test.ts',
            'apps/*/test/unit/**/*.test.ts',
            'tooling/**/test/**/*.test.ts',
            'scripts/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
      {
        ...shared,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['packages/**/test/integration/**/*.test.ts', 'apps/*/test/integration/**/*.test.ts'],
          globalSetup: ['tests/support/mariadb-global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
      {
        ...shared,
        test: {
          name: 'security',
          environment: 'node',
          include: ['tests/security/**/*.test.ts'],
          globalSetup: ['tests/support/mariadb-global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
      {
        ...shared,
        test: {
          name: 'architecture',
          environment: 'node',
          include: ['tests/architecture/**/*.test.ts'],
          testTimeout: 60_000,
        },
      },
    ],
  },
});
