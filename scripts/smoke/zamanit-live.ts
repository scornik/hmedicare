// SMS-008 live smoke (ZAMANIT-VERIFICATION.md §4). Sends EXACTLY ONE real SMS through the Zaman IT
// adapter to a developer-supplied phone, with fixed non-clinical text. Never in CI.
//
//   ZAMANIT_LIVE_SMOKE=true ZAMANIT_LIVE_SMOKE_TO=+8801XXXXXXXXX \
//   ZAMANIT_BASE_URL=... ZAMANIT_API_KEY=... ZAMANIT_SENDER_ID=... ZAMANIT_ALLOW_INSECURE_HTTP=true \
//   pnpm smoke:zamanit-live
//
// Guards: aborts when CI is set; requires ZAMANIT_LIVE_SMOKE=true; one run per 10 minutes (lock file);
// prints outcome classes, a masked phone and balances only — never the key, the full phone or the text.
// Requires the adapter build: pnpm --filter @hmedic/communication-adapters-zamanit build
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ZamanItSmsAdapter as ZamanItSmsAdapterClass } from '../../packages/communication-adapters/zamanit/src/index';

const LOCK = path.join(tmpdir(), 'hmedic-zamanit-live-smoke.lock');
const LOCK_MS = 10 * 60_000;

function fail(code: number, message: string): never {
  process.stderr.write(`zamanit-live-smoke: ${message}\n`);
  process.exit(code);
}

export function guard(env: NodeJS.ProcessEnv, now: number): { to: string } {
  if (env.CI) fail(2, 'refused: CI is set (the live smoke never runs in CI)');
  if (env.ZAMANIT_LIVE_SMOKE !== 'true') fail(2, 'refused: set ZAMANIT_LIVE_SMOKE=true to send one real SMS');
  const to = env.ZAMANIT_LIVE_SMOKE_TO ?? env.ZAMANIT_SMOKE_TO;
  if (!to || !/^\+8801[3-9][0-9]{8}$/.test(to))
    fail(2, 'ZAMANIT_LIVE_SMOKE_TO must be an E.164 +8801XXXXXXXXX number');
  for (const name of ['ZAMANIT_BASE_URL', 'ZAMANIT_API_KEY', 'ZAMANIT_SENDER_ID']) {
    if (!env[name]) fail(2, `${name} is required`);
  }
  if (existsSync(LOCK)) {
    const last = Number(readFileSync(LOCK, 'utf8'));
    if (Number.isFinite(last) && now - last < LOCK_MS)
      fail(3, 'refused: a live smoke ran less than 10 minutes ago');
  }
  return { to };
}

async function main(): Promise<void> {
  const { to } = guard(process.env, Date.now());
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const dist = path.join(root, 'packages/communication-adapters/zamanit/dist/index.js');
  if (!existsSync(dist))
    fail(1, 'build the adapter first: pnpm --filter @hmedic/communication-adapters-zamanit build');
  const { ZamanItSmsAdapter } = (await import(`file://${dist.replace(/\\/g, '/')}`)) as {
    ZamanItSmsAdapter: typeof ZamanItSmsAdapterClass;
  };
  const env = process.env;
  const adapter = new ZamanItSmsAdapter({
    baseUrl: env.ZAMANIT_BASE_URL!,
    timeoutMs: Number(env.ZAMANIT_TIMEOUT_MS ?? 10_000),
    allowInsecureHttp: env.ZAMANIT_ALLOW_INSECURE_HTTP === 'true',
    appEnv: 'development',
    isHttpGateClosed: async () => false,
  });
  const credential = {
    scope: 'PLATFORM' as const,
    credentialId: null,
    tenantId: null,
    senderId: env.ZAMANIT_SENDER_ID!,
    withKey: <T>(fn: (k: string) => Promise<T>) => fn(env.ZAMANIT_API_KEY!),
  };
  writeFileSync(LOCK, String(Date.now()));
  const before = await adapter.checkBalance(credential);
  const text = `HMedic test ${randomBytes(3).toString('hex')}`;
  const sent = await adapter.send({
    credential,
    destination: to,
    text,
    purpose: 'TRANSACTIONAL',
    correlationId: 'live-smoke',
  });
  await new Promise((r) => setTimeout(r, 5_000));
  const after = await adapter.checkBalance(credential);
  const summary = {
    event: 'ZAMANIT_LIVE_SMOKE',
    to: `${to.slice(0, 5)}*******${to.slice(-2)}`,
    send: sent,
    balanceBefore: before.outcome === 'OK' ? before.balance : before,
    balanceAfter: after.outcome === 'OK' ? after.balance : after,
    note: 'Record ZAMANIT-VER-03/07/17 in ZAMANIT-VERIFICATION.md §3 (received? charged?).',
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (sent.outcome !== 'ACCEPTED') process.exitCode = 4;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => fail(1, `failed: ${error instanceof Error ? error.name : 'error'}`));
}
