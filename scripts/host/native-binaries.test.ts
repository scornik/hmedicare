import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper shared with the deploy scripts; no types, by design.
import { isNativeBinary } from './native-binaries.mjs';

/**
 * This predicate decides which files get their execute bit restored on a host that unpacks packages as
 * 0644. It has now been wrong twice in production, each time costing a deployment:
 *
 *   - `@turbo/linux-64/bin/turbo` → the build could not start;
 *   - `schema-engine-debian-openssl-1.1.x` → `prisma migrate deploy` died with EACCES, the API refused to
 *     boot behind it, and the site served 503 until someone looked.
 *
 * So the real filenames are listed here by name. A rename in an upstream package should fail this test
 * rather than surface as an outage.
 */
describe('isNativeBinary (deploy-host execute bits)', () => {
  const executable = [
    'turbo',
    // Prisma 6, the deployed target (ADR-022). Both are spawned or dlopened at runtime.
    'schema-engine-debian-openssl-1.1.x',
    'libquery_engine-debian-openssl-1.1.x.so.node',
    'query-engine-debian-openssl-3.0.x',
    'query_engine-windows.dll.node',
    'libquery_engine-linux-musl-arm64-openssl-3.0.x.so.node',
    'migration-engine-debian-openssl-1.1.x',
  ];

  it.each(executable)('treats %s as a binary', (file) => {
    expect(isNativeBinary(file)).toBe(true);
  });

  const data = [
    'package.json',
    'index.js',
    'schema.prisma',
    'README.md',
    'default.d.ts',
    'engines.js',
    // Close enough to the engine names to be worth pinning: these are metadata, not programs.
    'schema-engine',
    'query-engine.d.ts',
    'libquery_engine.json',
  ];

  it.each(data)('leaves %s alone', (file) => {
    expect(isNativeBinary(file)).toBe(false);
  });
});
