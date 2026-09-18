import os from 'node:os';
import path from 'node:path';
import { createProbeServer } from './server';

/**
 * Entry point. Required env: HOST_PROBE_TOKEN (≥ 32 chars), HOST_PROBE_DATABASE_URL (a dedicated probe
 * database, never the app DB), PORT. Optional: APP_ENV (default staging), HOST_PROBE_STORAGE_DIR (default
 * ~/hmedic-storage), HOST_PROBE_EGRESS (comma-separated https:// URLs to HEAD-check).
 */
function main(): void {
  const token = process.env.HOST_PROBE_TOKEN ?? '';
  const databaseUrl = process.env.HOST_PROBE_DATABASE_URL ?? '';
  const missing = [
    token.length < 32 ? 'HOST_PROBE_TOKEN (≥ 32 chars)' : null,
    databaseUrl ? null : 'HOST_PROBE_DATABASE_URL',
  ].filter(Boolean);
  if (missing.length) {
    process.stderr.write(`host-probe: missing ${missing.join(', ')}\n`);
    process.exit(78);
  }
  const egress = (process.env.HOST_PROBE_EGRESS ?? 'https://generativelanguage.googleapis.com/')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('https://'));
  const port = Number(process.env.PORT ?? 3002);
  const server = createProbeServer({
    token,
    port,
    databaseUrl,
    appEnv: process.env.APP_ENV ?? 'staging',
    storageDir: process.env.HOST_PROBE_STORAGE_DIR ?? path.join(os.homedir(), 'hmedic-storage'),
    egressTargets: egress,
  });
  server.listen(port, '0.0.0.0', () => process.stdout.write(`host-probe listening on ${port}\n`));
}

main();
