import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Deployed version (promote-staging polls `/health/live` for `version == SHA`). The Hostinger build writes
 * `dist/build-info.json` (`scripts/host/write-build-info.mjs`); an explicit `APP_VERSION` env var wins.
 */
export function applyBuildInfo(distDir: string, env: NodeJS.ProcessEnv = process.env): void {
  if (env.APP_VERSION) return;
  const file = path.join(distDir, 'build-info.json');
  if (!existsSync(file)) return;
  try {
    const info = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    if (typeof info.version === 'string' && /^[0-9a-f]{7,40}$/.test(info.version))
      env.APP_VERSION = info.version;
  } catch {
    // A malformed file leaves APP_VERSION at its default ('dev').
  }
}
